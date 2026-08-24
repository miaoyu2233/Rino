"""Typed node-executor boundary shared by core and automation nodes."""

from __future__ import annotations

import math
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import TYPE_CHECKING, Protocol, cast
from uuid import UUID

from rino_runtime.backends.base import AutomationOperationCorrelation
from rino_runtime.contracts.generated.rino_registry_v1 import (
    CollectionTypeV1,
    OptionalTypeV1,
    PrimitiveTypeKindV1,
    TypeDescriptorV1,
)
from rino_runtime.execution_control.cancellation import (
    CancellationProbe,
    NeverCancelled,
)

if TYPE_CHECKING:
    from rino_runtime.nodes.variables import RuntimeVariableAccess


@dataclass(frozen=True, slots=True)
class RuntimePoint:
    x: int
    y: int
    coordinate_space_id: str | None = None
    source_generation: int | None = None


@dataclass(frozen=True, slots=True)
class RuntimeRect:
    x: int
    y: int
    width: int
    height: int
    coordinate_space_id: str | None = None
    source_generation: int | None = None


@dataclass(frozen=True, slots=True)
class RuntimeImageReference:
    handle_id: str
    width: int
    height: int
    coordinate_space_id: str
    generation: int
    expires_at_monotonic: float


@dataclass(frozen=True, slots=True)
class RuntimeOcrCandidate:
    text: str
    confidence: float
    rect: RuntimeRect


@dataclass(frozen=True, slots=True)
class RuntimeOcrResult:
    candidates: tuple[RuntimeOcrCandidate, ...]
    matched: bool
    source_generation: int
    source_coordinate_space_id: str
    operation_id: int


@dataclass(frozen=True, slots=True)
class RuntimeMatchCandidate:
    metric: float
    rect: RuntimeRect


@dataclass(frozen=True, slots=True)
class RuntimeMatchResult:
    candidates: tuple[RuntimeMatchCandidate, ...]
    matched: bool
    source_generation: int
    source_coordinate_space_id: str
    operation_id: int


type RuntimeValue = (
    bool
    | int
    | float
    | str
    | RuntimePoint
    | RuntimeRect
    | RuntimeImageReference
    | RuntimeOcrCandidate
    | RuntimeOcrResult
    | tuple[RuntimeValue, ...]
    | None
)


def _empty_runtime_values() -> Mapping[str, RuntimeValue]:
    return {}


def _empty_project_assets() -> Mapping[str, RuntimeImageReference]:
    return {}


def _empty_dynamic_port_state() -> Mapping[str, object]:
    return {}


@dataclass(frozen=True, slots=True)
class NodeActivationTiming:
    activation_count: int
    first_started_at_monotonic: float
    previous_started_at_monotonic: float | None
    current_started_at_monotonic: float

    def __post_init__(self) -> None:
        if self.activation_count < 1:
            raise ValueError("Node activation count must be positive.")
        timestamps = (
            self.first_started_at_monotonic,
            self.current_started_at_monotonic,
        )
        if not all(math.isfinite(value) for value in timestamps):
            raise ValueError("Node activation timestamps must be finite.")
        if self.current_started_at_monotonic < self.first_started_at_monotonic:
            raise ValueError("Current activation cannot precede the first activation.")
        previous = self.previous_started_at_monotonic
        if previous is not None and (
            not math.isfinite(previous)
            or previous < self.first_started_at_monotonic
            or previous > self.current_started_at_monotonic
        ):
            raise ValueError("Previous activation timestamp is out of order.")


