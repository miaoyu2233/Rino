"""Bounded normalization for untrusted MaaFramework callback notifications."""

from __future__ import annotations

import time
from collections import OrderedDict, deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from threading import Event, Lock, Thread, current_thread
from typing import Final, cast

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

DEFAULT_MAXIMUM_CALLBACKS: Final[int] = 256
DEFAULT_MAXIMUM_CORRELATIONS: Final[int] = 1_024
DEFAULT_UNMATCHED_GRACE_MILLISECONDS: Final[int] = 1_000
MAXIMUM_ACTIVE_GENERATIONS: Final[int] = 32
MAXIMUM_DIAGNOSTIC_BUCKETS: Final[int] = 64
MAXIMUM_BACKEND_OPERATION_ID: Final[int] = (1 << 63) - 1
MAXIMUM_SAFE_INTEGER: Final[int] = (1 << 53) - 1
DISPATCHER_JOIN_SECONDS: Final[float] = 2.0

_MESSAGE_STATES: Final[dict[str, AutomationOperationState]] = {
    "Controller.Action.Starting": AutomationOperationState.STARTING,
    "Controller.Action.Succeeded": AutomationOperationState.SUCCEEDED,
    "Controller.Action.Failed": AutomationOperationState.FAILED,
    "Tasker.Task.Starting": AutomationOperationState.STARTING,
    "Tasker.Task.Succeeded": AutomationOperationState.SUCCEEDED,
    "Tasker.Task.Failed": AutomationOperationState.FAILED,
}


@dataclass(frozen=True, slots=True)
class MaaCallbackBatch:
    events: tuple[AutomationOperationEvent, ...]
    diagnostics: tuple[AutomationCallbackDiagnostic, ...]


@dataclass(frozen=True, slots=True)
class MaaCallbackStatistics:
    queued_callbacks: int
    bound_operations: int
    active_generations: int
    callbacks_after_close: int


@dataclass(frozen=True, slots=True)
class _PendingCallback:
    backend_generation: int
    callback_sequence: int
    observed_at_milliseconds: int
    source: AutomationOperationSource
    state: AutomationOperationState
    backend_operation_id: int


@dataclass(frozen=True, slots=True)
class _BoundOperation:
    operation_kind: AutomationOperationKind
    correlation: AutomationOperationCorrelation


@dataclass(slots=True)
class _DiagnosticCounter:
    count: int = 0
    latest_callback_sequence: int | None = None


