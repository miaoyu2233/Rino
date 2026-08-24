"""Concurrency, redaction, generation, and IPC tests for Maa callback normalization."""

from __future__ import annotations

import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import cast
from uuid import UUID

from rino_runtime.backends.base import (
    AutomationCallbackDiagnostic,
    AutomationCallbackDiagnosticCode,
    AutomationOperationCorrelation,
    AutomationOperationEvent,
    AutomationOperationKind,
    AutomationOperationSource,
    AutomationOperationState,
    AutomationRuntimeEventSink,
)
from rino_runtime.backends.maa.binding import _OfficialMaaEventSink
from rino_runtime.backends.maa.callbacks import MaaCallbackHub
from rino_runtime.contracts import dump_model, is_valid_message
from rino_runtime.service import RuntimeMode, RuntimeService, encode_outgoing

REQUEST_ID = UUID("91000000-0000-4000-8000-000000000001")
RUN_ID = UUID("91000000-0000-4000-8000-000000000002")
NODE_ID = UUID("91000000-0000-4000-8000-000000000003")


class _Clock:
    def __init__(self) -> None:
        self.value = 0

    def __call__(self) -> int:
        return self.value


class _OperationEventSource:
    def __init__(self) -> None:
        self.sink: AutomationRuntimeEventSink | None = None

    def set_operation_event_sink(
        self,
        sink: AutomationRuntimeEventSink | None,
    ) -> None:
        self.sink = sink


def _correlation() -> AutomationOperationCorrelation:
    return AutomationOperationCorrelation(
        request_id=REQUEST_ID,
        run_id=RUN_ID,
        node_id=NODE_ID,
        activation_id=7,
    )


def test_callback_before_binding_is_correlated_without_exposing_raw_details() -> None:
    clock = _Clock()
    hub = MaaCallbackHub(monotonic_milliseconds=clock)
    generation = hub.register_generation()
    hub.receive(
        generation,
        AutomationOperationSource.CONTROLLER,
        "Controller.Action.Starting",
        {
            "ctrl_id": 41,
            "uuid": "private-device-identity",
            "action": "private-action-name",
            "param": {"private": "value"},
            "info": {"path": "C:/private/path"},
        },
    )

    assert hub.drain().events == ()
    hub.bind_operation(
        generation,
        AutomationOperationSource.CONTROLLER,
        41,
        AutomationOperationKind.CLICK,
        _correlation(),
    )
    batch = hub.drain()

    assert batch.events == (
        AutomationOperationEvent(
            source=AutomationOperationSource.CONTROLLER,
            state=AutomationOperationState.STARTING,
            operation_kind=AutomationOperationKind.CLICK,
            backend_operation_id=41,
            backend_generation=generation,
            callback_sequence=1,
            observed_at_milliseconds=0,
            correlation=_correlation(),
        ),
    )
    assert batch.events[0].state.value == "starting"
    serialized = repr(batch)
    assert "private-device-identity" not in serialized
    assert "private-action-name" not in serialized
    assert "C:/private/path" not in serialized
    hub.close()


def test_malformed_and_unsupported_callbacks_become_bounded_diagnostics() -> None:
    hub = MaaCallbackHub(unmatched_grace_milliseconds=0)
    generation = hub.register_generation()

    hub.receive(
        generation,
        AutomationOperationSource.CONTROLLER,
        "Controller.Action.Starting",
        {"ctrl_id": True},
    )
    hub.receive(
        generation,
        AutomationOperationSource.CONTROLLER,
        "Controller.Custom.Starting",
        {"ctrl_id": 2},
    )
    batch = hub.drain()

    assert {diagnostic.code for diagnostic in batch.diagnostics} == {
        AutomationCallbackDiagnosticCode.MALFORMED_CALLBACK,
        AutomationCallbackDiagnosticCode.UNSUPPORTED_CALLBACK,
    }
    assert all(diagnostic.count == 1 for diagnostic in batch.diagnostics)
    hub.close()


def test_native_sink_contains_invalid_json_without_raising_across_callback() -> None:
    received: list[tuple[object, object]] = []
    sink = _OfficialMaaEventSink(
        lambda callback: callback,
        lambda message, details: received.append((message, details)),
    )
    native_callback = cast(Callable[..., None], sink.c_callback)

    native_callback(
        None,
        b"Controller.Action.Starting",
        b"{not-json",
        None,
    )

    assert received == [(None, None)]


def test_queue_and_correlation_limits_drop_work_without_growing() -> None:
    hub = MaaCallbackHub(
        maximum_callbacks=2,
        maximum_correlations=1,
        unmatched_grace_milliseconds=0,
    )
    generation = hub.register_generation()
    hub.bind_operation(
        generation,
        AutomationOperationSource.CONTROLLER,
        1,
        AutomationOperationKind.CLICK,
    )
    hub.bind_operation(
        generation,
        AutomationOperationSource.CONTROLLER,
        2,
        AutomationOperationKind.CLICK,
    )
    for operation_id in (1, 2, 2):
        hub.receive(
            generation,
            AutomationOperationSource.CONTROLLER,
            "Controller.Action.Starting",
            {"ctrl_id": operation_id},
        )

    batch = hub.drain()

    assert len(batch.events) == 2
    assert hub.statistics().queued_callbacks == 0
    codes = {diagnostic.code for diagnostic in batch.diagnostics}
    assert AutomationCallbackDiagnosticCode.CORRELATION_OVERFLOW in codes
    assert AutomationCallbackDiagnosticCode.QUEUE_OVERFLOW in codes
    hub.close()


