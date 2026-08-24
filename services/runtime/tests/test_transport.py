from __future__ import annotations

import io
import json
import threading
from collections.abc import Buffer
from typing import Any, cast
from uuid import UUID

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

FRAME_LIMIT = 1_048_576
DESKTOP_REQUEST_ID = "5f0c2e9a-1c2b-4f6e-9d3a-8b7c6d5e4f30"
SHUTDOWN_REQUEST_ID = "9e8d7c6b-5a49-4837-a625-1403f2e1d0c9"
RUN_ID = UUID("81000000-0000-4000-8000-000000000001")
GRAPH_ID = "81000000-0000-4000-8000-000000000002"
PERSISTENT_NODE_ID = "81000000-0000-4000-8000-000000000009"
PERSISTENT_DELAY_ID = "81000000-0000-4000-8000-00000000000a"
PERSISTENT_VARIABLE_ID = "81000000-0000-4000-8000-00000000000b"


class ChunkedReader:
    """Delivers pre-arranged chunks so partial and combined reads are exercised."""

    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = list(chunks)

    def read1(self, _size: int, /) -> bytes:
        if not self._chunks:
            return b""
        return self._chunks.pop(0)


class RecordingWriter(io.BytesIO):
    def __init__(self) -> None:
        super().__init__()
        self._condition = threading.Condition()
        self._write_count = 0

    def write(self, data: Buffer, /) -> int:
        with self._condition:
            written = super().write(data)
            self._write_count += 1
            self._condition.notify_all()
            return written

    def getvalue(self) -> bytes:
        with self._condition:
            return super().getvalue()

    def wait_for_writes(self, count: int, timeout: float) -> bool:
        with self._condition:
            return self._condition.wait_for(
                lambda: self._write_count >= count,
                timeout=timeout,
            )


class CoordinatedRuntimeReader:
    def __init__(self, target: RecordingWriter) -> None:
        self._target = target
        self._read_count = 0
        self.observed_runtime_event_while_waiting = False

    def read1(self, _size: int, /) -> bytes:
        self._read_count += 1
        if self._read_count == 1:
            return handshake_frame()
        if self._read_count == 2:
            return request_frame(
                "run.start",
                {"document": runtime_document(), "graphId": GRAPH_ID},
                "81000000-0000-4000-8000-000000000006",
            )
        if self._read_count == 3:
            self.observed_runtime_event_while_waiting = self._target.wait_for_writes(
                5,
                timeout=1.0,
            )
            return request_frame(
                "run.cancel",
                {"runId": str(RUN_ID)},
                "81000000-0000-4000-8000-000000000007",
            )
        return request_frame("system.shutdown", {}, SHUTDOWN_REQUEST_ID)


class PersistentRuntimeReader:
    def __init__(self, target: RecordingWriter) -> None:
        self._target = target
        self._read_count = 0

    def read1(self, _size: int, /) -> bytes:
        self._read_count += 1
        if self._read_count == 1:
            return handshake_frame()
        if self._read_count == 2:
            return request_frame(
                "run.start",
                {
                    "document": persistent_runtime_document(),
                    "graphId": GRAPH_ID,
                    "initialPersistentVariables": [
                        {
                            "variableId": PERSISTENT_VARIABLE_ID,
                            "valueKind": "number",
                            "value": 1.25,
                        }
                    ],
                },
                "81000000-0000-4000-8000-000000000006",
            )
        if self._read_count == 3:
            self._target.wait_for_writes(5, timeout=1.0)
            return request_frame(
                "run.cancel",
                {"runId": str(RUN_ID)},
                "81000000-0000-4000-8000-000000000007",
            )
        return request_frame("system.shutdown", {}, SHUTDOWN_REQUEST_ID)


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


def handshake_frame(request_id: str = DESKTOP_REQUEST_ID) -> bytes:
    return request_frame(
        "system.handshake",
        {
            "desktopVersion": "0.1.0",
            "protocolVersionRange": {"minimum": 1, "maximum": 1},
            "maximumFrameBytes": FRAME_LIMIT,
        },
        request_id,
    )


def runtime_document() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "documentId": "81000000-0000-4000-8000-000000000003",
        "metadata": {
            "name": "Transport runtime test",
            "createdAt": "2026-07-27T00:00:00Z",
            "updatedAt": "2026-07-27T00:00:00Z",
        },
        "entryGraphId": GRAPH_ID,
        "graphs": [
            {
                "graphId": GRAPH_ID,
                "name": "Main",
                "kind": "entry",
                "nodes": [
                    {
                        "nodeId": "81000000-0000-4000-8000-000000000004",
                        "typeKey": "core.flow.start",
                        "typeVersion": 1,
                        "position": {"x": 0, "y": 0},
                        "properties": {},
                        "inputValues": {},
                    },
                    {
                        "nodeId": "81000000-0000-4000-8000-000000000005",
                        "typeKey": "core.time.delay",
                        "typeVersion": 1,
                        "position": {"x": 240, "y": 0},
                        "properties": {},
                        "inputValues": {"durationMilliseconds": 60_000},
                    },
                ],
                "edges": [
                    {
                        "edgeId": "81000000-0000-4000-8000-000000000008",
                        "edgeKind": "execution",
                        "sourceNodeId": "81000000-0000-4000-8000-000000000004",
                        "sourcePortId": "next",
                        "targetNodeId": "81000000-0000-4000-8000-000000000005",
                        "targetPortId": "run",
                    }
                ],
            }
        ],
        "assets": [],
        "requiredCapabilities": [],
    }


