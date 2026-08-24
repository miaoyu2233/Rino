"""Immutable scheduler state, event, value, limit, and failure models."""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Protocol
from uuid import UUID

from rino_runtime.nodes.execution import RuntimeLogLevel, RuntimeValue
from rino_runtime.nodes.variables import PersistentVariableUpdate


class RunStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SchedulerEventKind(StrEnum):
    RUN_STARTED = "run.started"
    NODE_STARTED = "node.started"
    NODE_COMPLETED = "node.completed"
    NODE_FAILED = "node.failed"
    EDGE_TRAVERSED = "edge.traversed"
    RUN_SUCCEEDED = "run.succeeded"
    RUN_FAILED = "run.failed"
    RUN_CANCELLED = "run.cancelled"


class SchedulerFailureCode(StrEnum):
    ENTRY_NODE_MISSING = "SCHEDULER_ENTRY_NODE_MISSING"
    NODE_DEFINITION_MISSING = "SCHEDULER_NODE_DEFINITION_MISSING"
    NODE_NOT_EXECUTABLE = "SCHEDULER_NODE_NOT_EXECUTABLE"
    NODE_DISABLED_UNSUPPORTED = "SCHEDULER_NODE_DISABLED_UNSUPPORTED"
    BREAKPOINT_UNSUPPORTED = "SCHEDULER_BREAKPOINT_UNSUPPORTED"
    INPUT_UNAVAILABLE = "SCHEDULER_INPUT_UNAVAILABLE"
    LITERAL_UNSUPPORTED = "SCHEDULER_LITERAL_UNSUPPORTED"
    PURE_DEPENDENCY_CYCLE = "SCHEDULER_PURE_DEPENDENCY_CYCLE"
    EXECUTION_CYCLE_UNSUPPORTED = "SCHEDULER_EXECUTION_CYCLE_UNSUPPORTED"
    PURE_DEPTH_LIMIT = "SCHEDULER_PURE_DEPTH_LIMIT"
    STEP_LIMIT = "SCHEDULER_STEP_LIMIT"
    TIME_LIMIT = "SCHEDULER_TIME_LIMIT"
    QUEUE_LIMIT = "SCHEDULER_QUEUE_LIMIT"
    VALUE_LIMIT = "SCHEDULER_VALUE_LIMIT"
    LOG_LIMIT = "SCHEDULER_LOG_LIMIT"
    EVENT_LIMIT = "SCHEDULER_EVENT_LIMIT"
    EXECUTOR_FAILED = "SCHEDULER_EXECUTOR_FAILED"
    EXECUTOR_CONTRACT_VIOLATION = "SCHEDULER_EXECUTOR_CONTRACT_VIOLATION"
    FUNCTION_DOCUMENT_REQUIRED = "SCHEDULER_FUNCTION_DOCUMENT_REQUIRED"
    FUNCTION_TARGET_INVALID = "SCHEDULER_FUNCTION_TARGET_INVALID"
    FUNCTION_RECURSION = "SCHEDULER_FUNCTION_RECURSION"
    FUNCTION_DEPTH_LIMIT = "SCHEDULER_FUNCTION_DEPTH_LIMIT"
    FUNCTION_RETURN_MISSING = "SCHEDULER_FUNCTION_RETURN_MISSING"
    FUNCTION_CALL_FAILED = "SCHEDULER_FUNCTION_CALL_FAILED"
    FUNCTION_INPUT_INVALID = "SCHEDULER_FUNCTION_INPUT_INVALID"
    FUNCTION_RETURN_INVALID = "SCHEDULER_FUNCTION_RETURN_INVALID"
    FUNCTION_ENTRY_NODE_MISSING = "SCHEDULER_FUNCTION_ENTRY_NODE_MISSING"
    FUNCTION_ENTRY_NODE_MULTIPLE = "SCHEDULER_FUNCTION_ENTRY_NODE_MULTIPLE"


