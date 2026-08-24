"""Bounded conversion for persistent variable values crossing the IPC boundary."""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from typing import Final
from uuid import UUID

from rino_runtime.contracts.generated.rino_graph_v1 import (
    VariableDefinitionV1,
    VariableValueKindV1,
)
from rino_runtime.nodes.execution import RuntimePoint, RuntimeRect, RuntimeValue
from rino_runtime.nodes.variables import (
    MAXIMUM_PERSISTENT_COORDINATE,
    MAXIMUM_PERSISTENT_VARIABLE_NUMBER,
    MAXIMUM_PERSISTENT_VARIABLE_STRING_LENGTH,
    MINIMUM_PERSISTENT_COORDINATE,
    PersistentVariableUpdate,
)

MAXIMUM_PERSISTENT_VARIABLE_COUNT: Final[int] = 128


class PersistentVariableError(ValueError):
    """A bounded, value-free persistent variable validation failure."""


def decode_initial_persistent_variables(
    raw_values: object,
    definitions: Iterable[VariableDefinitionV1],
) -> dict[UUID, RuntimeValue]:
    """Validates and decodes the run-start persistent values for one graph."""
    if raw_values is None:
        return {}
    if not isinstance(raw_values, (list, tuple)):
        raise PersistentVariableError("Persistent variable input is invalid.")
    if len(raw_values) > MAXIMUM_PERSISTENT_VARIABLE_COUNT:
        raise PersistentVariableError("Persistent variable input is invalid.")

    definition_by_id = {
        definition.variable_id: definition for definition in definitions
    }
    decoded: dict[UUID, RuntimeValue] = {}
    for raw_value in raw_values:
        record = _record_mapping(raw_value)
        variable_id = _record_uuid(record)
        if variable_id in decoded:
            raise PersistentVariableError("Persistent variable input is invalid.")
        value_kind = _record_kind(record)
        definition = definition_by_id.get(variable_id)
        if (
            definition is None
            or not definition.persistent
            or definition.value_kind is VariableValueKindV1.image_ref
            or definition.value_kind is not value_kind
        ):
            raise PersistentVariableError("Persistent variable input is invalid.")
        decoded[variable_id] = _decode_value(value_kind, record["value"])
    return decoded


def encode_persistent_variable_updates(
    updates: Iterable[PersistentVariableUpdate],
) -> list[dict[str, object]]:
    """Encodes dirty frame values without runtime coordinate metadata."""
    source = tuple(updates)
    if len(source) > MAXIMUM_PERSISTENT_VARIABLE_COUNT:
        raise PersistentVariableError("Persistent variable output is invalid.")
    encoded: list[dict[str, object]] = []
    seen: set[UUID] = set()
    for update in source:
        if update.variable_id in seen:
            raise PersistentVariableError("Persistent variable output is invalid.")
        seen.add(update.variable_id)
        value_kind = update.value_kind
        if value_kind is VariableValueKindV1.image_ref:
            raise PersistentVariableError("Persistent variable output is invalid.")
        value = _decode_value(value_kind, _encode_value(value_kind, update.value))
        encoded.append(
            {
                "variableId": str(update.variable_id),
                "valueKind": value_kind.value,
                "value": _encode_value(value_kind, value),
            }
        )
    return encoded


def _record_mapping(raw_value: object) -> Mapping[str, object]:
    if not isinstance(raw_value, Mapping):
        raise PersistentVariableError("Persistent variable input is invalid.")
    if set(raw_value) != {"variableId", "valueKind", "value"}:
        raise PersistentVariableError("Persistent variable input is invalid.")
    return raw_value


def _record_uuid(record: Mapping[str, object]) -> UUID:
    value = record["variableId"]
    if not isinstance(value, str):
        raise PersistentVariableError("Persistent variable input is invalid.")
    try:
        return UUID(value)
    except ValueError as error:
        raise PersistentVariableError(
            "Persistent variable input is invalid."
        ) from error


def _record_kind(record: Mapping[str, object]) -> VariableValueKindV1:
    value = record["valueKind"]
    if not isinstance(value, str):
        raise PersistentVariableError("Persistent variable input is invalid.")
    try:
        kind = VariableValueKindV1(value)
    except ValueError as error:
        raise PersistentVariableError(
            "Persistent variable input is invalid."
        ) from error
    if kind is VariableValueKindV1.image_ref:
        raise PersistentVariableError("Persistent variable input is invalid.")
    return kind


def _decode_value(
    value_kind: VariableValueKindV1,
    raw_value: object,
) -> RuntimeValue:
    if value_kind is VariableValueKindV1.bool:
        if isinstance(raw_value, bool):
            return raw_value
    elif value_kind is VariableValueKindV1.number:
        if isinstance(raw_value, int | float) and not isinstance(raw_value, bool):
            try:
                value = float(raw_value)
            except (OverflowError, ValueError):
                value = math.inf
            if (
                math.isfinite(value)
                and abs(value) <= MAXIMUM_PERSISTENT_VARIABLE_NUMBER
            ):
                return value
    elif value_kind is VariableValueKindV1.string:
        if (
            isinstance(raw_value, str)
            and len(raw_value) <= MAXIMUM_PERSISTENT_VARIABLE_STRING_LENGTH
        ):
            return raw_value
    elif value_kind is VariableValueKindV1.point:
        if isinstance(raw_value, Mapping) and set(raw_value) == {"x", "y"}:
            x = _bounded_coordinate(raw_value["x"])
            y = _bounded_coordinate(raw_value["y"])
            if x is not None and y is not None:
                return RuntimePoint(x, y)
    elif (
        value_kind is VariableValueKindV1.rect
        and isinstance(raw_value, Mapping)
        and set(raw_value)
        == {
            "x",
            "y",
            "width",
            "height",
        }
    ):
        x = _bounded_coordinate(raw_value["x"])
        y = _bounded_coordinate(raw_value["y"])
        width = _bounded_dimension(raw_value["width"])
        height = _bounded_dimension(raw_value["height"])
        if x is not None and y is not None and width is not None and height is not None:
            return RuntimeRect(x, y, width, height)
    raise PersistentVariableError("Persistent variable value is invalid.")


def _encode_value(value_kind: VariableValueKindV1, value: RuntimeValue) -> object:
    if value_kind is VariableValueKindV1.bool and isinstance(value, bool):
        return value
    if (
        value_kind is VariableValueKindV1.number
        and isinstance(value, int | float)
        and not isinstance(value, bool)
    ):
        return value
    if value_kind is VariableValueKindV1.string and isinstance(value, str):
        return value
    if value_kind is VariableValueKindV1.point and isinstance(value, RuntimePoint):
        return {"x": value.x, "y": value.y}
    if value_kind is VariableValueKindV1.rect and isinstance(value, RuntimeRect):
        return {
            "x": value.x,
            "y": value.y,
            "width": value.width,
            "height": value.height,
        }
    raise PersistentVariableError("Persistent variable value is invalid.")


def _bounded_coordinate(value: object) -> int | None:
    if (
        isinstance(value, int)
        and not isinstance(value, bool)
        and MINIMUM_PERSISTENT_COORDINATE <= value <= MAXIMUM_PERSISTENT_COORDINATE
    ):
        return value
    return None


def _bounded_dimension(value: object) -> int | None:
    if (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 1 <= value <= MAXIMUM_PERSISTENT_COORDINATE
    ):
        return value
    return None
