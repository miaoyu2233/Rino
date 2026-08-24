"""Fault-injection tests for the runtime's side of the transport boundary.

Each case feeds the runtime input a defective or hostile peer could send, and asserts
that the runtime fails safely: it answers with a structured error where correlation is
possible, stops rather than resynchronizing on a corrupted stream, and never echoes peer
content into a diagnostic.
"""

from __future__ import annotations

import io
import json
from typing import Any, Final, cast

from rino_runtime.contracts import is_valid_message
from rino_runtime.diagnostics import DiagnosticLog, DiagnosticSeverity
from rino_runtime.errors import RuntimeErrorCode
from rino_runtime.ipc import FrameDecoder, encode_frame
from rino_runtime.ipc.transport import (
    EXIT_SUCCESS,
    EXIT_TRANSPORT_FAILURE,
    StdioTransport,
)
from rino_runtime.service import RuntimeMode, RuntimeService

FRAME_LIMIT: Final[int] = 1_048_576
HANDSHAKE_REQUEST_ID: Final[str] = "5f0c2e9a-1c2b-4f6e-9d3a-8b7c6d5e4f30"
SECOND_REQUEST_ID: Final[str] = "0b9d4a77-6c3f-4d2e-8a1b-2c3d4e5f6a70"


class ChunkedReader:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = list(chunks)

    def read1(self, _size: int, /) -> bytes:
        if not self._chunks:
            return b""
        return self._chunks.pop(0)


def build_transport() -> tuple[StdioTransport, io.StringIO]:
    diagnostic_stream = io.StringIO()
    diagnostics = DiagnosticLog(
        stream=diagnostic_stream, minimum_severity=DiagnosticSeverity.DEBUG
    )
    service = RuntimeService(
        runtime_mode=RuntimeMode.SOURCE,
        monotonic_milliseconds=lambda: 0,
    )
    return StdioTransport(service, diagnostics), diagnostic_stream


def request_frame(message_type: str, payload: dict[str, Any], request_id: str) -> bytes:
    body = json.dumps(
        {
            "protocolVersion": 1,
            "messageKind": "request",
            "messageType": message_type,
            "requestId": request_id,
            "payload": payload,
        },
        separators=(",", ":"),
    )
    return encode_frame(body, FRAME_LIMIT)


def handshake_frame() -> bytes:
    return request_frame(
        "system.handshake",
        {
            "desktopVersion": "0.1.0",
            "protocolVersionRange": {"minimum": 1, "maximum": 1},
            "maximumFrameBytes": FRAME_LIMIT,
        },
        HANDSHAKE_REQUEST_ID,
    )


def decode_output(target: io.BytesIO) -> list[dict[str, Any]]:
    decoder = FrameDecoder(FRAME_LIMIT)
    bodies = decoder.push(target.getvalue())
    decoder.finish()
    messages: list[dict[str, Any]] = []
    for body in bodies:
        decoded: Any = json.loads(body)
        assert is_valid_message(decoded)
        messages.append(cast("dict[str, Any]", decoded))
    return messages


def test_an_unknown_request_type_is_answered_and_the_session_continues() -> None:
    transport, _ = build_transport()
    source = ChunkedReader(
        [
            handshake_frame(),
            request_frame("future.unknownOperation", {}, SECOND_REQUEST_ID),
            request_frame("system.shutdown", {}, HANDSHAKE_REQUEST_ID),
        ]
    )
    target = io.BytesIO()

    exit_code = transport.serve(source, target)

    assert exit_code == EXIT_SUCCESS
    messages = decode_output(target)
    unknown = messages[2]
    assert unknown["requestId"] == SECOND_REQUEST_ID
    assert unknown["error"]["code"] == RuntimeErrorCode.UNKNOWN_MESSAGE_TYPE.value
    assert messages[3]["messageType"] == "system.shutdown"