def test_retired_generation_is_dropped_and_shutdown_is_idempotent() -> None:
    hub = MaaCallbackHub()
    generation = hub.register_generation()
    hub.retire_generation(generation)
    hub.receive(
        generation,
        AutomationOperationSource.TASKER,
        "Tasker.Task.Succeeded",
        {"task_id": 9},
    )

    batch = hub.drain()
    assert batch.events == ()
    assert batch.diagnostics[0].code is (
        AutomationCallbackDiagnosticCode.STALE_GENERATION
    )

    hub.close()
    hub.close()
    hub.receive(
        generation,
        AutomationOperationSource.TASKER,
        "Tasker.Task.Succeeded",
        {"task_id": 9},
    )
    assert hub.statistics().callbacks_after_close == 1


def test_concurrent_callbacks_keep_unique_bounded_sequences() -> None:
    total = 800
    hub = MaaCallbackHub(
        maximum_callbacks=total,
        maximum_correlations=total,
    )
    generation = hub.register_generation()
    for operation_id in range(1, total + 1):
        hub.bind_operation(
            generation,
            AutomationOperationSource.CONTROLLER,
            operation_id,
            AutomationOperationKind.SCREEN_CAPTURE,
        )

    def emit(operation_id: int) -> None:
        hub.receive(
            generation,
            AutomationOperationSource.CONTROLLER,
            "Controller.Action.Succeeded",
            {"ctrl_id": operation_id},
        )

    with ThreadPoolExecutor(max_workers=8) as executor:
        tuple(executor.map(emit, range(1, total + 1)))
    batch = hub.drain()

    assert len(batch.events) == total
    assert len({event.callback_sequence for event in batch.events}) == total
    assert not batch.diagnostics
    hub.close()


def test_dispatcher_never_runs_event_sink_on_native_callback_thread() -> None:
    delivered = threading.Event()
    callback_thread_id = threading.get_ident()
    sink_thread_ids: list[int] = []
    hub = MaaCallbackHub()
    generation = hub.register_generation()
    hub.bind_operation(
        generation,
        AutomationOperationSource.CONTROLLER,
        7,
        AutomationOperationKind.DEVICE_CONNECT,
    )

    def sink(_event: object) -> None:
        sink_thread_ids.append(threading.get_ident())
        delivered.set()

    hub.set_event_sink(sink)
    hub.receive(
        generation,
        AutomationOperationSource.CONTROLLER,
        "Controller.Action.Succeeded",
        {"ctrl_id": 7},
    )

    assert delivered.wait(timeout=1)
    assert sink_thread_ids[0] != callback_thread_id
    hub.close()


def test_runtime_service_serializes_only_the_normalized_operation_model() -> None:
    messages = []
    source = _OperationEventSource()
    service = RuntimeService(
        runtime_mode=RuntimeMode.SOURCE,
        monotonic_milliseconds=lambda: 0,
        async_message_sink=messages.append,
        operation_event_source=source,
    )
    assert source.sink is not None
    sink = source.sink

    sink(
        AutomationOperationEvent(
            source=AutomationOperationSource.TASKER,
            state=AutomationOperationState.SUCCEEDED,
            operation_kind=AutomationOperationKind.OCR,
            backend_operation_id=99,
            backend_generation=3,
            callback_sequence=5,
            observed_at_milliseconds=12,
            correlation=_correlation(),
        )
    )
    sink(
        AutomationCallbackDiagnostic(
            AutomationCallbackDiagnosticCode.QUEUE_OVERFLOW,
            4,
            3,
            8,
        )
    )

    encoded = [encode_outgoing(message) for message in messages]
    assert all(is_valid_message(dump_model(message)) for message in messages)
    assert "private" not in "".join(encoded)
    assert messages[0].message_type == "automation.operationStateChanged"
    assert messages[0].run_id == RUN_ID
    assert messages[0].node_id == NODE_ID
    assert messages[1].message_type == "automation.callbackDiagnostic"
    assert service.close()
    assert source.sink is None


def test_runtime_service_accepts_explicit_android_operation_kinds() -> None:
    messages = []
    source = _OperationEventSource()
    service = RuntimeService(
        runtime_mode=RuntimeMode.SOURCE,
        monotonic_milliseconds=lambda: 0,
        async_message_sink=messages.append,
        operation_event_source=source,
    )
    assert source.sink is not None

    for operation_kind in (
        AutomationOperationKind.KEY_PRESS,
        AutomationOperationKind.APP_START,
    ):
        source.sink(
            AutomationOperationEvent(
                source=AutomationOperationSource.CONTROLLER,
                state=AutomationOperationState.SUCCEEDED,
                operation_kind=operation_kind,
                backend_operation_id=1,
                backend_generation=1,
                callback_sequence=1,
                observed_at_milliseconds=0,
                correlation=_correlation(),
            )
        )

    assert all(is_valid_message(dump_model(message)) for message in messages)
    assert [
        dump_model(message)["payload"]["operationKind"] for message in messages
    ] == [
        "keyPress",
        "appStart",
    ]
    assert service.close()
