"""Application-level tests for graph validation, execution, and cancellation."""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any, Final
from uuid import UUID

import pytest

from rino_runtime.application import (
    DEFAULT_SCHEDULER_LIMITS,
    RuntimeApplication,
    RuntimeApplicationEvent,
    RuntimeRequestFailure,
)
from rino_runtime.application.value_summary import summarize_stored_value
from rino_runtime.contracts import is_valid_registry_snapshot
from rino_runtime.contracts.generated.rino_diagnostics_v1 import (
    RinoGraphDiagnosticReportV1,
)
from rino_runtime.errors import RuntimeErrorCode
from rino_runtime.nodes import RuntimeImageReference
from rino_runtime.scheduler import StoredValue

DOCUMENT_ID: Final[str] = "10000000-0000-4000-8000-000000000001"
GRAPH_ID: Final[str] = "10000000-0000-4000-8000-000000000002"
START_ID: Final[str] = "10000000-0000-4000-8000-000000000003"
ACTION_ID: Final[str] = "10000000-0000-4000-8000-000000000004"
EDGE_ID: Final[str] = "10000000-0000-4000-8000-000000000005"
STOP_ID: Final[str] = "10000000-0000-4000-8000-000000000007"
PERSISTENT_NUMBER_ID: Final[str] = "10000000-0000-4000-8000-000000000008"
FUNCTION_GRAPH_ID: Final[str] = "10000000-0000-4000-8000-000000000010"
FUNCTION_INPUT_ID: Final[str] = "10000000-0000-4000-8000-000000000011"
FUNCTION_RETURN_ID: Final[str] = "10000000-0000-4000-8000-000000000012"
FUNCTION_CALL_ID: Final[str] = "10000000-0000-4000-8000-000000000013"
FUNCTION_STOP_ID: Final[str] = "10000000-0000-4000-8000-000000000014"
RUN_ID: Final[UUID] = UUID("10000000-0000-4000-8000-000000000006")


def test_default_scheduler_budget_supports_bounded_long_runs() -> None:
    limits = DEFAULT_SCHEDULER_LIMITS

    assert limits.max_node_steps == 250_000
    assert limits.max_duration_seconds == 21_600
    assert limits.max_events == 1_000_000
    assert limits.max_stored_values == 500_000
    assert limits.max_stored_logs == 50_000
    assert limits.retained_token_limit == 20_000
    assert limits.retained_activation_limit == 20_000
    assert limits.retained_event_limit == 50_000
    assert limits.retained_value_limit == 20_000
    assert limits.retained_log_limit == 10_000


def _node(
    node_id: str,
    type_key: str,
    *,
    input_values: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "nodeId": node_id,
        "typeKey": type_key,
        "typeVersion": 1,
        "position": {"x": 0, "y": 0},
        "properties": {},
        "inputValues": input_values or {},
    }


def _document(
    action_type: str = "core.diagnostic.log",
    *,
    action_inputs: dict[str, object] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "documentId": DOCUMENT_ID,
        "metadata": {
            "name": "Runtime application test",
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
                    _node(START_ID, "core.flow.start"),
                    _node(
                        ACTION_ID,
                        action_type,
                        input_values=action_inputs
                        if action_inputs is not None
                        else {"message": "runtime message"},
                    ),
                ],
                "edges": [
                    {
                        "edgeId": EDGE_ID,
                        "edgeKind": "execution",
                        "sourceNodeId": START_ID,
                        "sourcePortId": "next",
                        "targetNodeId": ACTION_ID,
                        "targetPortId": "run",
                    }
                ],
            }
        ],
        "assets": [],
        "requiredCapabilities": [],
    }


def _persistent_document() -> dict[str, Any]:
    document = _document()
    graph = document["graphs"][0]
    graph["variables"] = [
        {
            "variableId": PERSISTENT_NUMBER_ID,
            "name": "remembered-number",
            "valueKind": "number",
            "persistent": True,
        }
    ]
    graph["nodes"][1] = _node(
        ACTION_ID,
        "core.variable.setNumber",
        input_values={"value": 4.5},
    )
    graph["nodes"][1]["properties"] = {"variableId": PERSISTENT_NUMBER_ID}
    graph["nodes"].append(_node(STOP_ID, "core.flow.stop"))
    graph["edges"] = [
        {
            "edgeId": EDGE_ID,
            "edgeKind": "execution",
            "sourceNodeId": START_ID,
            "sourcePortId": "next",
            "targetNodeId": ACTION_ID,
            "targetPortId": "run",
        },
        {
            "edgeId": "10000000-0000-4000-8000-000000000009",
            "edgeKind": "execution",
            "sourceNodeId": ACTION_ID,
            "sourcePortId": "next",
            "targetNodeId": STOP_ID,
            "targetPortId": "run",
        },
    ]
    return document