class MaaCallbackHub:
    """Separates native callback threads from bounded Rino runtime events."""

    def __init__(
        self,
        *,
        maximum_callbacks: int = DEFAULT_MAXIMUM_CALLBACKS,
        maximum_correlations: int = DEFAULT_MAXIMUM_CORRELATIONS,
        unmatched_grace_milliseconds: int = DEFAULT_UNMATCHED_GRACE_MILLISECONDS,
        monotonic_milliseconds: Callable[[], int] = lambda: (
            time.monotonic_ns() // 1_000_000
        ),
    ) -> None:
        if maximum_callbacks < 1:
            raise ValueError("The Maa callback queue limit must be positive.")
        if maximum_correlations < 1:
            raise ValueError("The Maa callback correlation limit must be positive.")
        if unmatched_grace_milliseconds < 0:
            raise ValueError("The unmatched callback grace period cannot be negative.")
        self._maximum_callbacks = maximum_callbacks
        self._maximum_correlations = maximum_correlations
        self._unmatched_grace_milliseconds = unmatched_grace_milliseconds
        self._monotonic_milliseconds = monotonic_milliseconds
        self._lock = Lock()
        self._wake = Event()
        self._callbacks: deque[_PendingCallback] = deque()
        self._correlations: OrderedDict[
            tuple[int, AutomationOperationSource, int], _BoundOperation
        ] = OrderedDict()
        self._diagnostics: dict[
            tuple[AutomationCallbackDiagnosticCode, int], _DiagnosticCounter
        ] = {}
        self._active_generations: set[int] = set()
        self._next_generation = 1
        self._next_callback_sequence = 1
        self._event_sink: AutomationRuntimeEventSink | None = None
        self._closed = False
        self._callbacks_after_close = 0
        self._dispatcher = Thread(
            target=self._dispatch_loop,
            name="rino-maa-callback-dispatcher",
            daemon=True,
        )
        self._dispatcher.start()

    def register_generation(self) -> int:
        with self._lock:
            self._ensure_open()
            if len(self._active_generations) >= MAXIMUM_ACTIVE_GENERATIONS:
                raise RuntimeError(
                    "The active Maa callback generation limit was reached."
                )
            generation = self._next_generation
            if generation > MAXIMUM_SAFE_INTEGER:
                raise RuntimeError("The Maa callback generation space was exhausted.")
            self._next_generation += 1
            self._active_generations.add(generation)
            return generation

    def retire_generation(self, backend_generation: int) -> None:
        with self._lock:
            if self._closed:
                return
            self._active_generations.discard(backend_generation)
            stale_keys = [
                key for key in self._correlations if key[0] == backend_generation
            ]
            for key in stale_keys:
                del self._correlations[key]
            if any(
                callback.backend_generation == backend_generation
                for callback in self._callbacks
            ):
                self._wake.set()

    def bind_operation(
        self,
        backend_generation: int,
        source: AutomationOperationSource,
        backend_operation_id: int,
        operation_kind: AutomationOperationKind,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        _validate_operation_id(backend_operation_id)
        with self._lock:
            self._ensure_open()
            if backend_generation not in self._active_generations:
                raise ValueError("The Maa callback generation is no longer active.")
            key = (backend_generation, source, backend_operation_id)
            if key not in self._correlations and (
                len(self._correlations) >= self._maximum_correlations
            ):
                evicted_key, _ = self._correlations.popitem(last=False)
                self._record_diagnostic_locked(
                    AutomationCallbackDiagnosticCode.CORRELATION_OVERFLOW,
                    evicted_key[0],
                    None,
                )
            self._correlations[key] = _BoundOperation(
                operation_kind,
                correlation or AutomationOperationCorrelation(),
            )
            self._correlations.move_to_end(key)
            self._wake.set()

    def receive(
        self,
        backend_generation: int,
        source: AutomationOperationSource,
        message: object,
        details: object,
    ) -> None:
        try:
            self._receive(backend_generation, source, message, details)
        except BaseException:
            self._record_malformed_without_raising(backend_generation)

    def set_event_sink(self, sink: AutomationRuntimeEventSink | None) -> None:
        with self._lock:
            if self._closed:
                return
            self._event_sink = sink
            if sink is not None:
                self._wake.set()

    def drain(self) -> MaaCallbackBatch:
        with self._lock:
            return self._drain_locked(self._monotonic_milliseconds())

    def statistics(self) -> MaaCallbackStatistics:
        with self._lock:
            return MaaCallbackStatistics(
                queued_callbacks=len(self._callbacks),
                bound_operations=len(self._correlations),
                active_generations=len(self._active_generations),
                callbacks_after_close=self._callbacks_after_close,
            )

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._event_sink = None
            self._callbacks.clear()
            self._correlations.clear()
            self._diagnostics.clear()
            self._active_generations.clear()
            self._wake.set()
        if self._dispatcher is not current_thread():
            self._dispatcher.join(timeout=DISPATCHER_JOIN_SECONDS)

    def _receive(
        self,
        backend_generation: int,
        source: AutomationOperationSource,
        message: object,
        details: object,
    ) -> None:
        now = self._monotonic_milliseconds()
        with self._lock:
            if self._closed:
                self._callbacks_after_close = min(
                    self._callbacks_after_close + 1,
                    MAXIMUM_SAFE_INTEGER,
                )
                return
            callback_sequence = self._next_callback_sequence
            if callback_sequence > MAXIMUM_SAFE_INTEGER:
                self._next_callback_sequence = 1
                callback_sequence = 1
            self._next_callback_sequence += 1
            if backend_generation not in self._active_generations:
                self._record_diagnostic_locked(
                    AutomationCallbackDiagnosticCode.STALE_GENERATION,
                    backend_generation,
                    callback_sequence,
                )
                self._wake.set()
                return
            parsed = _parse_callback(source, message, details)
            if parsed is None:
                self._record_diagnostic_locked(
                    AutomationCallbackDiagnosticCode.UNSUPPORTED_CALLBACK,
                    backend_generation,
                    callback_sequence,
                )
                self._wake.set()
                return
            state, backend_operation_id = parsed
            if len(self._callbacks) >= self._maximum_callbacks:
                dropped = self._callbacks.popleft()
                self._record_diagnostic_locked(
                    AutomationCallbackDiagnosticCode.QUEUE_OVERFLOW,
                    dropped.backend_generation,
                    dropped.callback_sequence,
                )
            self._callbacks.append(
                _PendingCallback(
                    backend_generation,
                    callback_sequence,
                    now,
                    source,
                    state,
                    backend_operation_id,
                )
            )
            self._wake.set()

    def _record_malformed_without_raising(self, backend_generation: int) -> None:
        try:
            with self._lock:
                if self._closed:
                    self._callbacks_after_close = min(
                        self._callbacks_after_close + 1,
                        MAXIMUM_SAFE_INTEGER,
                    )
                    return
                self._record_diagnostic_locked(
                    AutomationCallbackDiagnosticCode.MALFORMED_CALLBACK,
                    backend_generation,
                    None,
                )
                self._wake.set()
        except BaseException:
            return

    def _drain_locked(self, now: int) -> MaaCallbackBatch:
        events: list[AutomationOperationEvent] = []
        waiting: deque[_PendingCallback] = deque()
        while self._callbacks:
            callback = self._callbacks.popleft()
            if callback.backend_generation not in self._active_generations:
                self._record_diagnostic_locked(
                    AutomationCallbackDiagnosticCode.STALE_GENERATION,
                    callback.backend_generation,
                    callback.callback_sequence,
                )
                continue
            key = (
                callback.backend_generation,
                callback.source,
                callback.backend_operation_id,
            )
            bound = self._correlations.get(key)
            if bound is None:
                age = max(0, now - callback.observed_at_milliseconds)
                if age < self._unmatched_grace_milliseconds:
                    waiting.append(callback)
                else:
                    self._record_diagnostic_locked(
                        AutomationCallbackDiagnosticCode.UNMATCHED_OPERATION,
                        callback.backend_generation,
                        callback.callback_sequence,
                    )
                continue
            events.append(
                AutomationOperationEvent(
                    source=callback.source,
                    state=callback.state,
                    operation_kind=bound.operation_kind,
                    backend_operation_id=callback.backend_operation_id,
                    backend_generation=callback.backend_generation,
                    callback_sequence=callback.callback_sequence,
                    observed_at_milliseconds=callback.observed_at_milliseconds,
                    correlation=bound.correlation,
                )
            )
            if callback.state is not AutomationOperationState.STARTING:
                self._correlations.pop(key, None)
        self._callbacks = waiting
        diagnostics = tuple(
            AutomationCallbackDiagnostic(
                code=code,
                count=counter.count,
                backend_generation=generation,
                latest_callback_sequence=counter.latest_callback_sequence,
            )
            for (code, generation), counter in self._diagnostics.items()
        )
        self._diagnostics.clear()
        return MaaCallbackBatch(tuple(events), diagnostics)

    def _record_diagnostic_locked(
        self,
        code: AutomationCallbackDiagnosticCode,
        backend_generation: int,
        callback_sequence: int | None,
    ) -> None:
        key = (code, backend_generation)
        if key not in self._diagnostics and (
            len(self._diagnostics) >= MAXIMUM_DIAGNOSTIC_BUCKETS
        ):
            key = (code, 0)
        counter = self._diagnostics.setdefault(key, _DiagnosticCounter())
        counter.count = min(counter.count + 1, MAXIMUM_SAFE_INTEGER)
        if callback_sequence is not None:
            counter.latest_callback_sequence = callback_sequence

    def _dispatch_loop(self) -> None:
        timeout = max(0.01, self._unmatched_grace_milliseconds / 2_000)
        while True:
            self._wake.wait(timeout=timeout)
            with self._lock:
                if self._closed:
                    return
                sink = self._event_sink
                if sink is None:
                    self._wake.clear()
                    continue
                batch = self._drain_locked(self._monotonic_milliseconds())
                self._wake.clear()
            for event in (*batch.events, *batch.diagnostics):
                try:
                    sink(event)
                except BaseException:
                    with self._lock:
                        if not self._closed:
                            self._event_sink = None
                            self._record_diagnostic_locked(
                                AutomationCallbackDiagnosticCode.EVENT_SINK_FAILED,
                                event.backend_generation,
                                (
                                    event.callback_sequence
                                    if isinstance(event, AutomationOperationEvent)
                                    else event.latest_callback_sequence
                                ),
                            )

    def _ensure_open(self) -> None:
        if self._closed:
            raise RuntimeError("The Maa callback hub is closed.")


def _parse_callback(
    source: AutomationOperationSource,
    message: object,
    details: object,
) -> tuple[AutomationOperationState, int] | None:
    if not isinstance(message, str) or not isinstance(details, Mapping):
        raise TypeError("The Maa callback shape is invalid.")
    state = _MESSAGE_STATES.get(message)
    if state is None:
        return None
    if source is AutomationOperationSource.CONTROLLER:
        if not message.startswith("Controller.Action."):
            return None
        operation_id = details.get("ctrl_id")
    elif source is AutomationOperationSource.TASKER:
        if not message.startswith("Tasker.Task."):
            return None
        operation_id = details.get("task_id")
    else:
        raise TypeError("The Maa callback source is invalid.")
    _validate_operation_id(operation_id)
    return state, cast(int, operation_id)


def _validate_operation_id(value: object) -> None:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= MAXIMUM_BACKEND_OPERATION_ID
    ):
        raise ValueError("The Maa callback operation identifier is invalid.")