def persistent_runtime_document() -> dict[str, Any]:
    document = runtime_document()
    graph = document["graphs"][0]
    graph["variables"] = [
        {
            "variableId": PERSISTENT_VARIABLE_ID,
            "name": "transport-number",
            "valueKind": "number",
            "persistent": True,
        }
    ]
    graph["nodes"][1] = {
        "nodeId": PERSISTENT_NODE_ID,
        "typeKey": "core.variable.setNumber",
        "typeVersion": 1,
        "position": {"x": 240, "y": 0},
        "properties": {"variableId": PERSISTENT_VARIABLE_ID},
        "inputValues": {"value": 8.75},
    }
    graph["nodes"].append(
        {
            "nodeId": PERSISTENT_DELAY_ID,
            "typeKey": "core.time.delay",
            "typeVersion": 1,
            "position": {"x": 480, "y": 0},
            "properties": {},
            "inputValues": {"durationMilliseconds": 60_000},
        }
    )
    graph["edges"] = [
        {
            "edgeId": "81000000-0000-4000-8000-000000000008",
            "edgeKind": "execution",
            "sourceNodeId": "81000000-0000-4000-8000-000000000004",
            "sourcePortId": "next",
            "targetNodeId": PERSISTENT_NODE_ID,
            "targetPortId": "run",
        },
        {
            "edgeId": "81000000-0000-4000-8000-00000000000c",
            "edgeKind": "execution",
            "sourceNodeId": PERSISTENT_NODE_ID,
            "sourcePortId": "next",
            "targetNodeId": PERSISTENT_DELAY_ID,
            "targetPortId": "run",
        },
    ]
    return document


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


def test_handshake_then_shutdown_completes_successfully() -> None:
    transport, _ = build_transport()
    source = ChunkedReader(
        [
            handshake_frame(),
            request_frame("system.shutdown", {}, SHUTDOWN_REQUEST_ID),
        ]
    )
    target = io.BytesIO()

    exit_code = transport.serve(source, target)

    assert exit_code == EXIT_SUCCESS
    messages = decode_output(target)
    assert [message["messageType"] for message in messages] == [
        "system.handshake",
        "system.ready",
        "system.shutdown",
    ]


def test_input_split_at_arbitrary_byte_boundaries_is_reassembled() -> None:
    transport, _ = build_transport()
    stream = handshake_frame() + request_frame(
        "system.shutdown", {}, SHUTDOWN_REQUEST_ID
    )
    source = ChunkedReader([stream[index : index + 1] for index in range(len(stream))])
    target = io.BytesIO()

    assert transport.serve(source, target) == EXIT_SUCCESS
    assert len(decode_output(target)) == 3


def test_two_requests_in_one_read_are_both_handled() -> None:
    transport, _ = build_transport()
    source = ChunkedReader(
        [handshake_frame() + request_frame("system.shutdown", {}, SHUTDOWN_REQUEST_ID)]
    )
    target = io.BytesIO()

    assert transport.serve(source, target) == EXIT_SUCCESS
    assert len(decode_output(target)) == 3


def test_closed_input_ends_the_loop_without_failure() -> None:
    transport, diagnostic_stream = build_transport()

    exit_code = transport.serve(ChunkedReader([handshake_frame()]), io.BytesIO())

    assert exit_code == EXIT_SUCCESS
    assert "RUNTIME_INPUT_CLOSED" in diagnostic_stream.getvalue()


def test_input_truncated_mid_frame_reports_a_transport_failure() -> None:
    transport, diagnostic_stream = build_transport()
    truncated = handshake_frame()[:-5]

    exit_code = transport.serve(ChunkedReader([truncated]), io.BytesIO())

    assert exit_code == EXIT_TRANSPORT_FAILURE
    assert "RUNTIME_INPUT_TRUNCATED" in diagnostic_stream.getvalue()


def test_malformed_frame_emits_a_protocol_error_event_and_stops() -> None:
    transport, diagnostic_stream = build_transport()
    target = io.BytesIO()

    exit_code = transport.serve(
        ChunkedReader([b"Content-Length: bogus\r\n\r\n"]), target
    )

    assert exit_code == EXIT_TRANSPORT_FAILURE
    event = decode_output(target)[0]
    assert event["messageType"] == "system.protocolError"
    assert event["payload"]["error"]["code"] == RuntimeErrorCode.TRANSPORT_FAILURE.value
    assert "RUNTIME_FRAMING_FAILURE" in diagnostic_stream.getvalue()