def _persistent_delay_document() -> dict[str, Any]:
    document = _persistent_document()
    graph = document["graphs"][0]
    graph["nodes"][2] = _node(
        STOP_ID,
        "core.time.delay",
        input_values={"durationMilliseconds": 60_000},
    )
    return document


def _persistent_failure_document() -> dict[str, Any]:
    document = _persistent_document()
    graph = document["graphs"][0]
    graph["nodes"][2] = _node(
        STOP_ID,
        "core.diagnostic.log",
        input_values={"numberPart1": None},
    )
    graph["nodes"][2]["properties"] = {"segmentKinds": ["number"]}
    return document


def _function_document_with_entry_call() -> dict[str, Any]:
    document = _document()
    document["graphs"][0] = {
        "graphId": GRAPH_ID,
        "name": "Main entry",
        "kind": "entry",
        "nodes": [
            _node(START_ID, "core.flow.start"),
            _node(
                FUNCTION_CALL_ID,
                "core.function.call",
            ),
            _node(FUNCTION_STOP_ID, "core.flow.stop"),
        ],
        "edges": [
            {
                "edgeId": EDGE_ID,
                "edgeKind": "execution",
                "sourceNodeId": START_ID,
                "sourcePortId": "next",
                "targetNodeId": FUNCTION_CALL_ID,
                "targetPortId": "run",
            },
            {
                "edgeId": "10000000-0000-4000-8000-000000000015",
                "edgeKind": "execution",
                "sourceNodeId": FUNCTION_CALL_ID,
                "sourcePortId": "next",
                "targetNodeId": FUNCTION_STOP_ID,
                "targetPortId": "run",
            },
        ],
    }
    document["graphs"][0]["nodes"][1]["properties"] = {
        "functionGraphId": FUNCTION_GRAPH_ID,
    }
    document["graphs"].append(
        {
            "graphId": FUNCTION_GRAPH_ID,
            "name": "Function target",
            "kind": "function",
            "functionSignature": {"inputs": [], "outputs": []},
            "nodes": [
                _node(FUNCTION_INPUT_ID, "core.function.input"),
                _node(FUNCTION_RETURN_ID, "core.function.return"),
            ],
            "edges": [
                {
                    "edgeId": "10000000-0000-4000-8000-000000000016",
                    "edgeKind": "execution",
                    "sourceNodeId": FUNCTION_INPUT_ID,
                    "sourcePortId": "next",
                    "targetNodeId": FUNCTION_RETURN_ID,
                    "targetPortId": "run",
                }
            ],
        }
    )
    return document


class EventRecorder:
    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._events: list[RuntimeApplicationEvent] = []

    @property
    def events(self) -> tuple[RuntimeApplicationEvent, ...]:
        with self._condition:
            return tuple(self._events)

    def record(self, event: RuntimeApplicationEvent) -> None:
        with self._condition:
            self._events.append(event)
            self._condition.notify_all()

    def wait_for(
        self,
        predicate: Callable[[RuntimeApplicationEvent], bool],
        *,
        timeout: float = 1.0,
    ) -> RuntimeApplicationEvent:
        with self._condition:
            matched = self._find(predicate)
            if matched is not None:
                return matched
            awakened = self._condition.wait_for(
                lambda: self._find(predicate) is not None,
                timeout=timeout,
            )
            if not awakened:
                raise AssertionError("Timed out waiting for a runtime event.")
            matched = self._find(predicate)
            assert matched is not None
            return matched

    def _find(
        self,
        predicate: Callable[[RuntimeApplicationEvent], bool],
    ) -> RuntimeApplicationEvent | None:
        return next((event for event in self._events if predicate(event)), None)


def _application(recorder: EventRecorder) -> RuntimeApplication:
    return RuntimeApplication(
        recorder.record,
        run_id_factory=lambda: RUN_ID,
    )


def _terminal(event: RuntimeApplicationEvent) -> bool:
    return event.message_type == "run.stateChanged" and event.payload["state"] in {
        "succeeded",
        "failed",
        "cancelled",
    }


def test_registry_and_validation_results_use_authoritative_contracts() -> None:
    recorder = EventRecorder()
    application = _application(recorder)

    registry_result = application.registry_result()
    validation_result = application.validate_document(_document())

    assert is_valid_registry_snapshot(registry_result["registry"])
    assert validation_result["executable"] is True
    RinoGraphDiagnosticReportV1.model_validate(validation_result["report"])
    assert application.close()


