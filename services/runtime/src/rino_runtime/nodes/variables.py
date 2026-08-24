"""Per-run typed variable access and the reviewed variable node registrations."""

from __future__ import annotations

import math
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Final, Protocol, cast
from uuid import UUID

from rino_runtime.contracts.generated.rino_graph_v1 import (
    VariableDefinitionV1,
    VariableValueKindV1,
)
from rino_runtime.contracts.generated.rino_registry_v1 import (
    NodeDefinitionV1,
    PrimitiveTypeKindV1,
)
from rino_runtime.nodes.execution import (
    NodeExecutionContext,
    NodeExecutionFailure,
    NodeExecutionFailureCode,
    NodeExecutionResult,
    RuntimeImageReference,
    RuntimePoint,
    RuntimeRect,
    RuntimeValue,
)
from rino_runtime.nodes.registry import NodeRegistration

MAXIMUM_VARIABLE_STRING_LENGTH: Final[int] = 65_536
MAXIMUM_PERSISTENT_VARIABLE_STRING_LENGTH: Final[int] = 4_096
MAXIMUM_PERSISTENT_VARIABLE_NUMBER: Final[float] = 1e308
MINIMUM_PERSISTENT_COORDINATE: Final[int] = -2_147_483_648
MAXIMUM_PERSISTENT_COORDINATE: Final[int] = 2_147_483_647
_UNINITIALIZED: Final[object] = object()


@dataclass(frozen=True, slots=True)
class PersistentVariableUpdate:
    variable_id: UUID
    value_kind: VariableValueKindV1
    value: RuntimeValue


class RuntimeVariableAccess(Protocol):
    """The narrow variable dependency exposed to variable node executors."""

    @property
    def revision(self) -> int: ...

    def get(
        self,
        variable_id: UUID,
        expected_kind: VariableValueKindV1,
    ) -> RuntimeValue: ...

    def set(
        self,
        variable_id: UUID,
        expected_kind: VariableValueKindV1,
        value: RuntimeValue,
    ) -> None: ...


class RuntimeVariableFrame:
    """A fresh, in-memory variable frame for one scheduler run."""

    def __init__(
        self,
        definitions: Iterable[VariableDefinitionV1] = (),
        initial_values: Mapping[UUID, RuntimeValue] | None = None,
    ) -> None:
        self._definitions: dict[UUID, VariableDefinitionV1] = {}
        self._values: dict[UUID, RuntimeValue | object] = {}
        self._revision = 0
        normalized_names: set[str] = set()
        for definition in definitions:
            variable_id = definition.variable_id
            if variable_id in self._definitions:
                raise ValueError("Variable identifiers must be unique.")
            normalized_name = _normalize_variable_name(definition.name)
            if normalized_name in normalized_names:
                raise ValueError("Variable names must be unique.")
            normalized_names.add(normalized_name)
            self._definitions[variable_id] = definition
            self._values[variable_id] = _default_value(definition.value_kind)
        for variable_id, value in (initial_values or {}).items():
            definition = self._definitions.get(variable_id)
            if (
                definition is None
                or not definition.persistent
                or definition.value_kind is VariableValueKindV1.image_ref
            ):
                raise ValueError("Initial persistent variable is not allowed.")
            self._values[variable_id] = _validate_value(
                definition.value_kind,
                value,
                persistent=True,
            )
        self._dirty: set[UUID] = set()

    @property
    def revision(self) -> int:
        return self._revision

    def get(
        self,
        variable_id: UUID,
        expected_kind: VariableValueKindV1,
    ) -> RuntimeValue:
        definition = self._require_definition(variable_id, expected_kind)
        value = self._values[definition.variable_id]
        if value is _UNINITIALIZED:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.VARIABLE_UNINITIALIZED,
                parameter_name="variableId",
            )
        return cast(RuntimeValue, value)

    def set(
        self,
        variable_id: UUID,
        expected_kind: VariableValueKindV1,
        value: RuntimeValue,
    ) -> None:
        definition = self._require_definition(variable_id, expected_kind)
        if definition.persistent and expected_kind is VariableValueKindV1.image_ref:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="variableId",
            )
        normalized_value = _validate_value(
            expected_kind,
            value,
            persistent=definition.persistent,
        )
        self._values[definition.variable_id] = normalized_value
        if definition.persistent:
            self._dirty.add(definition.variable_id)
        self._revision += 1

    def persistent_updates(self) -> tuple[PersistentVariableUpdate, ...]:
        """Returns setter-written persistent values in authored definition order."""
        updates: list[PersistentVariableUpdate] = []
        for definition in self._definitions.values():
            if definition.variable_id not in self._dirty:
                continue
            value = self._values[definition.variable_id]
            if value is _UNINITIALIZED:
                continue
            updates.append(
                PersistentVariableUpdate(
                    variable_id=definition.variable_id,
                    value_kind=definition.value_kind,
                    value=cast(RuntimeValue, value),
                )
            )
        return tuple(updates)

    def _require_definition(
        self,
        variable_id: UUID,
        expected_kind: VariableValueKindV1,
    ) -> VariableDefinitionV1:
        definition = self._definitions.get(variable_id)
        if definition is None:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="variableId",
            )
        if definition.value_kind is not expected_kind:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.PROPERTY_INVALID,
                parameter_name="valueKind",
            )
        return definition