@dataclass(frozen=True, slots=True)
class SchedulerLimits:
    max_node_steps: int
    max_duration_seconds: float
    max_queue_size: int
    max_stored_values: int
    max_stored_logs: int
    max_events: int
    max_pure_depth: int
    max_retained_tokens: int | None = None
    max_retained_activations: int | None = None
    max_retained_events: int | None = None
    max_retained_values: int | None = None
    max_retained_logs: int | None = None

    def __post_init__(self) -> None:
        integer_limits = (
            self.max_node_steps,
            self.max_queue_size,
            self.max_stored_values,
            self.max_pure_depth,
        )
        if any(value < 1 for value in integer_limits):
            raise ValueError("Scheduler integer limits must be positive.")
        if self.max_stored_logs < 0:
            raise ValueError("Scheduler log limit cannot be negative.")
        if self.max_events < 2:
            raise ValueError("Scheduler event limit must reserve terminal capacity.")
        retained_positive_limits = (
            self.max_retained_tokens,
            self.max_retained_activations,
            self.max_retained_events,
            self.max_retained_values,
        )
        if any(value is not None and value < 1 for value in retained_positive_limits):
            raise ValueError("Scheduler retained-history limits must be positive.")
        if self.max_retained_logs is not None and self.max_retained_logs < 0:
            raise ValueError("Scheduler retained log limit cannot be negative.")
        retained_pairs = (
            (self.max_retained_tokens, self.max_node_steps),
            (self.max_retained_activations, self.max_node_steps),
            (self.max_retained_events, self.max_events),
            (self.max_retained_values, self.max_stored_values),
            (self.max_retained_logs, self.max_stored_logs),
        )
        if any(
            retained is not None and retained > total
            for retained, total in retained_pairs
        ):
            raise ValueError(
                "Scheduler retained-history limits cannot exceed total limits."
            )
        if not math.isfinite(self.max_duration_seconds):
            raise ValueError("Scheduler duration limit must be finite.")
        if self.max_duration_seconds <= 0:
            raise ValueError("Scheduler duration limit must be positive.")

    @property
    def retained_token_limit(self) -> int:
        return self.max_retained_tokens or self.max_node_steps

    @property
    def retained_activation_limit(self) -> int:
        return self.max_retained_activations or self.max_node_steps

    @property
    def retained_event_limit(self) -> int:
        return self.max_retained_events or self.max_events

    @property
    def retained_value_limit(self) -> int:
        return self.max_retained_values or self.max_stored_values

    @property
    def retained_log_limit(self) -> int:
        return (
            self.max_stored_logs
            if self.max_retained_logs is None
            else self.max_retained_logs
        )


@dataclass(frozen=True, slots=True)
class ExecutionToken:
    token_id: int
    target_node_id: UUID
    parent_token_id: int | None = None
    source_edge_id: UUID | None = None


@dataclass(frozen=True, slots=True)
class NodeActivation:
    activation_id: int
    token_id: int
    frame_id: UUID
    node_id: UUID
    type_key: str
    pure: bool


@dataclass(frozen=True, slots=True)
class StoredValue:
    run_id: UUID
    frame_id: UUID
    node_id: UUID
    port_id: str
    generation: int
    value: RuntimeValue


@dataclass(frozen=True, slots=True)
class StoredLog:
    sequence: int
    run_id: UUID
    activation_id: int
    node_id: UUID
    level: RuntimeLogLevel
    message: str


@dataclass(frozen=True, slots=True)
class SchedulerTerminalError:
    code: str
    message_key: str
    node_id: UUID | None = None
    port_id: str | None = None


@dataclass(frozen=True, slots=True)
class SchedulerEvent:
    sequence: int
    kind: SchedulerEventKind
    run_id: UUID
    token_id: int | None = None
    activation_id: int | None = None
    node_id: UUID | None = None
    edge_id: UUID | None = None
    output_port_id: str | None = None
    output_port_ids: tuple[str, ...] = ()
    error_code: str | None = None


@dataclass(frozen=True, slots=True)
class RunSnapshot:
    run_id: UUID
    graph_id: UUID
    frame_id: UUID
    status: RunStatus
    step_count: int
    tokens_created: int
    tokens: tuple[ExecutionToken, ...]
    activations: tuple[NodeActivation, ...]
    events: tuple[SchedulerEvent, ...]
    values: tuple[StoredValue, ...]
    logs: tuple[StoredLog, ...]
    pure_cache_hits: int
    terminal_error: SchedulerTerminalError | None = None
    persistent_variable_updates: tuple[PersistentVariableUpdate, ...] = ()
    function_return_values: tuple[tuple[str, RuntimeValue], ...] = ()
    stored_value_count: int = 0
    stored_log_count: int = 0


class SchedulerObserver(Protocol):
    def on_event(self, event: SchedulerEvent) -> None: ...

    def on_values_committed(self, values: tuple[StoredValue, ...]) -> None: ...

    def on_logs_committed(self, logs: tuple[StoredLog, ...]) -> None: ...


class NullSchedulerObserver:
    def on_event(self, event: SchedulerEvent) -> None:
        return

    def on_values_committed(self, values: tuple[StoredValue, ...]) -> None:
        return

    def on_logs_committed(self, logs: tuple[StoredLog, ...]) -> None:
        return


class SchedulerFailure(RuntimeError):
    """A bounded failure that never embeds graph values or third-party details."""

    def __init__(
        self,
        code: SchedulerFailureCode,
        *,
        node_id: UUID | None = None,
        port_id: str | None = None,
    ) -> None:
        super().__init__(code.value)
        self.code = code
        self.message_key = f"runtime.schedulerError.{_camel_case(code.value)}"
        self.node_id = node_id
        self.port_id = port_id

    def terminal_error(self) -> SchedulerTerminalError:
        return SchedulerTerminalError(
            code=self.code.value,
            message_key=self.message_key,
            node_id=self.node_id,
            port_id=self.port_id,
        )


@dataclass(frozen=True, slots=True)
class ResolvedInputs:
    values: Mapping[str, RuntimeValue]
    dependency_signature: tuple[tuple[str, UUID, str, int], ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "values", MappingProxyType(dict(self.values)))


def _camel_case(value: str) -> str:
    parts = value.lower().split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])
