"""Validated node registration, immutable snapshots, and capability gating."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final, Protocol, cast

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError
from pydantic import BaseModel

from rino_runtime.contracts.generated.rino_registry_v1 import (
    NodeDefinitionV1,
    PortDirectionV1,
    PortKindV1,
    PrimitiveTypeKindV1,
    PrimitiveTypeV1,
    RinoNodeRegistrySnapshotV1,
    RuntimeKindV1,
    SideEffectV1,
    WorkflowTemplateV1,
)
from rino_runtime.graph.validation import is_assignable, maximum_connections
from rino_runtime.nodes.execution import (
    NodeExecutionContext,
    NodeExecutionResult,
    NodeExecutor,
    RuntimeValue,
    runtime_value_matches,
)

PHASE_4_PRODUCTION_NODE_TYPE_KEYS: Final[frozenset[str]] = frozenset(
    {
        "core.flow.start",
        "core.flow.stop",
        "core.flow.endPath",
        "core.flow.sequence",
        "core.flow.sequenceOrder",
        "core.flow.boundedRetry",
        "core.flow.runCounter",
        "core.logic.taskChoice",
        "core.logic.caseOverlayBool",
        "core.logic.caseOverlayNumber",
        "core.logic.caseOverlayImageRef",
        "core.flow.parallel",
        "core.logic.branch",
        "core.logic.numberCompare",
        "core.logic.numberSelect",
        "core.math.arithmetic",
        "core.math.expression",
        "core.collection.imageList",
        "core.collection.regionList",
        "core.collection.pointList",
        "core.value.numberLiteral",
        "core.value.stringLiteral",
        "core.geometry.point",
        "core.geometry.rectangle",
        "core.image.projectAsset",
        "core.variable.getBool",
        "core.variable.setBool",
        "core.variable.getNumber",
        "core.variable.setNumber",
        "core.variable.getString",
        "core.variable.setString",
        "core.variable.getPoint",
        "core.variable.setPoint",
        "core.variable.getRect",
        "core.variable.setRect",
        "core.variable.getImageRef",
        "core.variable.setImageRef",
        "core.time.delay",
        "core.diagnostic.log",
        "text.parseNumber",
        "text.readText",
        "text.readNumber",
        "text.readValue",
    }
)
TEST_NODE_TYPE_KEYS: Final[frozenset[str]] = frozenset(
    {"test.fake.ocr", "test.fake.action"}
)
MVP_MAA_NODE_TYPE_KEYS: Final[frozenset[str]] = frozenset(
    {
        "automation.captureScreen",
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
)
MVP_PRODUCTION_NODE_TYPE_KEYS: Final[frozenset[str]] = (
    PHASE_4_PRODUCTION_NODE_TYPE_KEYS | MVP_MAA_NODE_TYPE_KEYS
)
MVP_BACKEND_CAPABILITY_ALLOWLIST: Final[frozenset[str]] = frozenset(
    {
        "automation.captureScreen",
        "vision.ocr",
        "vision.templateMatch",
        "vision.featureMatch",
        "vision.colorMatch",
        "automation.clickPoint",
        "automation.clickRectCenter",
        "automation.launchAndroidApp",
        "automation.pressAndroidKey",
        "automation.swipe",
    }
)


class _PropertyValidator(Protocol):
    def validate(self, instance: object) -> None: ...


@dataclass(frozen=True, slots=True)
class NodeRegistration:
    definition: NodeDefinitionV1
    executor: NodeExecutor


@dataclass(frozen=True, slots=True)
class RegistryAvailability:
    advertised_capabilities: frozenset[str]
    effective_capabilities: frozenset[str]
    available_type_keys: frozenset[str]
    unavailable_requirements: Mapping[str, tuple[str, ...]]

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "unavailable_requirements",
            MappingProxyType(dict(self.unavailable_requirements)),
        )

    def is_available(self, type_key: str) -> bool:
        return type_key in self.available_type_keys


class NodeRegistry:
    """An immutable set of reviewed definitions paired with local executors."""

    def __init__(
        self,
        registrations: Mapping[str, NodeRegistration],
        workflow_templates: tuple[WorkflowTemplateV1, ...],
    ) -> None:
        self._registrations = MappingProxyType(dict(registrations))
        self._workflow_templates = workflow_templates
        self._snapshot = _build_snapshot(registrations, workflow_templates)

    @property
    def type_keys(self) -> frozenset[str]:
        return frozenset(self._registrations)

    def snapshot(self) -> RinoNodeRegistrySnapshotV1:
        return self._snapshot.model_copy(deep=True)

    def definition(self, type_key: str) -> NodeDefinitionV1 | None:
        registration = self._registrations.get(type_key)
        return registration.definition if registration is not None else None

    def executor(self, type_key: str) -> NodeExecutor | None:
        registration = self._registrations.get(type_key)
        return registration.executor if registration is not None else None

    async def execute(
        self,
        type_key: str,
        context: NodeExecutionContext,
    ) -> NodeExecutionResult:
        registration = self._registrations.get(type_key)
        if registration is None:
            raise LookupError("Node type is not registered.")
        if context.type_key != type_key:
            raise ValueError("Execution context type key does not match dispatch.")
        result = await registration.executor.execute(context)
        _validate_execution_result(registration.definition, result)
        return result

    def availability(
        self, advertised_capabilities: Iterable[str]
    ) -> RegistryAvailability:
        advertised = frozenset(advertised_capabilities)
        effective = advertised & MVP_BACKEND_CAPABILITY_ALLOWLIST
        available: set[str] = set()
        missing_by_type: dict[str, tuple[str, ...]] = {}
        for type_key, registration in self._registrations.items():
            requirements = tuple(
                capability.root
                for capability in registration.definition.required_capabilities or []
            )
            missing = tuple(
                capability for capability in requirements if capability not in effective
            )
            if missing:
                missing_by_type[type_key] = missing
            else:
                available.add(type_key)
        return RegistryAvailability(
            advertised_capabilities=advertised,
            effective_capabilities=effective,
            available_type_keys=frozenset(available),
            unavailable_requirements=missing_by_type,
        )


class NodeRegistryBuilder:
    """Builds a registry only from an explicit type-key allowlist."""

    def __init__(self, allowed_type_keys: Iterable[str]) -> None:
        self._allowed_type_keys = frozenset(allowed_type_keys)
        self._registrations: dict[str, NodeRegistration] = {}
        self._workflow_templates: dict[str, WorkflowTemplateV1] = {}

    def register(self, registration: NodeRegistration) -> None:
        definition = registration.definition
        type_key = definition.type_key.root
        if type_key not in self._allowed_type_keys:
            raise ValueError("Node type is not present in this registry's allowlist.")
        if type_key in self._registrations:
            raise ValueError("Duplicate node registration.")
        if registration.executor.type_key != type_key:
            raise ValueError("Node executor type key does not match its definition.")
        _validate_definition(definition)
        self._registrations[type_key] = registration

    def add_workflow_template(self, template: WorkflowTemplateV1) -> None:
        template_key = template.template_key
        if template_key in self._workflow_templates:
            raise ValueError("Duplicate workflow template registration.")
        _validate_template(template, self._registrations)
        self._workflow_templates[template_key] = template

    def build(self) -> NodeRegistry:
        return NodeRegistry(
            self._registrations,
            tuple(self._workflow_templates.values()),
        )


def _validate_definition(definition: NodeDefinitionV1) -> None:
    ports: set[str] = set()
    has_execution_input = False
    for port in definition.ports:
        port_id = port.port_id.root
        if port_id in ports:
            raise ValueError("Duplicate port identifier in node definition.")
        ports.add(port_id)
        value_type = port.type.root
        is_exec_type = (
            isinstance(value_type, PrimitiveTypeV1)
            and value_type.kind is PrimitiveTypeKindV1.exec
        )
        if (port.port_kind is PortKindV1.execution) != is_exec_type:
            raise ValueError("Execution port kind and value type must agree.")
        if port.port_kind is PortKindV1.execution and port.direction.value == "input":
            has_execution_input = True

    if definition.runtime_kind is RuntimeKindV1.pure:
        if definition.side_effect is not SideEffectV1.none:
            raise ValueError("A pure node cannot declare side effects.")
        if any(port.port_kind is PortKindV1.execution for port in definition.ports):
            raise ValueError("A pure node cannot declare execution ports.")
    if definition.runtime_kind is RuntimeKindV1.entry and has_execution_input:
        raise ValueError("An entry node cannot declare an execution input.")

    property_schema = (
        definition.property_schema.root
        if definition.property_schema is not None
        else None
    )
    property_defaults = (
        definition.property_defaults.root
        if definition.property_defaults is not None
        else None
    )
    if property_defaults is not None and property_schema is None:
        raise ValueError("Property defaults require a property schema.")
    if property_schema is not None:
        raw_schema_value = _unwrap_json_value(property_schema)
        if not isinstance(raw_schema_value, dict):
            raise ValueError("Property schema must be a JSON object.")
        raw_schema = cast("dict[str, object]", raw_schema_value)
        try:
            Draft202012Validator.check_schema(raw_schema)
            if property_defaults is not None:
                validator = cast("_PropertyValidator", Draft202012Validator(raw_schema))
                validator.validate(_unwrap_json_value(property_defaults))
        except (SchemaError, ValidationError) as error:
            raise ValueError("Invalid node property schema or defaults.") from error


def _validate_execution_result(
    definition: NodeDefinitionV1,
    result: NodeExecutionResult,
) -> None:
    data_outputs = {
        port.port_id.root: port
        for port in definition.ports
        if port.direction is PortDirectionV1.output
        and port.port_kind is PortKindV1.data
    }
    execution_outputs = {
        port.port_id.root
        for port in definition.ports
        if port.direction is PortDirectionV1.output
        and port.port_kind is PortKindV1.execution
    }
    for port_id, value in result.outputs.items():
        port = data_outputs.get(port_id)
        if port is None:
            raise ValueError("Executor returned an undeclared data output.")
        if not runtime_value_matches(port.type, value):
            raise ValueError("Executor returned a value with the wrong output type.")
    if not set(result.selected_execution_outputs) <= execution_outputs:
        raise ValueError("Executor selected an undeclared execution output.")
    if len(result.logs) > 100 or any(
        len(entry.message) > 4096 for entry in result.logs
    ):
        raise ValueError("Executor returned unbounded log output.")


def _validate_template(
    template: WorkflowTemplateV1,
    registrations: Mapping[str, NodeRegistration],
) -> None:
    placeholders: dict[str, NodeDefinitionV1] = {}
    for node in template.nodes:
        if node.placeholder_id in placeholders:
            raise ValueError("Duplicate workflow template placeholder.")
        registration = registrations.get(node.type_key.root)
        if registration is None:
            raise ValueError("Workflow template references an unregistered node type.")
        placeholders[node.placeholder_id] = registration.definition
        ports = {port.port_id.root: port for port in registration.definition.ports}
        for port_id, wrapped_value in (node.input_values or {}).items():
            port = ports.get(port_id)
            if port is None:
                raise ValueError("Workflow template input targets an unknown port.")
            if (
                port.direction is not PortDirectionV1.input
                or port.port_kind is not PortKindV1.data
                or port.accepts_literal is not True
            ):
                raise ValueError(
                    "Workflow template input targets a port without literal input."
                )
            value = _template_runtime_value(wrapped_value)
            if not runtime_value_matches(port.type, value):
                raise ValueError("Workflow template input has the wrong value type.")

        if node.properties is not None:
            property_schema = registration.definition.property_schema
            if property_schema is None:
                raise ValueError(
                    "Workflow template properties target a node without properties."
                )
            defaults = _unwrap_json_value(
                registration.definition.property_defaults or {}
            )
            overrides = _unwrap_json_value(node.properties)
            schema = _unwrap_json_value(property_schema)
            if (
                not isinstance(defaults, dict)
                or not isinstance(overrides, dict)
                or not isinstance(schema, dict)
            ):
                raise ValueError("Workflow template property data must be objects.")
            merged_properties = {**defaults, **overrides}
            try:
                Draft202012Validator(schema).validate(merged_properties)
            except ValidationError as error:
                raise ValueError("Workflow template properties are invalid.") from error

    template_proxy_port_ids: set[str] = set()
    for exposed in template.exposed_ports or []:
        proxy_port_id = exposed.proxy_port_id.root
        if proxy_port_id in template_proxy_port_ids:
            raise ValueError("Duplicate template proxy port.")
        definition = placeholders.get(exposed.placeholder_id)
        if definition is None:
            raise ValueError("Template port references an unknown placeholder.")
        if not any(
            port.port_id.root == exposed.port_id.root for port in definition.ports
        ):
            raise ValueError("Template exposes an unknown node port.")
        template_proxy_port_ids.add(proxy_port_id)

    workflow_group = template.workflow_group
    if workflow_group is not None:
        member_roles: set[str] = set()
        member_placeholders: set[str] = set()
        for member in workflow_group.members:
            if member.role in member_roles:
                raise ValueError("Duplicate workflow group member role.")
            if member.placeholder_id in member_placeholders:
                raise ValueError("Duplicate workflow group member placeholder.")
            if member.placeholder_id not in placeholders:
                raise ValueError("Workflow group references an unknown placeholder.")
            member_roles.add(member.role)
            member_placeholders.add(member.placeholder_id)
        if member_placeholders != set(placeholders):
            raise ValueError("Workflow group must include every template node.")

        proxy_port_ids: set[str] = set()
        for exposed in workflow_group.exposed_ports:
            proxy_port_id = exposed.proxy_port_id.root
            if proxy_port_id in proxy_port_ids:
                raise ValueError("Duplicate workflow group proxy port.")
            definition = placeholders.get(exposed.placeholder_id)
            if definition is None:
                raise ValueError(
                    "Workflow group port references an unknown placeholder."
                )
            if not any(
                port.port_id.root == exposed.port_id.root for port in definition.ports
            ):
                raise ValueError("Workflow group exposes an unknown node port.")
            proxy_port_ids.add(proxy_port_id)

    edge_signatures: set[tuple[str, str, str, str]] = set()
    connection_counts: dict[tuple[str, str], int] = {}
    for edge in template.edges or []:
        source = placeholders.get(edge.source_placeholder_id)
        target = placeholders.get(edge.target_placeholder_id)
        if source is None or target is None:
            raise ValueError(
                "Workflow template edge references an unknown placeholder."
            )
        source_ports = {port.port_id.root: port for port in source.ports}
        target_ports = {port.port_id.root: port for port in target.ports}
        source_port = source_ports.get(edge.source_port_id.root)
        target_port = target_ports.get(edge.target_port_id.root)
        if source_port is None or target_port is None:
            raise ValueError("Workflow template edge references an unknown port.")
        signature = (
            edge.source_placeholder_id,
            edge.source_port_id.root,
            edge.target_placeholder_id,
            edge.target_port_id.root,
        )
        if signature in edge_signatures:
            raise ValueError("Duplicate workflow template edge.")
        edge_signatures.add(signature)
        if (
            source_port.direction is not PortDirectionV1.output
            or target_port.direction is not PortDirectionV1.input
        ):
            raise ValueError("Workflow template edge has an invalid direction.")
        if (
            source_port.port_kind is not target_port.port_kind
            or source_port.port_kind.value != edge.edge_kind.value
        ):
            raise ValueError("Workflow template edge kind does not match its ports.")
        if not is_assignable(source_port.type, target_port.type):
            raise ValueError("Workflow template edge connects incompatible port types.")
        for placeholder_id, port in (
            (edge.source_placeholder_id, source_port),
            (edge.target_placeholder_id, target_port),
        ):
            key = (placeholder_id, port.port_id.root)
            used = connection_counts.get(key, 0) + 1
            connection_counts[key] = used
            maximum = maximum_connections(port)
            if maximum is not None and used > maximum:
                raise ValueError("Workflow template edge exceeds port cardinality.")


def _build_snapshot(
    registrations: Mapping[str, NodeRegistration],
    workflow_templates: tuple[WorkflowTemplateV1, ...],
) -> RinoNodeRegistrySnapshotV1:
    definitions = sorted(
        [
            registration.definition.model_dump(
                mode="json",
                by_alias=True,
                exclude_none=True,
            )
            for registration in registrations.values()
        ],
        key=lambda definition: definition["typeKey"],
    )
    templates = sorted(
        [
            template.model_dump(mode="json", by_alias=True, exclude_none=True)
            for template in workflow_templates
        ],
        key=lambda template: template["templateKey"],
    )
    content = {"definitions": definitions, "workflowTemplates": templates}
    canonical = json.dumps(
        content,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return RinoNodeRegistrySnapshotV1.model_validate(
        {
            "schemaVersion": 1,
            "registryVersion": hashlib.sha256(canonical).hexdigest(),
            "definitions": definitions,
            **({"workflowTemplates": templates} if templates else {}),
        }
    )


def _unwrap_json_value(value: object) -> object:
    if isinstance(value, BaseModel):
        return _unwrap_json_value(
            value.model_dump(mode="python", by_alias=True, exclude_none=True)
        )
    if isinstance(value, dict):
        source = cast("dict[object, object]", value)
        result: dict[str, object] = {}
        for key, item in source.items():
            if not isinstance(key, str):
                raise ValueError("JSON object keys must be strings.")
            result[key] = _unwrap_json_value(item)
        return result
    if isinstance(value, list | tuple):
        source = cast("list[object] | tuple[object, ...]", value)
        return [_unwrap_json_value(item) for item in source]
    return value


def _template_runtime_value(value: object) -> RuntimeValue:
    unwrapped = _unwrap_json_value(value)
    if unwrapped is None or isinstance(unwrapped, bool | int | float | str):
        return unwrapped
    if isinstance(unwrapped, list):
        source = cast("list[object]", unwrapped)
        return tuple(_template_runtime_value(item) for item in source)
    raise ValueError("Workflow template input uses an unsupported literal shape.")