class RuntimeLogLevel(StrEnum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class RuntimeLogEntry:
    level: RuntimeLogLevel
    message: str


class NodeExecutionFailureCode(StrEnum):
    INPUT_MISSING = "NODE_INPUT_MISSING"
    INPUT_TYPE_INVALID = "NODE_INPUT_TYPE_INVALID"
    PROPERTY_MISSING = "NODE_PROPERTY_MISSING"
    PROPERTY_INVALID = "NODE_PROPERTY_INVALID"
    REFERENCE_RESOLUTION_MISMATCH = "NODE_REFERENCE_RESOLUTION_MISMATCH"
    COORDINATE_OUT_OF_BOUNDS = "NODE_COORDINATE_OUT_OF_BOUNDS"
    DEVICE_NOT_BOUND = "NODE_DEVICE_NOT_BOUND"
    CAPABILITY_UNAVAILABLE = "NODE_CAPABILITY_UNAVAILABLE"
    PROJECT_ASSET_UNAVAILABLE = "NODE_PROJECT_ASSET_UNAVAILABLE"
    ACTION_FAILED = "NODE_ACTION_FAILED"
    ACTION_OUTCOME_UNKNOWN = "NODE_ACTION_OUTCOME_UNKNOWN"
    CANCELLED = "NODE_CANCELLED"
    VARIABLE_UNINITIALIZED = "VARIABLE_UNINITIALIZED"


class NodeExecutionFailure(RuntimeError):
    """A bounded executor failure suitable for scheduler error mapping."""

    def __init__(
        self,
        code: NodeExecutionFailureCode,
        *,
        parameter_name: str | None = None,
        can_follow_failure_output: bool = False,
    ) -> None:
        if (
            can_follow_failure_output
            and code is not NodeExecutionFailureCode.ACTION_FAILED
        ):
            raise ValueError(
                "Only a confirmed action failure can follow a failure output."
            )
        super().__init__(code.value)
        self.code = code
        self.can_follow_failure_output = can_follow_failure_output
        self.message_key = f"runtime.nodeError.{_camel_case(code.value)}"
        self.parameters: Mapping[str, str] = MappingProxyType(
            {"parameterName": parameter_name} if parameter_name is not None else {}
        )


@dataclass(frozen=True, slots=True)
class NodeExecutionContext:
    node_id: UUID
    type_key: str
    request_id: UUID | None = None
    run_id: UUID | None = None
    activation_id: int | None = None
    device_key: str | None = None
    inputs: Mapping[str, RuntimeValue] = field(default_factory=_empty_runtime_values)
    properties: Mapping[str, RuntimeValue] = field(
        default_factory=_empty_runtime_values
    )
    # Frozen authoring state for nodes whose visible ports are data-driven.
    dynamic_port_state: Mapping[str, object] = field(
        default_factory=_empty_dynamic_port_state
    )
    project_assets: Mapping[str, RuntimeImageReference] = field(
        default_factory=_empty_project_assets
    )
    variable_access: RuntimeVariableAccess | None = None
    cancellation: CancellationProbe = field(default_factory=NeverCancelled)
    activation_timing: NodeActivationTiming | None = None
    monotonic_now: Callable[[], float] = field(
        default=time.monotonic,
        repr=False,
        compare=False,
    )

    def __post_init__(self) -> None:
        if self.activation_id is not None and self.activation_id < 1:
            raise ValueError("A node activation identifier must be positive.")
        object.__setattr__(self, "inputs", MappingProxyType(dict(self.inputs)))
        object.__setattr__(
            self,
            "properties",
            MappingProxyType(dict(self.properties)),
        )
        object.__setattr__(
            self,
            "dynamic_port_state",
            MappingProxyType(dict(self.dynamic_port_state)),
        )
        object.__setattr__(
            self,
            "project_assets",
            MappingProxyType(dict(self.project_assets)),
        )

    def operation_correlation(self) -> AutomationOperationCorrelation:
        return AutomationOperationCorrelation(
            request_id=self.request_id,
            run_id=self.run_id,
            node_id=self.node_id,
            activation_id=self.activation_id,
        )

    def require_bool(self, port_id: str) -> bool:
        value = self._required(
            self.inputs,
            port_id,
            NodeExecutionFailureCode.INPUT_MISSING,
        )
        if not isinstance(value, bool):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return value

    def require_number(self, port_id: str) -> float:
        value = self._required(
            self.inputs,
            port_id,
            NodeExecutionFailureCode.INPUT_MISSING,
        )
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        try:
            number = float(value)
        except OverflowError:
            number = math.inf
        if not math.isfinite(number):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return number

    def require_string(self, port_id: str) -> str:
        value = self._required(
            self.inputs,
            port_id,
            NodeExecutionFailureCode.INPUT_MISSING,
        )
        if not isinstance(value, str):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return value

    def require_image_reference(self, port_id: str) -> RuntimeImageReference:
        value = self._required(
            self.inputs,
            port_id,
            NodeExecutionFailureCode.INPUT_MISSING,
        )
        if not isinstance(value, RuntimeImageReference):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return value

    def require_image_references(
        self,
        port_id: str,
    ) -> tuple[RuntimeImageReference, ...]:
        values = self._required_collection(port_id)
        if not 1 <= len(values) <= 16 or any(
            not isinstance(value, RuntimeImageReference) for value in values
        ):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return cast(tuple[RuntimeImageReference, ...], values)

    def require_ocr_result(self, port_id: str) -> RuntimeOcrResult:
        value = self._required(
            self.inputs,
            port_id,
            NodeExecutionFailureCode.INPUT_MISSING,
        )
        if not isinstance(value, RuntimeOcrResult):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return value

    def require_project_asset(self, asset_id: str) -> RuntimeImageReference:
        reference = self.project_assets.get(asset_id)
        if reference is None:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROJECT_ASSET_UNAVAILABLE,
                parameter_name="assetId",
            )
        return reference

    def require_rect(self, port_id: str) -> RuntimeRect:
        value = self._required(
            self.inputs,
            port_id,
            NodeExecutionFailureCode.INPUT_MISSING,
        )
        if not isinstance(value, RuntimeRect):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return value

    def require_rects(self, port_id: str) -> tuple[RuntimeRect, ...]:
        values = self._required_collection(port_id)
        if not 1 <= len(values) <= 16 or any(
            not isinstance(value, RuntimeRect) for value in values
        ):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return cast(tuple[RuntimeRect, ...], values)

    def require_points(self, port_id: str) -> tuple[RuntimePoint, ...]:
        values = self._required_collection(port_id)
        if not 1 <= len(values) <= 16 or any(
            not isinstance(value, RuntimePoint) for value in values
        ):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return cast(tuple[RuntimePoint, ...], values)

    def require_point(self, port_id: str) -> RuntimePoint:
        value = self._required(
            self.inputs,
            port_id,
            NodeExecutionFailureCode.INPUT_MISSING,
        )
        if not isinstance(value, RuntimePoint):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return value

    def property_bool(self, property_name: str) -> bool:
        value = self._required(
            self.properties,
            property_name,
            NodeExecutionFailureCode.PROPERTY_MISSING,
        )
        if not isinstance(value, bool):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name=property_name,
            )
        return value

    def property_number(self, property_name: str) -> float:
        value = self._required(
            self.properties,
            property_name,
            NodeExecutionFailureCode.PROPERTY_MISSING,
        )
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name=property_name,
            )
        try:
            number = float(value)
        except OverflowError:
            number = math.inf
        if not math.isfinite(number):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name=property_name,
            )
        return number

    def property_string(self, property_name: str) -> str:
        value = self._required(
            self.properties,
            property_name,
            NodeExecutionFailureCode.PROPERTY_MISSING,
        )
        if not isinstance(value, str):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name=property_name,
            )
        return value

    def _required_collection(self, port_id: str) -> tuple[RuntimeValue, ...]:
        value = self._required(
            self.inputs,
            port_id,
            NodeExecutionFailureCode.INPUT_MISSING,
        )
        if not isinstance(value, tuple):
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name=port_id,
            )
        return value

    @staticmethod
    def _required(
        values: Mapping[str, RuntimeValue],
        name: str,
        missing_code: NodeExecutionFailureCode,
    ) -> RuntimeValue:
        if name not in values:
            raise NodeExecutionFailure(missing_code, parameter_name=name)
        return values[name]