def test_oversized_frame_is_rejected_before_the_body_is_buffered() -> None:
    transport, _ = build_transport()
    target = io.BytesIO()

    exit_code = transport.serve(
        ChunkedReader([b"Content-Length: 99999999\r\n\r\n"]), target
    )

    assert exit_code == EXIT_TRANSPORT_FAILURE
    assert decode_output(target)[0]["messageType"] == "system.protocolError"


def test_negotiated_frame_limit_is_applied_to_later_frames() -> None:
    transport, _ = build_transport()
    small_limit = 4096
    negotiated_handshake = request_frame(
        "system.handshake",
        {
            "desktopVersion": "0.1.0",
            "protocolVersionRange": {"minimum": 1, "maximum": 1},
            "maximumFrameBytes": small_limit,
        },
        DESKTOP_REQUEST_ID,
    )
    oversized_header = f"Content-Length: {small_limit + 1}\r\n\r\n".encode("ascii")
    target = io.BytesIO()

    exit_code = transport.serve(
        ChunkedReader([negotiated_handshake, oversized_header]), target
    )

    assert exit_code == EXIT_TRANSPORT_FAILURE
    assert decode_output(target)[-1]["messageType"] == "system.protocolError"


def test_standard_output_carries_only_protocol_frames() -> None:
    transport, diagnostic_stream = build_transport()
    target = io.BytesIO()

    transport.serve(
        ChunkedReader(
            [
                handshake_frame(),
                request_frame("system.shutdown", {}, SHUTDOWN_REQUEST_ID),
            ]
        ),
        target,
    )

    decoder = FrameDecoder(FRAME_LIMIT)
    decoder.push(target.getvalue())
    decoder.finish()
    assert diagnostic_stream.getvalue()


def test_runtime_events_stream_while_input_waits_and_cancel_stays_responsive() -> None:
    diagnostic_stream = io.StringIO()
    diagnostics = DiagnosticLog(
        stream=diagnostic_stream,
        minimum_severity=DiagnosticSeverity.DEBUG,
    )
    service = RuntimeService(
        runtime_mode=RuntimeMode.SOURCE,
        monotonic_milliseconds=lambda: 0,
        run_id_factory=lambda: RUN_ID,
    )
    transport = StdioTransport(service, diagnostics)
    target = RecordingWriter()
    source = CoordinatedRuntimeReader(target)

    exit_code = transport.serve(source, target)

    assert exit_code == EXIT_SUCCESS
    assert source.observed_runtime_event_while_waiting
    messages = decode_output(target)
    message_types = [message["messageType"] for message in messages]
    start_response = message_types.index("run.start")
    running_event = next(
        index
        for index, message in enumerate(messages)
        if message["messageType"] == "run.stateChanged"
        and message["payload"]["state"] == "running"
    )
    cancel_response = message_types.index("run.cancel")
    cancelling_event = next(
        index
        for index, message in enumerate(messages)
        if message["messageType"] == "run.stateChanged"
        and message["payload"]["state"] == "cancelling"
    )
    terminal_event = next(
        message
        for message in messages
        if message["messageType"] == "run.stateChanged"
        and message["payload"]["state"] == "cancelled"
    )
    assert start_response < running_event
    assert cancel_response < cancelling_event
    assert terminal_event["runId"] == str(RUN_ID)


def test_transport_carries_persistent_initial_values_and_terminal_updates() -> None:
    diagnostic_stream = io.StringIO()
    diagnostics = DiagnosticLog(
        stream=diagnostic_stream,
        minimum_severity=DiagnosticSeverity.DEBUG,
    )
    service = RuntimeService(
        runtime_mode=RuntimeMode.SOURCE,
        monotonic_milliseconds=lambda: 0,
        run_id_factory=lambda: RUN_ID,
    )
    transport = StdioTransport(service, diagnostics)
    target = RecordingWriter()

    assert transport.serve(PersistentRuntimeReader(target), target) == EXIT_SUCCESS
    messages = decode_output(target)
    running = next(
        message
        for message in messages
        if message["messageType"] == "run.stateChanged"
        and message["payload"]["state"] == "running"
    )
    cancelling = next(
        message
        for message in messages
        if message["messageType"] == "run.stateChanged"
        and message["payload"]["state"] == "cancelling"
    )
    terminal = next(
        message
        for message in messages
        if message["messageType"] == "run.stateChanged"
        and message["payload"]["state"] == "cancelled"
    )
    assert "persistentVariableUpdates" not in running["payload"]
    assert "persistentVariableUpdates" not in cancelling["payload"]
    assert terminal["payload"]["persistentVariableUpdates"] == [
        {
            "variableId": PERSISTENT_VARIABLE_ID,
            "valueKind": "number",
            "value": 8.75,
        }
    ]
