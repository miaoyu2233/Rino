"""Node registry integrity, scope separation, and capability allowlist tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Final
from uuid import UUID

import pytest
from pydantic import TypeAdapter

from rino_runtime.backends.fake import FakeAutomationBackend, FakeAutomationScenario
from rino_runtime.contracts import is_valid_registry_snapshot
from rino_runtime.contracts.generated.rino_registry_v1 import (
    NodeDefinitionV1,
    PortDefinitionV1,
    PrimitiveTypeV1,
    RinoNodeRegistrySnapshotV1,
    WorkflowTemplateV1,
)
from rino_runtime.nodes import (
    MVP_BACKEND_CAPABILITY_ALLOWLIST,
    MVP_PRODUCTION_NODE_TYPE_KEYS,
    PHASE_4_PRODUCTION_NODE_TYPE_KEYS,
    TEST_NODE_TYPE_KEYS,
    InMemoryFakeActionRecorder,
    NodeExecutionContext,
    NodeExecutionFailure,
    NodeExecutionFailureCode,
    NodeExecutionResult,
    NodeRegistration,
    NodeRegistryBuilder,
    build_mvp_production_registry,
    build_phase_4_fake_backend_registry,
    build_phase_4_production_registry,
    build_phase_4_test_registry,
)

REPOSITORY_ROOT: Final[Path] = Path(__file__).resolve().parents[3]
REGISTRY_ADAPTER: Final[TypeAdapter[RinoNodeRegistrySnapshotV1]] = TypeAdapter(
    RinoNodeRegistrySnapshotV1
)


def _primitive_kind(port: PortDefinitionV1) -> str:
    root = port.type.root
    assert isinstance(root, PrimitiveTypeV1)
    return root.kind.value


class _OcrExecutor:
    type_key = "vision.ocr"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult()


class _WrongExecutor:
    type_key = "wrong.node"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult()


class _InvalidOcrExecutor:
    type_key = "vision.ocr"

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult(outputs={"inventedModelOutput": "unsafe"})


class _StaticExecutor:
    def __init__(self, type_key: str) -> None:
        self.type_key = type_key

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult()


def _shared_definition(type_key: str) -> NodeDefinitionV1:
    path = (
        REPOSITORY_ROOT
        / "contracts"
        / "fixtures"
        / "registry"
        / "valid"
        / "core-definitions.json"
    )
    snapshot = REGISTRY_ADAPTER.validate_json(path.read_bytes(), strict=True)
    return next(
        definition
        for definition in snapshot.definitions
        if definition.type_key.root == type_key
    )


def test_production_registry_contains_only_the_reviewed_phase_4_nodes() -> None:
    registry = build_phase_4_production_registry()
    snapshot = registry.snapshot()

    assert registry.type_keys == PHASE_4_PRODUCTION_NODE_TYPE_KEYS
    assert registry.type_keys.isdisjoint(TEST_NODE_TYPE_KEYS)
    assert is_valid_registry_snapshot(
        json.loads(snapshot.model_dump_json(by_alias=True, exclude_none=True))
    )
    assert all(
        registry.executor(type_key) is not None for type_key in registry.type_keys
    )


def test_end_path_definition_and_fixture_expose_bounded_scope_choice() -> None:
    definition = build_phase_4_production_registry().definition("core.flow.endPath")
    fixture = _shared_definition("core.flow.endPath")

    assert definition is not None
    assert definition.runtime_kind.value == "execution"
    assert definition.side_effect.value == "runtime"
    assert definition.category.value == "flow"
    assert [port.port_id.root for port in definition.ports] == ["run"]
    assert all(port.port_kind.value == "execution" for port in definition.ports)
    assert json.loads(definition.property_defaults.model_dump_json()) == {
        "scope": "current"
    }
    schema = json.loads(definition.property_schema.model_dump_json())
    assert schema["required"] == ["scope"]
    assert schema["properties"]["scope"]["enum"] == ["current", "all"]
    fixture_payload = json.loads(
        fixture.model_dump_json(by_alias=True, exclude_none=True)
    )
    definition_payload = json.loads(
        definition.model_dump_json(by_alias=True, exclude_none=True)
    )
    assert fixture_payload == definition_payload


def test_sequence_order_definition_is_pure_and_matches_fixture() -> None:
    registry = build_phase_4_production_registry()
    sequence = registry.definition("core.flow.sequence")
    sequence_order = registry.definition("core.flow.sequenceOrder")
    fixture = _shared_definition("core.flow.sequenceOrder")

    assert sequence is not None
    assert sequence_order is not None
    assert sequence_order.runtime_kind.value == "pure"
    assert sequence_order.side_effect.value == "none"
    assert sequence_order.category.value == "flow"
    assert [port.port_id.root for port in sequence_order.ports] == ["order"]
    order_port = sequence_order.ports[0]
    assert order_port.direction.value == "output"
    assert order_port.port_kind.value == "data"
    assert order_port.allows_fan_out is True

    sequence_ports = {port.port_id.root: port for port in sequence.ports}
    assert sequence_ports["order"].direction.value == "input"
    assert sequence_ports["order"].required is not True
    assert sequence_ports["order"].accepts_literal is not True

    fixture_payload = json.loads(
        fixture.model_dump_json(by_alias=True, exclude_none=True)
    )
    definition_payload = json.loads(
        sequence_order.model_dump_json(by_alias=True, exclude_none=True)
    )
    assert fixture_payload == definition_payload


def test_variable_nodes_are_strongly_typed_and_side_effect_explicit() -> None:
    registry = build_phase_4_production_registry()
    expectations = {
        "Bool": ("bool", True),
        "Number": ("number", True),
        "String": ("string", True),
        "Point": ("point", False),
        "Rect": ("rect", False),
        "ImageRef": ("imageRef", False),
    }

    for suffix, (value_kind, accepts_literal) in expectations.items():
        getter = registry.definition(f"core.variable.get{suffix}")
        setter = registry.definition(f"core.variable.set{suffix}")
        assert getter is not None
        assert setter is not None
        assert getter.runtime_kind.value == "pure"
        assert getter.side_effect.value == "none"
        assert getter.category.value == "values"
        assert getter.icon_key.root == "node.variable"
        getter_ports = {port.port_id.root: port for port in getter.ports}
        assert _primitive_kind(getter_ports["value"]) == value_kind
        assert getter_ports["value"].direction.value == "output"

        assert setter.runtime_kind.value == "execution"
        assert setter.side_effect.value == "runtime"
        setter_ports = {port.port_id.root: port for port in setter.ports}
        assert setter_ports["run"].direction.value == "input"
        assert setter_ports["value"].direction.value == "input"
        assert setter_ports["value"].required is True
        if accepts_literal:
            assert setter_ports["value"].accepts_literal is True
        else:
            assert setter_ports["value"].accepts_literal is not True
        assert _primitive_kind(setter_ports["value"]) == value_kind
        assert setter_ports["storedValue"].direction.value == "output"
        assert _primitive_kind(setter_ports["storedValue"]) == value_kind
        assert setter_ports["next"].direction.value == "output"
        assert (
            json.loads(setter.property_schema.model_dump_json())["properties"][
                "variableId"
            ]["format"]
            == "uuid"
        )


def test_template_match_definition_defaults_to_the_protocol_threshold() -> None:
    definition = build_mvp_production_registry().definition("vision.templateMatch")

    assert definition is not None
    assert (
        json.loads(definition.property_defaults.model_dump_json())["threshold"] == 0.7
    )


def test_task_choice_definition_has_bounded_ports_and_setting_properties() -> None:
    definition = build_phase_4_production_registry().definition("core.logic.taskChoice")

    assert definition is not None
    assert json.loads(definition.property_defaults.model_dump_json()) == {
        "selectedCaseId": "case1",
        "settingKey": "taskChoice",
        "exposeInTaskSettings": True,
    }
    assert [port.port_id.root for port in definition.ports] == [
        "run",
        "selectedCaseId",
        *(f"case{index}" for index in range(1, 17)),
        "unmatched",
    ]


def test_case_overlay_definitions_have_bounded_typed_ports() -> None:
    registry = build_phase_4_production_registry()
    expectations = {
        "core.logic.caseOverlayBool": ("bool", True),
        "core.logic.caseOverlayNumber": ("number", True),
        "core.logic.caseOverlayImageRef": ("imageRef", False),
    }

    for type_key, (value_kind, fallback_required) in expectations.items():
        definition = registry.definition(type_key)
        assert definition is not None
        ports = {port.port_id.root: port for port in definition.ports}
        assert ports["selectedCaseId"].required is True
        assert _primitive_kind(ports["selectedCaseId"]) == "string"
        if fallback_required:
            assert ports["fallback"].required is True
        else:
            assert ports["fallback"].required is not True
        assert _primitive_kind(ports["fallback"]) == value_kind
        assert ports["value"].direction.value == "output"
        assert _primitive_kind(ports["value"]) == value_kind
        assert [_primitive_kind(ports[f"case{index}"]) for index in range(1, 17)] == [
            value_kind
        ] * 16
        assert all(ports[f"case{index}"].required is not True for index in range(1, 17))


def test_recognition_and_click_nodes_expose_optional_dynamic_inputs() -> None:
    registry = build_mvp_production_registry()
    template_match = registry.definition("vision.templateMatch")
    click_rect = registry.definition("automation.clickRectCenter")

    assert template_match is not None
    assert click_rect is not None
    template_ports = {port.port_id.root: port for port in template_match.ports}
    click_ports = {port.port_id.root: port for port in click_rect.ports}
    assert template_ports["threshold"].direction.value == "input"
    assert _primitive_kind(template_ports["threshold"]) == "number"
    assert template_ports["threshold"].required is not True
    for port_id in ("offsetX", "offsetY", "offsetWidth", "offsetHeight"):
        assert click_ports[port_id].direction.value == "input"
        assert _primitive_kind(click_ports[port_id]) == "number"
        assert click_ports[port_id].required is not True


def test_click_point_definition_defaults_to_direct_coordinates() -> None:
    definition = build_mvp_production_registry().definition("automation.clickPoint")

    assert definition is not None
    defaults = json.loads(definition.property_defaults.model_dump_json())
    assert defaults["inputMode"] == "coordinates"
    assert defaults["intervalMilliseconds"] == 100


def test_multi_recognition_collections_are_pure_bounded_data_nodes() -> None:
    registry = build_phase_4_production_registry()

    for type_key, item_kind, output_id in (
        ("core.collection.imageList", "imageRef", "images"),
        ("core.collection.regionList", "rect", "regions"),
    ):
        definition = registry.definition(type_key)
        assert definition is not None
        assert definition.runtime_kind.value == "pure"
        assert all(port.port_kind.value == "data" for port in definition.ports)
        item_ports = {
            port.port_id.root: port
            for port in definition.ports
            if port.port_id.root.startswith("item")
        }
        assert len(item_ports) == 16
        assert all(port.required is not True for port in item_ports.values())
        assert definition.ports[-1].port_id.root == output_id
        output_type = definition.ports[-1].type.root
        assert output_type.kind == "collection"
        assert output_type.element.root.kind.value == item_kind


def test_bounded_retry_definition_exposes_visible_bounded_controls() -> None:
    definition = build_phase_4_production_registry().definition(
        "core.flow.boundedRetry"
    )

    assert definition is not None
    serialized = json.loads(definition.model_dump_json(by_alias=True))
    assert serialized["sideEffect"] == "runtime"
    assert serialized["category"] == "timing"
    assert serialized["propertyDefaults"] == {
        "timeoutMilliseconds": 20_000,
        "rateLimitMilliseconds": 1_000,
        "maximumAttempts": 20,
    }
    assert [port["portId"] for port in serialized["ports"]] == [
        "run",
        "attempt",
        "exhausted",
        "attemptNumber",
        "elapsedMilliseconds",
    ]
    properties = serialized["propertySchema"]["properties"]
    assert properties["timeoutMilliseconds"]["maximum"] == 18_000_000
    assert properties["rateLimitMilliseconds"]["minimum"] == 1
    assert properties["maximumAttempts"]["maximum"] == 20_000


def test_number_recognition_template_exposes_real_run_and_next_ports() -> None:
    template = next(
        item
        for item in build_mvp_production_registry().snapshot().workflow_templates or []
        if item.template_key == "template.recognizeNumberAndBranch"
    )

    assert all(node.type_key.root != "core.flow.start" for node in template.nodes)
    assert [
        (port.proxy_port_id.root, port.placeholder_id, port.port_id.root)
        for port in template.exposed_ports or []
    ] == [
        ("run", "capture", "run"),
        ("next", "resultBranch", "whenTrue"),
    ]


@pytest.mark.asyncio
async def test_mvp_catalog_keeps_backend_nodes_visible_without_backend() -> None:
    registry = build_mvp_production_registry()

    assert registry.type_keys == MVP_PRODUCTION_NODE_TYPE_KEYS
    assert {
        definition.type_key.root
        for definition in registry.snapshot().definitions
        if definition.category.value in {"vision", "device"}
    } == {
        "automation.captureScreen",
        "core.collection.imageList",
        "vision.ocr",
        "vision.templateMatch",
        "vision.featureMatch",
        "vision.colorMatch",
        "automation.clickPoint",
        "automation.clickRectCenter",
        "automation.touchAction",
        "automation.launchAndroidApp",
        "automation.pressAndroidKey",
        "automation.swipe",
    }

    with pytest.raises(NodeExecutionFailure) as failure:
        await registry.execute(
            "vision.templateMatch",
            NodeExecutionContext(
                node_id=UUID(int=1),
                type_key="vision.templateMatch",
                device_key="unavailable-device",
            ),
        )

    assert failure.value.code is NodeExecutionFailureCode.CAPABILITY_UNAVAILABLE


def test_touch_action_definition_has_bounded_modes_and_point_inputs() -> None:
    definition = build_mvp_production_registry().definition("automation.touchAction")

    assert definition is not None
    assert definition.side_effect.value == "deviceWrite"
    serialized = json.loads(definition.model_dump_json(by_alias=True))
    assert serialized["propertyDefaults"] == {
        "actionType": "click",
        "longPressDurationMilliseconds": 1_000,
        "swipeDurationMilliseconds": 200,
        "secondaryStartDelayMilliseconds": 0,
    }
    properties = serialized["propertySchema"]["properties"]
    assert properties["actionType"]["enum"] == [
        "click",
        "longPress",
        "swipe",
        "multiSwipe",
    ]
    assert {
        port.port_id.root
        for port in definition.ports
        if port.port_kind.value == "data" and port.direction.value == "input"
    } == {"start", "end", "secondaryStart", "secondaryEnd"}


def test_android_actions_are_explicit_and_touch_is_not_effective() -> None:
    registry = build_mvp_production_registry()

    launch = registry.definition("automation.launchAndroidApp")
    key = registry.definition("automation.pressAndroidKey")
    swipe = registry.definition("automation.swipe")
    assert launch is not None
    assert key is not None
    assert swipe is not None
    assert [item.root for item in launch.required_capabilities or []] == [
        "automation.launchAndroidApp"
    ]
    assert [item.root for item in key.required_capabilities or []] == [
        "automation.pressAndroidKey"
    ]
    assert [item.root for item in swipe.required_capabilities or []] == [
        "automation.swipe"
    ]

    launch_schema = json.loads(launch.model_dump_json(by_alias=True))
    key_schema = json.loads(key.model_dump_json(by_alias=True))
    swipe_schema = json.loads(swipe.model_dump_json(by_alias=True))
    intent_property = launch_schema["propertySchema"]["properties"]["intent"]
    assert intent_property["maxLength"] == 255
    assert intent_property["pattern"].startswith("^")
    assert intent_property["pattern"].endswith("$")
    assert key_schema["propertySchema"]["properties"]["key"]["enum"] == ["escape"]
    assert (
        swipe_schema["propertySchema"]["properties"]["durationMilliseconds"]["maximum"]
        == 60_000
    )

    availability = registry.availability(
        [
            "automation.touchAction",
            "automation.launchAndroidApp",
            "automation.pressAndroidKey",
            "automation.swipe",
        ]
    )
    assert "automation.touchAction" not in availability.effective_capabilities
    assert availability.is_available("automation.launchAndroidApp")
    assert availability.is_available("automation.pressAndroidKey")
    assert availability.is_available("automation.swipe")


def test_only_reviewed_actions_expose_known_failure_execution_ports() -> None:
    registry = build_mvp_production_registry()
    expected = {
        "automation.clickPoint",
        "automation.clickRectCenter",
        "automation.swipe",
    }

    for type_key in expected:
        definition = registry.definition(type_key)
        assert definition is not None
        assert "failed" in {port.port_id.root for port in definition.ports}

    for type_key in (
        "automation.touchAction",
        "automation.launchAndroidApp",
        "automation.pressAndroidKey",
    ):
        definition = registry.definition(type_key)
        assert definition is not None
        assert "failed" not in {port.port_id.root for port in definition.ports}


def test_geometry_nodes_require_an_image_and_explicit_authoring_coordinates() -> None:
    registry = build_phase_4_production_registry()
    point = registry.definition("core.geometry.point")
    rectangle = registry.definition("core.geometry.rectangle")

    assert point is not None
    assert rectangle is not None
    assert point.runtime_kind.value == "pure"
    assert rectangle.runtime_kind.value == "pure"
    point_ports = {port.port_id.root: port for port in point.ports}
    rectangle_ports = {port.port_id.root: port for port in rectangle.ports}
    assert point_ports["image"].required is True
    assert point_ports["image"].accepts_literal is not True
    assert rectangle_ports["image"].required is True
    assert rectangle_ports["image"].accepts_literal is not True
    assert {
        port_id for port_id, port in point_ports.items() if port.accepts_literal is True
    } == {"x", "y", "referenceWidth", "referenceHeight"}
    assert {
        port_id
        for port_id, port in rectangle_ports.items()
        if port.accepts_literal is True
    } == {
        "x",
        "y",
        "width",
        "height",
        "referenceWidth",
        "referenceHeight",
    }


def test_number_compare_operator_schema_exposes_option_labels() -> None:
    definition = build_mvp_production_registry().definition("core.logic.numberCompare")
    assert definition is not None

    schema = json.loads(definition.model_dump_json(by_alias=True))
    operator = schema["propertySchema"]["properties"]["operator"]
    values = [
        "greaterThan",
        "greaterThanOrEqual",
        "lessThan",
        "lessThanOrEqual",
        "equalTo",
        "notEqualTo",
    ]
    assert operator["enum"] == values
    assert operator["x-rinoOptionLabelKeys"] == {
        value: f"node.core.logic.numberCompare.property.operator.option.{value}"
        for value in values
    }


def test_mvp_registry_exposes_grouped_recognition_authoring_templates() -> None:
    registry = build_mvp_production_registry()
    templates = {
        template.template_key: template
        for template in registry.snapshot().workflow_templates or []
    }

    image = templates["template.imageRecognition"]
    text = templates["template.textRecognition"]
    assert "template.imageRecognitionAndClick" not in templates
    assert "template.textRecognitionAndClick" not in templates
    assert image.workflow_group is not None
    assert image.workflow_group.kind.value == "imageRecognition"
    assert {member.role for member in image.workflow_group.members} == {
        "delay",
        "capture",
        "recognizer",
        "templateAsset",
        "roi",
        "matchBranch",
        "visibleOcr",
        "click",
    }
    assert {port.proxy_port_id.root for port in image.workflow_group.exposed_ports} == {
        "run",
        "templates",
        "regions",
        "matched",
        "matchValue",
        "image",
        "noMatch",
        "next",
    }
    image_edges = {
        (
            edge.source_placeholder_id,
            edge.source_port_id.root,
            edge.target_placeholder_id,
            edge.target_port_id.root,
        )
        for edge in image.edges or []
    }
    assert (
        "templateAsset",
        "image",
        "recognizer",
        "template",
    ) in image_edges
    assert ("capture", "image", "roi", "image") in image_edges
    image_click_node = next(
        node for node in image.nodes if node.placeholder_id == "click"
    )
    assert image_click_node.type_key.root == "core.flow.sequence"
    assert ("visibleOcr", "next", "click", "run") in image_edges
    assert text.workflow_group is not None
    assert text.workflow_group.kind.value == "textRecognition"
    assert {member.role for member in text.workflow_group.members} == {
        "delay",
        "capture",
        "recognizer",
        "roi",
        "matchBranch",
        "click",
        "clickPoint",
    }
    assert {port.proxy_port_id.root for port in text.workflow_group.exposed_ports} == {
        "run",
        "regions",
        "matched",
        "matchValue",
        "image",
        "noMatch",
        "next",
    }
    text_edges = {
        (
            edge.source_placeholder_id,
            edge.source_port_id.root,
            edge.target_placeholder_id,
            edge.target_port_id.root,
        )
        for edge in text.edges or []
    }
    assert ("capture", "image", "roi", "image") in text_edges
    text_click_node = next(
        node for node in text.nodes if node.placeholder_id == "click"
    )
    text_click_point_node = next(
        node for node in text.nodes if node.placeholder_id == "clickPoint"
    )
    assert text_click_node.type_key.root == "core.flow.sequence"
    assert text_click_point_node.type_key.root == "core.geometry.point"
    assert ("matchBranch", "whenTrue", "click", "run") in text_edges
    assert ("capture", "image", "clickPoint", "image") in text_edges
    assert {
        node.type_key.root for node in image.nodes + text.nodes
    } <= registry.type_keys


def test_mvp_snapshot_matches_the_frontend_development_fixture() -> None:
    snapshot = build_mvp_production_registry().snapshot()
    expected = json.loads(snapshot.model_dump_json(by_alias=True, exclude_none=True))
    fixture_path = (
        REPOSITORY_ROOT
        / "contracts"
        / "fixtures"
        / "registry"
        / "valid"
        / "core-definitions.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))

    assert fixture == expected
    template_keys = {
        template["templateKey"] for template in fixture.get("workflowTemplates", [])
    }
    assert "template.imageRecognitionAndClick" not in template_keys
    assert "template.textRecognitionAndClick" not in template_keys
    assert {
        "template.imageRecognition",
        "template.textRecognition",
    } <= template_keys


def test_test_registry_explicitly_adds_fakes_without_changing_production() -> None:
    production = build_phase_4_production_registry()
    test_registry = build_phase_4_test_registry(InMemoryFakeActionRecorder())

    assert production.type_keys == PHASE_4_PRODUCTION_NODE_TYPE_KEYS
    assert (
        test_registry.type_keys
        == PHASE_4_PRODUCTION_NODE_TYPE_KEYS | TEST_NODE_TYPE_KEYS
    )
    assert production.type_keys.isdisjoint(TEST_NODE_TYPE_KEYS)


def test_registry_hash_is_deterministic_and_changes_with_content() -> None:
    first = build_phase_4_production_registry().snapshot()
    second = build_phase_4_production_registry().snapshot()
    test_snapshot = build_phase_4_test_registry(InMemoryFakeActionRecorder()).snapshot()

    assert first.registry_version == second.registry_version
    assert first.registry_version != test_snapshot.registry_version


def test_registry_hash_does_not_depend_on_registration_order() -> None:
    type_keys = ("core.value.numberLiteral", "core.logic.numberCompare")
    first = NodeRegistryBuilder(type_keys)
    second = NodeRegistryBuilder(type_keys)

    for type_key in type_keys:
        first.register(
            NodeRegistration(_shared_definition(type_key), _StaticExecutor(type_key))
        )
    for type_key in reversed(type_keys):
        second.register(
            NodeRegistration(_shared_definition(type_key), _StaticExecutor(type_key))
        )

    assert (
        first.build().snapshot().registry_version
        == second.build().snapshot().registry_version
    )


def test_registry_rejects_unallowlisted_duplicate_and_mismatched_registration() -> None:
    definition = _shared_definition("vision.ocr")
    disallowed = NodeRegistryBuilder(PHASE_4_PRODUCTION_NODE_TYPE_KEYS)

    with pytest.raises(ValueError, match="allowlist"):
        disallowed.register(NodeRegistration(definition, _OcrExecutor()))

    allowed = NodeRegistryBuilder({"vision.ocr"})
    allowed.register(NodeRegistration(definition, _OcrExecutor()))
    with pytest.raises(ValueError, match="Duplicate"):
        allowed.register(NodeRegistration(definition, _OcrExecutor()))

    mismatched = NodeRegistryBuilder({"vision.ocr"})
    with pytest.raises(ValueError, match="does not match"):
        mismatched.register(NodeRegistration(definition, _WrongExecutor()))


def test_backend_advertisements_never_add_registry_entries() -> None:
    registry = build_phase_4_production_registry()
    before = registry.type_keys

    availability = registry.availability(
        [
            "vision.ocr",
            "vision.neuralDetection",
            "vision.classification",
            "model.executeOnnx",
            "plugin.customRecognition",
        ]
    )

    assert registry.type_keys == before
    assert availability.effective_capabilities == {"vision.ocr"}
    assert availability.advertised_capabilities > availability.effective_capabilities
    assert set(availability.effective_capabilities) <= set(
        MVP_BACKEND_CAPABILITY_ALLOWLIST
    )
    assert all(registry.definition(type_key) is not None for type_key in before)
    assert registry.definition("vision.neuralDetection") is None
    assert registry.executor("model.executeOnnx") is None


def test_allowlisted_ocr_becomes_available_without_model_selection() -> None:
    definition = _shared_definition("vision.ocr")
    serialized = definition.model_dump(
        mode="json",
        by_alias=True,
        exclude_none=True,
    )
    assert "modelPath" not in json.dumps(serialized)
    assert "modelUrl" not in json.dumps(serialized)

    builder = NodeRegistryBuilder({"vision.ocr"})
    builder.register(NodeRegistration(definition, _OcrExecutor()))
    registry = builder.build()

    assert not registry.availability([]).is_available("vision.ocr")
    assert registry.availability(["vision.ocr"]).is_available("vision.ocr")
    assert registry.availability(["vision.ocr", "vision.neuralDetection"]).is_available(
        "vision.ocr"
    )
    assert registry.type_keys == {"vision.ocr"}


def test_workflow_template_expands_only_into_registered_independent_nodes() -> None:
    registry = build_phase_4_production_registry()
    snapshot = registry.snapshot()
    templates = snapshot.workflow_templates or []

    assert len(templates) == 1
    template = templates[0]
    assert template.template_key == "template.compareNumbersAndBranch"
    assert {node.type_key.root for node in template.nodes} <= registry.type_keys
    assert {node.type_key.root for node in template.nodes} == {
        "core.flow.start",
        "core.logic.numberCompare",
        "core.logic.branch",
    }


def test_numeric_recognition_template_uses_only_independent_production_nodes() -> None:
    registry = build_phase_4_fake_backend_registry(
        FakeAutomationBackend(FakeAutomationScenario())
    )
    templates = {
        template.template_key: template
        for template in registry.snapshot().workflow_templates or []
    }

    template = templates["template.recognizeNumberAndBranch"]
    type_keys = {node.type_key.root for node in template.nodes}
    assert type_keys <= registry.type_keys
    assert not any(type_key.startswith("test.") for type_key in type_keys)
    assert type_keys == {
        "automation.captureScreen",
        "core.diagnostic.log",
        "core.logic.branch",
        "core.logic.numberCompare",
        "text.parseNumber",
        "vision.ocr",
    }
    assert len(template.nodes) == 8
    assert len(template.edges or []) == 11


@pytest.mark.parametrize(
    ("template", "message"),
    [
        (
            {
                "templateKey": "template.invalidLiteral",
                "titleKey": "template.invalidLiteral.title",
                "descriptionKey": "template.invalidLiteral.description",
                "iconKey": "category.logic",
                "nodes": [
                    {
                        "placeholderId": "start",
                        "typeKey": "core.flow.start",
                        "offset": {"x": 0, "y": 0},
                        "inputValues": {"next": 1},
                    }
                ],
            },
            "literal input",
        ),
        (
            {
                "templateKey": "template.invalidDirection",
                "titleKey": "template.invalidDirection.title",
                "descriptionKey": "template.invalidDirection.description",
                "iconKey": "category.logic",
                "nodes": [
                    {
                        "placeholderId": "branch",
                        "typeKey": "core.logic.branch",
                        "offset": {"x": 0, "y": 0},
                    },
                    {
                        "placeholderId": "compare",
                        "typeKey": "core.logic.numberCompare",
                        "offset": {"x": 300, "y": 0},
                    },
                ],
                "edges": [
                    {
                        "edgeKind": "data",
                        "sourcePlaceholderId": "branch",
                        "sourcePortId": "condition",
                        "targetPlaceholderId": "compare",
                        "targetPortId": "left",
                    }
                ],
            },
            "invalid direction",
        ),
    ],
)
def test_workflow_template_rejects_invalid_literals_and_edges(
    template: dict[str, object], message: str
) -> None:
    type_keys = {
        "core.flow.start",
        "core.logic.branch",
        "core.logic.numberCompare",
    }
    builder = NodeRegistryBuilder(type_keys)
    for type_key in type_keys:
        builder.register(
            NodeRegistration(_shared_definition(type_key), _StaticExecutor(type_key))
        )

    with pytest.raises(ValueError, match=message):
        builder.add_workflow_template(WorkflowTemplateV1.model_validate(template))


def test_snapshot_is_a_copy_and_cannot_mutate_the_registry() -> None:
    registry = build_phase_4_production_registry()
    snapshot = registry.snapshot()
    snapshot.definitions.clear()

    assert registry.type_keys == PHASE_4_PRODUCTION_NODE_TYPE_KEYS
    assert registry.snapshot().definitions
    assert registry.executor("core.flow.start") is not None


@pytest.mark.asyncio
async def test_registry_rejects_invalid_executor_outputs_before_commit() -> None:
    definition = _shared_definition("vision.ocr")
    builder = NodeRegistryBuilder({"vision.ocr"})
    builder.register(NodeRegistration(definition, _InvalidOcrExecutor()))
    registry = builder.build()

    with pytest.raises(ValueError, match="undeclared data output"):
        await registry.execute(
            "vision.ocr",
            NodeExecutionContext(
                node_id=UUID("3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f"),
                type_key="vision.ocr",
            ),
        )