class SuccessorDispatchMode(StrEnum):
    QUEUED = "queued"
    CONCURRENT = "concurrent"


@dataclass(frozen=True, slots=True)
class NodeExecutionResult:
    outputs: Mapping[str, RuntimeValue] = field(default_factory=_empty_runtime_values)
    selected_execution_outputs: tuple[str, ...] = ()
    logs: tuple[RuntimeLogEntry, ...] = ()
    terminal: bool = False
    successor_dispatch: SuccessorDispatchMode = SuccessorDispatchMode.QUEUED

    def __post_init__(self) -> None:
        object.__setattr__(self, "outputs", MappingProxyType(dict(self.outputs)))
        if self.terminal and self.selected_execution_outputs:
            raise ValueError("A terminal result cannot select an execution output.")
        if (
            self.terminal
            and self.successor_dispatch is not SuccessorDispatchMode.QUEUED
        ):
            raise ValueError("A terminal result cannot dispatch successors.")
        if self.successor_dispatch is SuccessorDispatchMode.CONCURRENT and len(
            self.selected_execution_outputs
        ) not in (2, 3):
            raise ValueError(
                "Concurrent dispatch requires two or three selected outputs."
            )
        if len(set(self.selected_execution_outputs)) != len(
            self.selected_execution_outputs
        ):
            raise ValueError("Execution output selections must be unique.")


class NodeExecutor(Protocol):
    @property
    def type_key(self) -> str: ...

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult: ...


def runtime_value_matches(
    type_descriptor: TypeDescriptorV1,
    value: RuntimeValue,
) -> bool:
    descriptor = type_descriptor.root
    if isinstance(descriptor, OptionalTypeV1):
        return value is None or runtime_value_matches(descriptor.value, value)
    if value is None:
        return False
    if isinstance(descriptor, CollectionTypeV1):
        return isinstance(value, tuple) and all(
            runtime_value_matches(descriptor.element, item) for item in value
        )
    return _primitive_value_matches(descriptor.kind, value)


def _primitive_value_matches(
    kind: PrimitiveTypeKindV1,
    value: RuntimeValue,
) -> bool:
    if kind is PrimitiveTypeKindV1.exec:
        return False
    if kind is PrimitiveTypeKindV1.bool:
        return isinstance(value, bool)
    if kind is PrimitiveTypeKindV1.number:
        if isinstance(value, bool) or not isinstance(value, int | float):
            return False
        try:
            return math.isfinite(float(value))
        except OverflowError:
            return False
    if kind is PrimitiveTypeKindV1.string:
        return isinstance(value, str)
    if kind is PrimitiveTypeKindV1.point:
        return isinstance(value, RuntimePoint)
    if kind is PrimitiveTypeKindV1.rect:
        return isinstance(value, RuntimeRect)
    if kind is PrimitiveTypeKindV1.image_ref:
        return isinstance(value, RuntimeImageReference)
    if kind is PrimitiveTypeKindV1.ocr_candidate:
        return isinstance(value, RuntimeOcrCandidate)
    if kind is PrimitiveTypeKindV1.ocr_result:
        return isinstance(value, RuntimeOcrResult)
    return False


def _camel_case(value: str) -> str:
    parts = value.lower().split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])