def build_variable_registrations() -> tuple[NodeRegistration, ...]:
    registrations: list[NodeRegistration] = []
    for suffix, value_kind in _VARIABLE_NODE_SPECS:
        getter_type_key = f"core.variable.get{suffix}"
        setter_type_key = f"core.variable.set{suffix}"
        registrations.extend(
            (
                NodeRegistration(
                    _variable_get_definition(getter_type_key, value_kind),
                    _VariableGetterExecutor(getter_type_key, value_kind),
                ),
                NodeRegistration(
                    _variable_set_definition(setter_type_key, value_kind),
                    _VariableSetterExecutor(setter_type_key, value_kind),
                ),
            )
        )
    return tuple(registrations)


_VARIABLE_NODE_SPECS: Final[tuple[tuple[str, VariableValueKindV1], ...]] = (
    ("Bool", VariableValueKindV1.bool),
    ("Number", VariableValueKindV1.number),
    ("String", VariableValueKindV1.string),
    ("Point", VariableValueKindV1.point),
    ("Rect", VariableValueKindV1.rect),
    ("ImageRef", VariableValueKindV1.image_ref),
)


class _VariableGetterExecutor:
    def __init__(self, type_key: str, value_kind: VariableValueKindV1) -> None:
        self.type_key = type_key
        self._value_kind = value_kind

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        access = _require_variable_access(context)
        variable_id = _variable_id(context)
        return NodeExecutionResult(
            outputs={"value": access.get(variable_id, self._value_kind)}
        )


class _VariableSetterExecutor:
    def __init__(self, type_key: str, value_kind: VariableValueKindV1) -> None:
        self.type_key = type_key
        self._value_kind = value_kind

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        access = _require_variable_access(context)
        variable_id = _variable_id(context)
        value = _input_value(context, self._value_kind)
        access.set(variable_id, self._value_kind, value)
        return NodeExecutionResult(
            outputs={"storedValue": value},
            selected_execution_outputs=("next",),
        )


def _variable_get_definition(
    type_key: str,
    value_kind: VariableValueKindV1,
) -> NodeDefinitionV1:
    return _definition(
        type_key=type_key,
        runtime_kind="pure",
        side_effect="none",
        ports=[_data_port("value", "output", value_kind.value, type_key)],
    )


def _variable_set_definition(
    type_key: str,
    value_kind: VariableValueKindV1,
) -> NodeDefinitionV1:
    literal_kinds = {
        VariableValueKindV1.bool,
        VariableValueKindV1.number,
        VariableValueKindV1.string,
    }
    return _definition(
        type_key=type_key,
        runtime_kind="execution",
        side_effect="runtime",
        ports=[
            _exec_port("run", "input", type_key),
            _data_port(
                "value",
                "input",
                value_kind.value,
                type_key,
                required=True,
                accepts_literal=value_kind in literal_kinds,
            ),
            _data_port("storedValue", "output", value_kind.value, type_key),
            _exec_port("next", "output", type_key),
        ],
    )


def _definition(
    *,
    type_key: str,
    runtime_kind: str,
    side_effect: str,
    ports: list[dict[str, object]],
) -> NodeDefinitionV1:
    property_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["variableId"],
        "properties": {
            "variableId": {
                "type": "string",
                "format": "uuid",
                "maxLength": 36,
            }
        },
    }
    return NodeDefinitionV1.model_validate(
        {
            "typeKey": type_key,
            "typeVersion": 1,
            "runtimeKind": runtime_kind,
            "sideEffect": side_effect,
            "category": "values",
            "titleKey": f"node.{type_key}.title",
            "descriptionKey": f"node.{type_key}.description",
            "iconKey": "node.variable",
            "ports": ports,
            "propertySchema": property_schema,
        }
    )


def _port(
    port_id: str,
    direction: str,
    port_kind: str,
    value_type: dict[str, object],
    type_key: str,
    *,
    required: bool = False,
    accepts_literal: bool = False,
) -> dict[str, object]:
    return {
        "portId": port_id,
        "direction": direction,
        "portKind": port_kind,
        "type": value_type,
        "labelKey": f"node.{type_key}.port.{port_id}",
        **({"required": True} if required else {}),
        **({"acceptsLiteral": True} if accepts_literal else {}),
    }


