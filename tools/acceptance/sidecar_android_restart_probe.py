"""Exercise real Sidecar generations against one Android target without captures."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
from collections.abc import Sequence
from pathlib import Path
from queue import Empty, Queue
from typing import BinaryIO, Final, cast
from uuid import uuid4

from rino_runtime.ipc import encode_frame

FRAME_LIMIT: Final[int] = 1_048_576
RESPONSE_TIMEOUT_SECONDS: Final[float] = 45.0
PROCESS_EXIT_TIMEOUT_SECONDS: Final[float] = 15.0


class SidecarProtocolError(RuntimeError):
    pass


class SidecarSession:
    def __init__(self, arguments: Sequence[str]) -> None:
        self._process = subprocess.Popen(
            arguments,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        if self._process.stdin is None or self._process.stdout is None:
            self._process.kill()
            raise SidecarProtocolError("The Sidecar pipes were unavailable.")
        self._stdin = cast(BinaryIO, self._process.stdin)
        self._stdout = cast(BinaryIO, self._process.stdout)
        self._messages: Queue[dict[str, object] | BaseException | None] = Queue()
        self._reader = threading.Thread(
            target=self._read_messages,
            name="rino-sidecar-acceptance-reader",
            daemon=True,
        )
        self._reader.start()

    @property
    def running(self) -> bool:
        return self._process.poll() is None

    def request(
        self,
        message_type: str,
        payload: dict[str, object],
    ) -> dict[str, object]:
        request_id = str(uuid4())
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
        self._stdin.write(encode_frame(body, FRAME_LIMIT))
        self._stdin.flush()
        while True:
            try:
                message = self._messages.get(timeout=RESPONSE_TIMEOUT_SECONDS)
            except Empty as error:
                raise SidecarProtocolError("The Sidecar response timed out.") from error
            if message is None:
                raise SidecarProtocolError("The Sidecar output closed unexpectedly.")
            if isinstance(message, BaseException):
                raise SidecarProtocolError(
                    "The Sidecar protocol was invalid."
                ) from message
            if message.get("requestId") == request_id:
                return message

    def kill(self) -> None:
        if self.running:
            self._process.kill()
        self._process.wait(timeout=PROCESS_EXIT_TIMEOUT_SECONDS)

    def wait_for_exit(self) -> None:
        self._stdin.close()
        self._process.wait(timeout=PROCESS_EXIT_TIMEOUT_SECONDS)

    def close(self) -> None:
        if self.running:
            self._process.kill()
            self._process.wait(timeout=PROCESS_EXIT_TIMEOUT_SECONDS)
        self._stdin.close()
        self._stdout.close()

    def _read_messages(self) -> None:
        try:
            while True:
                message = _read_protocol_message(self._stdout)
                if message is None:
                    self._messages.put(None)
                    return
                self._messages.put(message)
        except (
            json.JSONDecodeError,
            OSError,
            SidecarProtocolError,
            UnicodeDecodeError,
            ValueError,
        ) as error:
            self._messages.put(error)


def _read_protocol_message(source: BinaryIO) -> dict[str, object] | None:
    header = source.readline(129)
    if not header:
        return None
    prefix = b"Content-Length: "
    if not header.startswith(prefix) or not header.endswith(b"\r\n"):
        raise SidecarProtocolError("The Sidecar frame header was malformed.")
    length_text = header[len(prefix) : -2]
    if not length_text.isdigit():
        raise SidecarProtocolError("The Sidecar frame length was invalid.")
    body_length = int(length_text)
    if body_length > FRAME_LIMIT or source.read(2) != b"\r\n":
        raise SidecarProtocolError("The Sidecar frame exceeded its boundary.")
    body = source.read(body_length)
    if len(body) != body_length:
        raise SidecarProtocolError("The Sidecar frame ended early.")
    decoded = json.loads(body.decode("utf-8", errors="strict"))
    if not isinstance(decoded, dict) or not all(
        isinstance(key, str) for key in decoded
    ):
        raise SidecarProtocolError("The Sidecar message was invalid.")
    return cast(dict[str, object], decoded)


def _require_result(response: dict[str, object]) -> dict[str, object]:
    result = response.get("result")
    if not isinstance(result, dict):
        raise SidecarProtocolError("The Sidecar request did not succeed.")
    return cast(dict[str, object], result)


def _handshake(session: SidecarSession) -> None:
    _require_result(
        session.request(
            "system.handshake",
            {
                "desktopVersion": "0.1.0",
                "protocolVersionRange": {"minimum": 1, "maximum": 1},
                "maximumFrameBytes": FRAME_LIMIT,
            },
        )
    )


def _connect_first_available(session: SidecarSession) -> tuple[str, int]:
    result = _require_result(session.request("device.list", {}))
    devices = result.get("devices")
    if not isinstance(devices, list) or not devices:
        raise SidecarProtocolError("The Sidecar did not discover an Android target.")
    for device in devices:
        if not isinstance(device, dict):
            continue
        device_key = device.get("deviceKey")
        if not isinstance(device_key, str):
            continue
        response = session.request("device.connect", {"deviceKey": device_key})
        if isinstance(response.get("result"), dict):
            return (device_key, len(devices))
    raise SidecarProtocolError("No discovered Android target could be connected.")


def _sidecar_arguments(options: argparse.Namespace) -> list[str]:
    return [
        sys.executable,
        "-m",
        "rino_runtime",
        "--maa-user-data-directory",
        str(options.user_data_directory),
        "--adb-executable",
        str(options.adb_executable),
        "--maa-ocr-model-directory",
        str(options.model_directory),
        "--preview-cache-directory",
        str(options.preview_cache_directory),
    ]


def run_probe(options: argparse.Namespace) -> dict[str, object]:
    arguments = _sidecar_arguments(options)
    first = SidecarSession(arguments)
    second: SidecarSession | None = None
    report: dict[str, object] = {
        "passed": False,
        "deviceMetadataRedacted": True,
        "capturesRetained": False,
    }
    try:
        _handshake(first)
        _, first_count = _connect_first_available(first)
        report["firstGenerationConnected"] = True
        report["firstGenerationDeviceCount"] = first_count
        first.kill()
        report["firstGenerationTerminatedWhileConnected"] = True

        second = SidecarSession(arguments)
        _handshake(second)
        second_device_key, second_count = _connect_first_available(second)
        report["secondGenerationConnected"] = True
        report["secondGenerationDeviceCount"] = second_count
        disconnected = _require_result(
            second.request(
                "device.disconnect",
                {"deviceKey": second_device_key},
            )
        )
        report["secondGenerationDisconnected"] = isinstance(
            disconnected.get("device"),
            dict,
        )
        _require_result(second.request("system.shutdown", {}))
        second.wait_for_exit()
        report["secondGenerationShutdownCleanly"] = True
        report["passed"] = all(
            (
                report["firstGenerationConnected"],
                report["firstGenerationTerminatedWhileConnected"],
                report["secondGenerationConnected"],
                report["secondGenerationDisconnected"],
                report["secondGenerationShutdownCleanly"],
            )
        )
        return report
    finally:
        first.close()
        if second is not None:
            second.close()


def parse_arguments(arguments: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb-executable", type=Path, required=True)
    parser.add_argument("--model-directory", type=Path, required=True)
    parser.add_argument("--user-data-directory", type=Path, required=True)
    parser.add_argument("--preview-cache-directory", type=Path, required=True)
    options = parser.parse_args(arguments)
    for attribute in (
        "adb_executable",
        "model_directory",
        "user_data_directory",
        "preview_cache_directory",
    ):
        path = cast(Path, getattr(options, attribute))
        if not path.is_absolute():
            parser.error(f"--{attribute.replace('_', '-')} must be absolute")
    return options


def main(arguments: Sequence[str] | None = None) -> int:
    options = parse_arguments(arguments)
    try:
        report = run_probe(options)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        report = {
            "passed": False,
            "failureCode": type(error).__name__,
            "deviceMetadataRedacted": True,
            "capturesRetained": False,
        }
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report.get("passed") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
