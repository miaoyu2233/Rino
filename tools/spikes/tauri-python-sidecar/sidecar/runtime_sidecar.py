from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from collections.abc import Sequence
from typing import BinaryIO, Never, cast

PROTOCOL_VERSION = 1
MAX_FRAME_BYTES = 64 * 1024
HEADER_TERMINATOR = b"\r\n\r\n"


class ProtocolFailure(Exception):
    pass


def read_exact(stream: BinaryIO, length: int) -> bytes:
    chunks: list[bytes] = []
    remaining = length
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            raise EOFError
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_frame(stream: BinaryIO) -> dict[str, object]:
    header = bytearray()
    while not header.endswith(HEADER_TERMINATOR):
        byte = stream.read(1)
        if not byte:
            raise EOFError
        header.extend(byte)
        if len(header) > 128:
            raise ProtocolFailure("header limit exceeded")
    header_text = header[: -len(HEADER_TERMINATOR)].decode("ascii", errors="strict")
    prefix = "Content-Length: "
    if not header_text.startswith(prefix):
        raise ProtocolFailure("invalid header")
    length_text = header_text[len(prefix) :]
    if not length_text.isascii() or not length_text.isdecimal():
        raise ProtocolFailure("invalid content length")
    body_length = int(length_text)
    if body_length > MAX_FRAME_BYTES:
        raise ProtocolFailure("frame limit exceeded")
    body = read_exact(stream, body_length)
    message = cast(object, json.loads(body.decode("utf-8", errors="strict")))
    if not isinstance(message, dict):
        raise ProtocolFailure("message must be an object")
    mapping = cast(dict[object, object], message)
    if not all(isinstance(key, str) for key in mapping):
        raise ProtocolFailure("message keys must be strings")
    return {cast(str, key): value for key, value in mapping.items()}


def encode_frame(message: dict[str, object]) -> bytes:
    body = json.dumps(
        message,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(body) > MAX_FRAME_BYTES:
        raise ProtocolFailure("frame limit exceeded")
    return (
        b"Content-Length: " + str(len(body)).encode("ascii") + HEADER_TERMINATOR + body
    )


def response(
    request: dict[str, object],
    result: dict[str, object],
) -> dict[str, object]:
    request_id = request.get("requestId")
    message_type = request.get("messageType")
    if not isinstance(request_id, str) or not isinstance(message_type, str):
        raise ProtocolFailure("request identity is invalid")
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "messageKind": "response",
        "messageType": message_type,
        "requestId": request_id,
        "result": result,
    }


def event(
    message_type: str, sequence: int, payload: dict[str, object]
) -> dict[str, object]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "messageKind": "event",
        "messageType": message_type,
        "eventId": str(uuid.uuid4()),
        "sequence": sequence,
        "payload": payload,
    }


def write_bytes(stream: BinaryIO, content: bytes, fragmented: bool) -> None:
    if fragmented:
        for byte in content:
            stream.write(bytes((byte,)))
            stream.flush()
        return
    stream.write(content)
    stream.flush()


def write_messages(
    stream: BinaryIO,
    messages: Sequence[dict[str, object]],
    fragmented: bool,
) -> None:
    write_bytes(
        stream, b"".join(encode_frame(message) for message in messages), fragmented
    )


def run(mode: str) -> int:
    source = sys.stdin.buffer
    target = sys.stdout.buffer
    fragmented = mode == "fragmented"
    if mode == "slow-start":
        time.sleep(0.5)
    if mode == "malformed":
        read_frame(source)
        write_bytes(target, b"Content-Length: invalid\r\n\r\n", False)
        time.sleep(0.1)
        return 2

    handshake = read_frame(source)
    if handshake.get("messageType") != "system.handshake":
        raise ProtocolFailure("first request must be system.handshake")
    unrelated = response(handshake, {"ignored": True})
    unrelated["requestId"] = str(uuid.uuid4())
    handshake_response = response(
        handshake,
        {
            "accepted": True,
            "runtimeVersion": "0.0.0-spike",
            "protocolVersion": PROTOCOL_VERSION,
            "maximumFrameBytes": MAX_FRAME_BYTES,
            "runtimeMode": "frozen" if getattr(sys, "frozen", False) else "source",
            "pathEnvironmentPresent": "PATH" in os.environ,
            "pythonHomeEnvironmentPresent": "PYTHONHOME" in os.environ,
        },
    )
    ready = event("system.ready", 1, {"state": "ready"})
    write_messages(target, [unrelated, handshake_response, ready], fragmented)

    sequence = 2
    children: list[subprocess.Popen[bytes]] = []
    while True:
        request = read_frame(source)
        message_type = request.get("messageType")
        if message_type == "system.shutdown":
            write_messages(target, [response(request, {"accepted": True})], fragmented)
            return 0
        if message_type == "system.echo":
            payload = request.get("payload")
            write_messages(target, [response(request, {"echo": payload})], fragmented)
            continue
        if message_type == "test.crash":
            os._exit(17)
        if message_type == "test.spawnChild":
            child = subprocess.Popen(
                [sys.executable, "-I", "-c", "import time; time.sleep(60)"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            children.append(child)
            write_messages(
                target,
                [
                    response(request, {"childStarted": True}),
                    event("test.childStarted", sequence, {"processId": child.pid}),
                ],
                fragmented,
            )
            sequence += 1
            continue
        write_messages(
            target,
            [
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "messageKind": "response",
                    "messageType": str(message_type),
                    "requestId": request.get("requestId"),
                    "error": {
                        "code": "UNKNOWN_MESSAGE_TYPE",
                        "message": "The request type is not supported by the spike.",
                    },
                }
            ],
            fragmented,
        )


def fail_safely(error: Exception) -> Never:
    diagnostic = {
        "severity": "error",
        "code": "SIDECAR_PROTOCOL_FAILURE",
        "errorType": type(error).__name__,
    }
    sys.stderr.write(json.dumps(diagnostic, separators=(",", ":")) + "\n")
    raise SystemExit(2)


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=("normal", "fragmented", "slow-start", "malformed"),
        default="normal",
    )
    options = parser.parse_args(arguments)
    try:
        return run(options.mode)
    except (
        EOFError,
        OSError,
        ProtocolFailure,
        UnicodeError,
        json.JSONDecodeError,
    ) as error:
        fail_safely(error)


if __name__ == "__main__":
    raise SystemExit(main())
