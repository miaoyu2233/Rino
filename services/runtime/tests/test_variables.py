"""Per-run variable frame and strong type boundary tests."""

from __future__ import annotations

import math
from uuid import UUID

import pytest

from rino_runtime.application.persistent_variables import (
    PersistentVariableError,
    decode_initial_persistent_variables,
    encode_persistent_variable_updates,
)
from rino_runtime.contracts.generated.rino_graph_v1 import (
    VariableDefinitionV1,
    VariableValueKindV1,
)
from rino_runtime.nodes import (
    NodeExecutionContext,
    NodeExecutionFailure,
    NodeExecutionFailureCode,
    RuntimeImageReference,
    RuntimePoint,
    RuntimeRect,
    build_phase_4_production_registry,
)
from rino_runtime.nodes.variables import RuntimeVariableFrame

VARIABLE_IDS = {
    kind: UUID(f"50000000-0000-4000-8000-00000000000{index}")
    for index, kind in enumerate(
        (
            VariableValueKindV1.bool,
            VariableValueKindV1.number,
            VariableValueKindV1.string,
            VariableValueKindV1.point,
            VariableValueKindV1.rect,
            VariableValueKindV1.image_ref,
        ),
        start=1,
    )
}


def _definitions() -> list[VariableDefinitionV1]:
    return [
        VariableDefinitionV1.model_validate(
            {
                "variableId": str(variable_id),
                "name": f"{kind.value}-variable",
                "valueKind": kind.value,
                "persistent": False,
            }
        )
        for kind, variable_id in VARIABLE_IDS.items()
    ]


def _frame() -> RuntimeVariableFrame:
    return RuntimeVariableFrame(_definitions())


def test_all_variable_kinds_have_bounded_defaults_and_round_trip() -> None:
    frame = _frame()

    assert (
        frame.get(VARIABLE_IDS[VariableValueKindV1.bool], VariableValueKindV1.bool)
        is False
    )
    assert (
        frame.get(VARIABLE_IDS[VariableValueKindV1.number], VariableValueKindV1.number)
        == 0.0
    )
    assert (
        frame.get(VARIABLE_IDS[VariableValueKindV1.string], VariableValueKindV1.string)
        == ""
    )
    assert frame.get(
        VARIABLE_IDS[VariableValueKindV1.point], VariableValueKindV1.point
    ) == RuntimePoint(0, 0)
    assert frame.get(
        VARIABLE_IDS[VariableValueKindV1.rect], VariableValueKindV1.rect
    ) == RuntimeRect(0, 0, 1, 1)

    image = RuntimeImageReference(
        handle_id="image-1",
        width=1080,
        height=1920,
        coordinate_space_id="space-1",
        generation=3,
        expires_at_monotonic=10.0,
    )
    values = {
        VariableValueKindV1.bool: True,
        VariableValueKindV1.number: 4.5,
        VariableValueKindV1.string: "hello",
        VariableValueKindV1.point: RuntimePoint(3, 4, "space-1", 3),
        VariableValueKindV1.rect: RuntimeRect(1, 2, 3, 4, "space-1", 3),
        VariableValueKindV1.image_ref: image,
    }
    for kind, value in values.items():
        frame.set(VARIABLE_IDS[kind], kind, value)
        assert frame.get(VARIABLE_IDS[kind], kind) == value
    assert frame.revision == len(values)


def test_image_reference_is_uninitialized_until_set() -> None:
    frame = _frame()

    with pytest.raises(NodeExecutionFailure) as caught:
        frame.get(
            VARIABLE_IDS[VariableValueKindV1.image_ref],
            VariableValueKindV1.image_ref,
        )

    assert caught.value.code is NodeExecutionFailureCode.VARIABLE_UNINITIALIZED


def test_unknown_and_wrong_kind_access_is_rejected() -> None:
    frame = _frame()

    with pytest.raises(NodeExecutionFailure) as unknown:
        frame.get(
            UUID("60000000-0000-4000-8000-000000000001"), VariableValueKindV1.bool
        )
    with pytest.raises(NodeExecutionFailure) as wrong_kind:
        frame.get(VARIABLE_IDS[VariableValueKindV1.bool], VariableValueKindV1.number)

    assert unknown.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert wrong_kind.value.code is NodeExecutionFailureCode.PROPERTY_INVALID


def test_setter_boundary_rejects_non_finite_numbers_and_long_strings() -> None:
    frame = _frame()
    number_id = VARIABLE_IDS[VariableValueKindV1.number]
    string_id = VARIABLE_IDS[VariableValueKindV1.string]

    for value in (math.nan, math.inf, -math.inf):
        with pytest.raises(NodeExecutionFailure) as caught:
            frame.set(number_id, VariableValueKindV1.number, value)
        assert caught.value.code is NodeExecutionFailureCode.INPUT_TYPE_INVALID

    with pytest.raises(NodeExecutionFailure) as caught:
        frame.set(string_id, VariableValueKindV1.string, "x" * 65_537)
    assert caught.value.code is NodeExecutionFailureCode.INPUT_TYPE_INVALID