def test_invalid_document_and_non_executable_graph_are_distinct_failures() -> None:
    recorder = EventRecorder()
    application = _application(recorder)

    with pytest.raises(RuntimeRequestFailure) as malformed:
        application.validate_document({"schemaVersion": 1})
    assert malformed.value.code is RuntimeErrorCode.GRAPH_DOCUMENT_INVALID

    document = _document()
    document["graphs"][0]["nodes"][1]["inputValues"] = {}
    with pytest.raises(RuntimeRequestFailure) as blocked:
        application.prepare_run(document, UUID(GRAPH_ID), None)
    assert blocked.value.code is RuntimeErrorCode.GRAPH_NOT_EXECUTABLE
    assert application.close()


def test_function_prepare_run_rejects_direct_function_graph_but_accepts_entry() -> None:
    recorder = EventRecorder()
    application = _application(recorder)
    document = _function_document_with_entry_call()

    with pytest.raises(RuntimeRequestFailure) as blocked:
        application.prepare_run(document, UUID(FUNCTION_GRAPH_ID), None)
    assert blocked.value.code is RuntimeErrorCode.GRAPH_NOT_EXECUTABLE

    prepared = application.prepare_run(document, UUID(GRAPH_ID), None)
    assert prepared.graph_id == UUID(GRAPH_ID)
    assert application.close()


def test_function_entry_run_uses_frozen_document_and_completes_call() -> None:
    recorder = EventRecorder()
    application = _application(recorder)
    prepared = application.prepare_run(
        _function_document_with_entry_call(), UUID(GRAPH_ID), None
    )

    prepared.launch()
    terminal = recorder.wait_for(_terminal)

    assert terminal.payload["state"] == "succeeded"
    assert terminal.payload["graphId"] == GRAPH_ID
    assert application.close()


def test_run_emits_ordered_node_edge_log_and_terminal_events() -> None:
    recorder = EventRecorder()
    application = _application(recorder)
    prepared = application.prepare_run(_document(), UUID(GRAPH_ID), None)

    prepared.launch()
    terminal = recorder.wait_for(_terminal)

    assert terminal.payload["state"] == "succeeded"
    assert terminal.payload["persistentVariableUpdates"] == []
    assert terminal.payload["stepCount"] == 2
    event_types = [event.message_type for event in recorder.events]
    assert event_types == [
        "node.stateChanged",
        "node.stateChanged",
        "edge.traversed",
        "node.stateChanged",
        "runtime.logCreated",
        "node.stateChanged",
        "run.stateChanged",
    ]
    assert recorder.events[-2].payload["state"] == "succeeded"
    assert recorder.events[-3].payload["message"] == "runtime message"
    assert application.close()


def test_only_one_run_can_be_active() -> None:
    recorder = EventRecorder()
    application = _application(recorder)
    application.prepare_run(_document(), UUID(GRAPH_ID), None)

    with pytest.raises(RuntimeRequestFailure) as caught:
        application.prepare_run(_document(), UUID(GRAPH_ID), None)

    assert caught.value.code is RuntimeErrorCode.RUN_ALREADY_ACTIVE
    assert application.close()


def test_cancellation_interrupts_delay_and_remains_idempotent() -> None:
    recorder = EventRecorder()
    application = _application(recorder)
    prepared = application.prepare_run(
        _document(
            "core.time.delay",
            action_inputs={"durationMilliseconds": 60_000},
        ),
        UUID(GRAPH_ID),
        "device-session-key",
    )
    prepared.launch()
    recorder.wait_for(
        lambda event: (
            event.message_type == "node.stateChanged"
            and event.node_id == UUID(ACTION_ID)
            and event.payload["state"] == "running"
        )
    )

    first = application.prepare_cancellation(RUN_ID)
    assert not first.already_requested
    assert first.state == "cancelling"
    assert first.signal is not None
    first.signal()
    terminal = recorder.wait_for(_terminal)
    assert terminal.payload["state"] == "cancelled"
    assert terminal.payload["persistentVariableUpdates"] == []

    repeated = application.prepare_cancellation(RUN_ID)
    assert repeated.already_requested
    assert repeated.state == "cancelled"
    assert repeated.signal is None
    assert application.close()


def test_run_start_initial_value_and_terminal_persistent_update_are_forwarded() -> None:
    recorder = EventRecorder()
    application = _application(recorder)
    prepared = application.prepare_run(
        _persistent_document(),
        UUID(GRAPH_ID),
        None,
        initial_persistent_variables=[
            {
                "variableId": PERSISTENT_NUMBER_ID,
                "valueKind": "number",
                "value": 2.25,
            }
        ],
    )

    prepared.launch()
    terminal = recorder.wait_for(_terminal)

    assert terminal.payload["state"] == "succeeded"
    assert terminal.payload["persistentVariableUpdates"] == [
        {
            "variableId": PERSISTENT_NUMBER_ID,
            "valueKind": "number",
            "value": 4.5,
        }
    ]
    assert application.close()