def test_an_unsupported_protocol_version_fails_without_a_handshake() -> None:
    transport, _ = build_transport()
    body = json.dumps(
        {
            "protocolVersion": 2,
            "messageKind": "request",
            "messageType": "system.handshake",
            "requestId": HANDSHAKE_REQUEST_ID,
            "payload": {},
        },
        separators=(",", ":"),
    )
    target = io.BytesIO()

    transport.serve(ChunkedReader([encode_frame(body, FRAME_LIMIT)]), target)

    response = decode_output(target)[0]
    assert response["requestId"] == HANDSHAKE_REQUEST_ID
    assert response["error"]["code"] == RuntimeErrorCode.INVALID_MESSAGE.value


def test_a_frame_header_split_across_reads_is_reassembled() -> None:
    transport, _ = build_transport()
    stream = handshake_frame() + request_frame("system.shutdown", {}, SECOND_REQUEST_ID)
    # One byte at a time is the worst case a pipe can deliver.
    source = ChunkedReader([stream[index : index + 1] for index in range(len(stream))])
    target = io.BytesIO()

    assert transport.serve(source, target) == EXIT_SUCCESS
    assert len(decode_output(target)) == 3


def test_an_oversized_declared_frame_stops_the_session_safely() -> None:
    transport, diagnostics = build_transport()
    target = io.BytesIO()

    exit_code = transport.serve(
        ChunkedReader([f"Content-Length: {FRAME_LIMIT + 1}\r\n\r\n".encode("ascii")]),
        target,
    )

    assert exit_code == EXIT_TRANSPORT_FAILURE
    assert decode_output(target)[0]["messageType"] == "system.protocolError"
    assert "RUNTIME_FRAMING_FAILURE" in diagnostics.getvalue()


def test_a_poisoned_stream_is_not_resynchronized() -> None:
    transport, _ = build_transport()
    # A valid frame after a malformed header must not be processed: the stream position
    # is unknown, so continuing would reinterpret payload bytes as protocol.
    source = ChunkedReader([b"Content-Length: bogus\r\n\r\n" + handshake_frame()])
    target = io.BytesIO()

    exit_code = transport.serve(source, target)

    assert exit_code == EXIT_TRANSPORT_FAILURE
    messages = decode_output(target)
    assert len(messages) == 1
    assert messages[0]["messageType"] == "system.protocolError"


def test_a_non_object_payload_is_rejected_with_a_correlated_error() -> None:
    transport, _ = build_transport()
    body = json.dumps(
        {
            "protocolVersion": 1,
            "messageKind": "request",
            "messageType": "system.health",
            "requestId": SECOND_REQUEST_ID,
            "payload": "not-an-object",
        },
        separators=(",", ":"),
    )
    target = io.BytesIO()

    transport.serve(ChunkedReader([encode_frame(body, FRAME_LIMIT)]), target)

    response = decode_output(target)[0]
    assert response["requestId"] == SECOND_REQUEST_ID
    assert response["error"]["code"] == RuntimeErrorCode.INVALID_MESSAGE.value


def test_a_hostile_payload_never_reaches_a_diagnostic_or_an_error() -> None:
    transport, diagnostics = build_transport()
    secret = "s3cret-token-never-echoed"
    body = json.dumps(
        {
            "protocolVersion": 1,
            "messageKind": "request",
            "messageType": "system.handshake",
            "requestId": HANDSHAKE_REQUEST_ID,
            "payload": {"desktopVersion": secret},
        },
        separators=(",", ":"),
    )
    target = io.BytesIO()

    transport.serve(ChunkedReader([encode_frame(body, FRAME_LIMIT)]), target)

    assert secret not in target.getvalue().decode("utf-8")
    assert secret not in diagnostics.getvalue()


def test_input_closed_mid_frame_is_reported_as_truncated() -> None:
    transport, diagnostics = build_transport()

    exit_code = transport.serve(ChunkedReader([handshake_frame()[:-3]]), io.BytesIO())

    assert exit_code == EXIT_TRANSPORT_FAILURE
    assert "RUNTIME_INPUT_TRUNCATED" in diagnostics.getvalue()