@pytest.mark.asyncio
async def test_strongly_typed_getter_and_setter_nodes_round_trip_all_kinds() -> None:
    registry = build_phase_4_production_registry()
    frame = _frame()
    values = {
        VariableValueKindV1.bool: True,
        VariableValueKindV1.number: 4.5,
        VariableValueKindV1.string: "hello",
        VariableValueKindV1.point: RuntimePoint(3, 4),
        VariableValueKindV1.rect: RuntimeRect(1, 2, 3, 4),
        VariableValueKindV1.image_ref: RuntimeImageReference(
            handle_id="image-2",
            width=100,
            height=200,
            coordinate_space_id="space-2",
            generation=4,
            expires_at_monotonic=20.0,
        ),
    }
    for index, (kind, value) in enumerate(values.items(), start=1):
        suffix = {
            VariableValueKindV1.bool: "Bool",
            VariableValueKindV1.number: "Number",
            VariableValueKindV1.string: "String",
            VariableValueKindV1.point: "Point",
            VariableValueKindV1.rect: "Rect",
            VariableValueKindV1.image_ref: "ImageRef",
        }[kind]
        setter_key = f"core.variable.set{suffix}"
        getter_key = f"core.variable.get{suffix}"
        setter_result = await registry.execute(
            setter_key,
            NodeExecutionContext(
                node_id=UUID(f"70000000-0000-4000-8000-{index:012d}"),
                type_key=setter_key,
                inputs={"value": value},
                properties={"variableId": str(VARIABLE_IDS[kind])},
                variable_access=frame,
            ),
        )
        getter_result = await registry.execute(
            getter_key,
            NodeExecutionContext(
                node_id=UUID(f"70000000-0000-4000-8000-{index + 10:012d}"),
                type_key=getter_key,
                properties={"variableId": str(VARIABLE_IDS[kind])},
                variable_access=frame,
            ),
        )
        assert setter_result.outputs["storedValue"] == value
        assert getter_result.outputs["value"] == value
        assert setter_result.selected_execution_outputs == ("next",)


def _persistent_definitions() -> list[VariableDefinitionV1]:
    return [
        VariableDefinitionV1.model_validate(
            {
                "variableId": str(VARIABLE_IDS[kind]),
                "name": f"persistent-{kind.value}",
                "valueKind": kind.value,
                "persistent": True,
            }
        )
        for kind in (
            VariableValueKindV1.number,
            VariableValueKindV1.string,
            VariableValueKindV1.point,
            VariableValueKindV1.rect,
        )
    ]


def test_persistent_initial_values_and_dirty_updates_are_bounded_and_ordered() -> None:
    definitions = _persistent_definitions()
    initial = {
        "variableId": str(VARIABLE_IDS[VariableValueKindV1.number]),
        "valueKind": "number",
        "value": 4.5,
    }
    decoded = decode_initial_persistent_variables([initial], definitions)
    frame = RuntimeVariableFrame(definitions, initial_values=decoded)

    assert (
        frame.get(VARIABLE_IDS[VariableValueKindV1.number], VariableValueKindV1.number)
        == 4.5
    )
    assert frame.persistent_updates() == ()

    frame.set(
        VARIABLE_IDS[VariableValueKindV1.rect],
        VariableValueKindV1.rect,
        RuntimeRect(1, 2, 3, 4, "private-space", 9),
    )
    frame.set(
        VARIABLE_IDS[VariableValueKindV1.number],
        VariableValueKindV1.number,
        4.5,
    )
    updates = frame.persistent_updates()
    assert [update.variable_id for update in updates] == [
        VARIABLE_IDS[VariableValueKindV1.number],
        VARIABLE_IDS[VariableValueKindV1.rect],
    ]
    assert encode_persistent_variable_updates(updates) == [
        {
            "variableId": str(VARIABLE_IDS[VariableValueKindV1.number]),
            "valueKind": "number",
            "value": 4.5,
        },
        {
            "variableId": str(VARIABLE_IDS[VariableValueKindV1.rect]),
            "valueKind": "rect",
            "value": {"x": 1, "y": 2, "width": 3, "height": 4},
        },
    ]


def test_persistent_input_rejects_unknown_duplicate_nonpersistent_and_image() -> None:
    definitions = _definitions()
    record = {
        "variableId": str(VARIABLE_IDS[VariableValueKindV1.bool]),
        "valueKind": "bool",
        "value": True,
    }
    with pytest.raises(PersistentVariableError):
        decode_initial_persistent_variables([record], definitions)
    with pytest.raises(PersistentVariableError):
        decode_initial_persistent_variables(
            [record, record],
            [
                VariableDefinitionV1.model_validate(
                    {
                        "variableId": str(VARIABLE_IDS[VariableValueKindV1.bool]),
                        "name": "persistent-bool",
                        "valueKind": "bool",
                        "persistent": True,
                    }
                )
            ],
        )
    with pytest.raises(PersistentVariableError):
        decode_initial_persistent_variables(
            [
                {
                    "variableId": str(VARIABLE_IDS[VariableValueKindV1.image_ref]),
                    "valueKind": "imageRef",
                    "value": {},
                }
            ],
            definitions,
        )


def test_persistent_setter_limits_reject_out_of_range_values() -> None:
    definitions = _persistent_definitions()
    frame = RuntimeVariableFrame(definitions)

    invalid_values = (
        (
            VariableValueKindV1.number,
            float("inf"),
        ),
        (
            VariableValueKindV1.string,
            "x" * 4097,
        ),
        (
            VariableValueKindV1.point,
            RuntimePoint(2_147_483_648, 0),
        ),
        (
            VariableValueKindV1.rect,
            RuntimeRect(0, 0, 0, 1),
        ),
    )
    for kind, value in invalid_values:
        with pytest.raises(NodeExecutionFailure) as caught:
            frame.set(VARIABLE_IDS[kind], kind, value)
        assert caught.value.code is NodeExecutionFailureCode.INPUT_TYPE_INVALID