def test_project_persistent_variables_are_used_for_run_initial_values() -> None:
    recorder = EventRecorder()
    application = _application(recorder)
    document = _persistent_document()
    graph = document["graphs"][0]
    document["variables"] = graph.pop("variables")
    prepared = application.prepare_run(
        document,
        UUID(GRAPH_ID),
        None,
        initial_persistent_variables=[
            {
                "variableId": PERSISTENT_NUMBER_ID,
                "valueKind": "number",
                "value": 2.25,
            }
        ],
    )

    prepared.launch()
    terminal = recorder.wait_for(_terminal)

    assert terminal.payload["state"] == "succeeded"
    assert terminal.payload["persistentVariableUpdates"] == [
        {
            "variableId": PERSISTENT_NUMBER_ID,
            "valueKind": "number",
            "value": 4.5,
        }
    ]
    assert application.close()


def test_failed_run_keeps_persistent_updates_written_before_downstream_failure() -> (
    None
):
    recorder = EventRecorder()
    application = _application(recorder)
    prepared = application.prepare_run(
        _persistent_failure_document(), UUID(GRAPH_ID), None
    )

    prepared.launch()
    terminal = recorder.wait_for(_terminal)

    assert terminal.payload["state"] == "failed"
    assert terminal.payload["terminalError"]["code"] == "NODE_INPUT_TYPE_INVALID"
    assert terminal.payload["persistentVariableUpdates"] == [
        {
            "variableId": PERSISTENT_NUMBER_ID,
            "valueKind": "number",
            "value": 4.5,
        }
    ]
    assert application.close()


def test_cancelled_run_keeps_persistent_updates_written_before_cancellation() -> None:
    recorder = EventRecorder()
    application = _application(recorder)
    prepared = application.prepare_run(
        _persistent_delay_document(), UUID(GRAPH_ID), None
    )
    prepared.launch()
    recorder.wait_for(
        lambda event: (
            event.message_type == "node.stateChanged"
            and event.node_id == UUID(STOP_ID)
            and event.payload["state"] == "running"
        )
    )

    cancellation = application.prepare_cancellation(RUN_ID)
    assert cancellation.signal is not None
    cancellation.signal()
    terminal = recorder.wait_for(_terminal)

    assert terminal.payload["state"] == "cancelled"
    assert terminal.payload["persistentVariableUpdates"] == [
        {
            "variableId": PERSISTENT_NUMBER_ID,
            "valueKind": "number",
            "value": 4.5,
        }
    ]
    assert application.close()


@pytest.mark.parametrize(
    "initial_values",
    [
        [
            {
                "variableId": PERSISTENT_NUMBER_ID,
                "valueKind": "string",
                "value": "wrong-kind",
            }
        ],
        [
            {
                "variableId": "10000000-0000-4000-8000-000000000099",
                "valueKind": "number",
                "value": 1.0,
            }
        ],
    ],
)
def test_invalid_initial_persistent_values_fail_before_run_start(
    initial_values: list[dict[str, object]],
) -> None:
    recorder = EventRecorder()
    application = _application(recorder)

    with pytest.raises(RuntimeRequestFailure) as caught:
        application.prepare_run(
            _persistent_document(),
            UUID(GRAPH_ID),
            None,
            initial_persistent_variables=initial_values,
        )

    assert caught.value.code is RuntimeErrorCode.GRAPH_DOCUMENT_INVALID
    assert application.close()


def test_unknown_run_cannot_be_cancelled() -> None:
    recorder = EventRecorder()
    application = _application(recorder)

    with pytest.raises(RuntimeRequestFailure) as caught:
        application.prepare_cancellation(RUN_ID)

    assert caught.value.code is RuntimeErrorCode.RUN_NOT_FOUND
    assert application.close()


def test_value_summaries_are_bounded_and_do_not_expose_image_handles() -> None:
    text_summary = summarize_stored_value(
        StoredValue(
            run_id=RUN_ID,
            frame_id=UUID(DOCUMENT_ID),
            node_id=UUID(ACTION_ID),
            port_id="value",
            generation=1,
            value="x" * 300,
        )
    )
    image_summary = summarize_stored_value(
        StoredValue(
            run_id=RUN_ID,
            frame_id=UUID(DOCUMENT_ID),
            node_id=UUID(ACTION_ID),
            port_id="value",
            generation=1,
            value=RuntimeImageReference(
                handle_id="private-image-handle",
                width=1920,
                height=1080,
                coordinate_space_id="private-coordinate-space",
                generation=2,
                expires_at_monotonic=123.0,
            ),
        )
    )

    assert len(str(text_summary["preview"])) == 256
    assert text_summary["truncated"] is True
    assert image_summary == {
        "portId": "value",
        "generation": 1,
        "kind": "image",
        "preview": "1920 x 1080",
        "truncated": False,
        "width": 1920,
        "height": 1080,
    }
    assert "private-image-handle" not in repr(image_summary)