def _exec_port(port_id: str, direction: str, type_key: str) -> dict[str, object]:
    return _port(
        port_id,
        direction,
        "execution",
        {"kind": PrimitiveTypeKindV1.exec.value},
        type_key,
    )


def _data_port(
    port_id: str,
    direction: str,
    value_kind: str,
    type_key: str,
    *,
    required: bool = False,
    accepts_literal: bool = False,
) -> dict[str, object]:
    return _port(
        port_id,
        direction,
        "data",
        {"kind": value_kind},
        type_key,
        required=required,
        accepts_literal=accepts_literal,
    )


def _require_variable_access(context: NodeExecutionContext) -> RuntimeVariableAccess:
    access = context.variable_access
    if access is None:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="variableAccess",
        )
    return access


def _variable_id(context: NodeExecutionContext) -> UUID:
    raw_value = context.property_string("variableId")
    try:
        return UUID(raw_value)
    except ValueError as error:
        raise NodeExecutionFailure(
            NodeExecutionFailureCode.PROPERTY_INVALID,
            parameter_name="variableId",
        ) from error


def _input_value(
    context: NodeExecutionContext,
    value_kind: VariableValueKindV1,
) -> RuntimeValue:
    if value_kind is VariableValueKindV1.bool:
        return context.require_bool("value")
    if value_kind is VariableValueKindV1.number:
        return context.require_number("value")
    if value_kind is VariableValueKindV1.string:
        value = context.require_string("value")
        if len(value) > MAXIMUM_VARIABLE_STRING_LENGTH:
            raise NodeExecutionFailure(
                NodeExecutionFailureCode.INPUT_TYPE_INVALID,
                parameter_name="value",
            )
        return value
    if value_kind is VariableValueKindV1.point:
        return context.require_point("value")
    if value_kind is VariableValueKindV1.rect:
        return context.require_rect("value")
    if value_kind is VariableValueKindV1.image_ref:
        return context.require_image_reference("value")
    raise NodeExecutionFailure(
        NodeExecutionFailureCode.PROPERTY_INVALID,
        parameter_name="valueKind",
    )


def _default_value(value_kind: VariableValueKindV1) -> RuntimeValue | object:
    if value_kind is VariableValueKindV1.bool:
        return False
    if value_kind is VariableValueKindV1.number:
        return 0.0
    if value_kind is VariableValueKindV1.string:
        return ""
    if value_kind is VariableValueKindV1.point:
        return RuntimePoint(0, 0)
    if value_kind is VariableValueKindV1.rect:
        return RuntimeRect(0, 0, 1, 1)
    if value_kind is VariableValueKindV1.image_ref:
        return _UNINITIALIZED
    raise ValueError("Unknown variable value kind.")


def _validate_value(
    value_kind: VariableValueKindV1,
    value: RuntimeValue,
    *,
    persistent: bool = False,
) -> RuntimeValue:
    if value_kind is VariableValueKindV1.bool:
        if isinstance(value, bool):
            return value
    elif value_kind is VariableValueKindV1.number:
        if isinstance(value, int | float) and not isinstance(value, bool):
            try:
                normalized = float(value)
            except OverflowError:
                normalized = math.inf
            if math.isfinite(normalized) and (
                not persistent or abs(normalized) <= MAXIMUM_PERSISTENT_VARIABLE_NUMBER
            ):
                return normalized
    elif value_kind is VariableValueKindV1.string:
        if isinstance(value, str) and len(value) <= (
            MAXIMUM_PERSISTENT_VARIABLE_STRING_LENGTH
            if persistent
            else MAXIMUM_VARIABLE_STRING_LENGTH
        ):
            return value
    elif value_kind is VariableValueKindV1.point:
        if isinstance(value, RuntimePoint) and (
            not persistent
            or (_persistent_coordinate(value.x) and _persistent_coordinate(value.y))
        ):
            return value
    elif value_kind is VariableValueKindV1.rect:
        if isinstance(value, RuntimeRect) and (
            not persistent
            or (
                _persistent_coordinate(value.x)
                and _persistent_coordinate(value.y)
                and _persistent_dimension(value.width)
                and _persistent_dimension(value.height)
            )
        ):
            return value
    elif value_kind is VariableValueKindV1.image_ref:
        if isinstance(value, RuntimeImageReference):
            return value
    else:
        raise ValueError("Unknown variable value kind.")
    raise NodeExecutionFailure(
        NodeExecutionFailureCode.INPUT_TYPE_INVALID,
        parameter_name="value",
    )


def _persistent_coordinate(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and MINIMUM_PERSISTENT_COORDINATE <= value <= MAXIMUM_PERSISTENT_COORDINATE
    )


def _persistent_dimension(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 1 <= value <= MAXIMUM_PERSISTENT_COORDINATE
    )


def _normalize_variable_name(name: str) -> str:
    return unicodedata.normalize("NFKC", name).strip().casefold()
