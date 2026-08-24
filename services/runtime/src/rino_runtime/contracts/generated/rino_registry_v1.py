# Generated from contracts/registry/rino-registry-v1.schema.json. Do not edit directly.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, RootModel


class JsonValue1(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="Any JSON value. Integer is listed ahead of number so generated models keep whole numbers integral instead of widening them to floating point.",
            max_length=65536,
            title="JsonValue",
        ),
    ]


class NodeTypeKeyV1(RootModel[str]):
    root: Annotated[
        str,
        Field(
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
            title="NodeTypeKeyV1",
        ),
    ]


class PortIdV1(RootModel[str]):
    root: Annotated[
        str, Field(max_length=64, pattern="^[a-z][a-zA-Z0-9]*$", title="PortIdV1")
    ]


class CapabilityKeyV1(RootModel[str]):
    root: Annotated[
        str,
        Field(
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
            title="CapabilityKeyV1",
        ),
    ]


class LocalizationKeyV1(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="The registry sends localization keys rather than translated text, so node names follow the user's language.",
            max_length=200,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-zA-Z0-9]+)+$",
            title="LocalizationKeyV1",
        ),
    ]


class IconKeyV1(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="Resolved through the bundled static icon mapping. A project or runtime cannot supply image bytes or a remote icon address.",
            max_length=64,
            pattern="^[a-z][a-zA-Z0-9]*\\.[a-zA-Z0-9]+$",
            title="IconKeyV1",
        ),
    ]


class PrimitiveTypeKindV1(StrEnum):
    exec = "exec"
    bool = "bool"
    number = "number"
    string = "string"
    point = "point"
    rect = "rect"
    image_ref = "imageRef"
    ocr_candidate = "ocrCandidate"
    ocr_result = "ocrResult"


class PrimitiveTypeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: PrimitiveTypeKindV1


class PortDirectionV1(StrEnum):
    input = "input"
    output = "output"


class PortKindV1(StrEnum):
    execution = "execution"
    data = "data"


class RuntimeKindV1(StrEnum):
    entry = "entry"
    execution = "execution"
    pure = "pure"


class SideEffectV1(StrEnum):
    none = "none"
    runtime = "runtime"
    device_read = "deviceRead"
    device_write = "deviceWrite"
    diagnostic = "diagnostic"


class NodeCategoryV1(StrEnum):
    flow = "flow"
    logic = "logic"
    values = "values"
    text = "text"
    vision = "vision"
    device = "device"
    timing = "timing"
    diagnostics = "diagnostics"


class DeprecationV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    reason_key: Annotated[LocalizationKeyV1, Field(alias="reasonKey")]
    replacement_type_key: Annotated[
        NodeTypeKeyV1 | None, Field(alias="replacementTypeKey")
    ] = None


class Offset(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    x: Annotated[float, Field(ge=-10000.0, le=10000.0)]
    y: Annotated[float, Field(ge=-10000.0, le=10000.0)]


class EdgeKind(StrEnum):
    execution = "execution"
    data = "data"


class TemplateEdgeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    edge_kind: Annotated[EdgeKind, Field(alias="edgeKind")]
    source_placeholder_id: Annotated[
        str,
        Field(
            alias="sourcePlaceholderId", max_length=64, pattern="^[a-z][a-zA-Z0-9]*$"
        ),
    ]
    source_port_id: Annotated[PortIdV1, Field(alias="sourcePortId")]
    target_placeholder_id: Annotated[
        str,
        Field(
            alias="targetPlaceholderId", max_length=64, pattern="^[a-z][a-zA-Z0-9]*$"
        ),
    ]
    target_port_id: Annotated[PortIdV1, Field(alias="targetPortId")]


class WorkflowGroupKindV1(StrEnum):
    image_recognition = "imageRecognition"
    text_recognition = "textRecognition"


class TemplateWorkflowGroupMemberV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    role: Annotated[str, Field(max_length=64, pattern="^[a-z][a-zA-Z0-9]*$")]
    placeholder_id: Annotated[
        str, Field(alias="placeholderId", max_length=64, pattern="^[a-z][a-zA-Z0-9]*$")
    ]


class TemplateWorkflowGroupPortV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    proxy_port_id: Annotated[PortIdV1, Field(alias="proxyPortId")]
    placeholder_id: Annotated[
        str, Field(alias="placeholderId", max_length=64, pattern="^[a-z][a-zA-Z0-9]*$")
    ]
    port_id: Annotated[PortIdV1, Field(alias="portId")]
    label_key: Annotated[LocalizationKeyV1, Field(alias="labelKey")]


class TemplateWorkflowGroupV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: WorkflowGroupKindV1
    members: Annotated[
        list[TemplateWorkflowGroupMemberV1], Field(max_length=32, min_length=1)
    ]
    exposed_ports: Annotated[
        list[TemplateWorkflowGroupPortV1], Field(alias="exposedPorts", max_length=32)
    ]


class RinoRegistryArtifactCatalog(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    capability_key_v1: Annotated[
        CapabilityKeyV1 | None, Field(alias="capabilityKeyV1")
    ] = None
    collection_type_v1: Annotated[
        CollectionTypeV1 | None, Field(alias="collectionTypeV1")
    ] = None
    deprecation_v1: Annotated[DeprecationV1 | None, Field(alias="deprecationV1")] = None
    icon_key_v1: Annotated[IconKeyV1 | None, Field(alias="iconKeyV1")] = None
    json_object: Annotated[JsonObject | None, Field(alias="jsonObject")] = None
    json_value: Annotated[JsonValue | None, Field(alias="jsonValue")] = None
    localization_key_v1: Annotated[
        LocalizationKeyV1 | None, Field(alias="localizationKeyV1")
    ] = None
    node_category_v1: Annotated[
        NodeCategoryV1 | None, Field(alias="nodeCategoryV1")
    ] = None
    node_definition_v1: Annotated[
        NodeDefinitionV1 | None, Field(alias="nodeDefinitionV1")
    ] = None
    node_type_key_v1: Annotated[NodeTypeKeyV1 | None, Field(alias="nodeTypeKeyV1")] = (
        None
    )
    optional_type_v1: Annotated[
        OptionalTypeV1 | None, Field(alias="optionalTypeV1")
    ] = None
    port_definition_v1: Annotated[
        PortDefinitionV1 | None, Field(alias="portDefinitionV1")
    ] = None
    port_direction_v1: Annotated[
        PortDirectionV1 | None, Field(alias="portDirectionV1")
    ] = None
    port_id_v1: Annotated[PortIdV1 | None, Field(alias="portIdV1")] = None
    port_kind_v1: Annotated[PortKindV1 | None, Field(alias="portKindV1")] = None
    primitive_type_kind_v1: Annotated[
        PrimitiveTypeKindV1 | None, Field(alias="primitiveTypeKindV1")
    ] = None
    primitive_type_v1: Annotated[
        PrimitiveTypeV1 | None, Field(alias="primitiveTypeV1")
    ] = None
    runtime_kind_v1: Annotated[RuntimeKindV1 | None, Field(alias="runtimeKindV1")] = (
        None
    )
    side_effect_v1: Annotated[SideEffectV1 | None, Field(alias="sideEffectV1")] = None
    template_edge_v1: Annotated[
        TemplateEdgeV1 | None, Field(alias="templateEdgeV1")
    ] = None
    template_node_v1: Annotated[
        TemplateNodeV1 | None, Field(alias="templateNodeV1")
    ] = None
    template_workflow_group_member_v1: Annotated[
        TemplateWorkflowGroupMemberV1 | None,
        Field(alias="templateWorkflowGroupMemberV1"),
    ] = None
    template_workflow_group_port_v1: Annotated[
        TemplateWorkflowGroupPortV1 | None, Field(alias="templateWorkflowGroupPortV1")
    ] = None
    template_workflow_group_v1: Annotated[
        TemplateWorkflowGroupV1 | None, Field(alias="templateWorkflowGroupV1")
    ] = None
    type_descriptor_v1: Annotated[
        TypeDescriptorV1 | None, Field(alias="typeDescriptorV1")
    ] = None
    workflow_group_kind_v1: Annotated[
        WorkflowGroupKindV1 | None, Field(alias="workflowGroupKindV1")
    ] = None
    workflow_template_v1: Annotated[
        WorkflowTemplateV1 | None, Field(alias="workflowTemplateV1")
    ] = None
    rino_node_registry_snapshot_v1: Annotated[
        RinoNodeRegistrySnapshotV1 | None,
        Field(alias="rinoNodeRegistrySnapshotV1", title="RinoNodeRegistrySnapshotV1"),
    ] = None


class CollectionTypeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["collection"]
    element: TypeDescriptorV1


class JsonObject(RootModel[dict[str, Optional["JsonValue"]]]):
    root: Annotated[dict[str, JsonValue | None], Field(max_length=256)]


class JsonValue(
    RootModel[Optional[Union[bool, int, float, JsonValue1, "JsonValue2", JsonObject]]]
):
    root: Annotated[
        bool | int | float | JsonValue1 | JsonValue2 | JsonObject | None,
        Field(
            description="Any JSON value. Integer is listed ahead of number so generated models keep whole numbers integral instead of widening them to floating point.",
            title="JsonValue",
        ),
    ]


class JsonValue2(RootModel[list[JsonValue | None]]):
    root: Annotated[
        list[JsonValue | None],
        Field(
            description="Any JSON value. Integer is listed ahead of number so generated models keep whole numbers integral instead of widening them to floating point.",
            max_length=1024,
            title="JsonValue",
        ),
    ]


class NodeDefinitionV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    type_key: Annotated[NodeTypeKeyV1, Field(alias="typeKey")]
    type_version: Annotated[int, Field(alias="typeVersion", ge=1, le=1000)]
    runtime_kind: Annotated[RuntimeKindV1, Field(alias="runtimeKind")]
    side_effect: Annotated[SideEffectV1, Field(alias="sideEffect")]
    category: NodeCategoryV1
    title_key: Annotated[LocalizationKeyV1, Field(alias="titleKey")]
    description_key: Annotated[LocalizationKeyV1, Field(alias="descriptionKey")]
    icon_key: Annotated[IconKeyV1, Field(alias="iconKey")]
    keyword_keys: Annotated[
        list[LocalizationKeyV1] | None, Field(alias="keywordKeys", max_length=32)
    ] = None
    ports: Annotated[list[PortDefinitionV1], Field(max_length=64)]
    property_schema: Annotated[
        JsonObject | None,
        Field(
            alias="propertySchema",
            description="A validated schema for behavior configuration that is not supplied through data ports.",
        ),
    ] = None
    property_defaults: Annotated[JsonObject | None, Field(alias="propertyDefaults")] = (
        None
    )
    renderer_key: Annotated[
        str | None,
        Field(
            alias="rendererKey",
            description="Selects a bundled specialist editor from an allowlist. A project cannot load an arbitrary component.",
            max_length=64,
            pattern="^[a-z][a-zA-Z0-9]*$",
        ),
    ] = None
    required_capabilities: Annotated[
        list[CapabilityKeyV1] | None, Field(alias="requiredCapabilities", max_length=16)
    ] = None
    deprecation: DeprecationV1 | None = None


class OptionalTypeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["optional"]
    value: TypeDescriptorV1


class PortDefinitionV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    port_id: Annotated[PortIdV1, Field(alias="portId")]
    direction: PortDirectionV1
    port_kind: Annotated[PortKindV1, Field(alias="portKind")]
    type: TypeDescriptorV1
    label_key: Annotated[LocalizationKeyV1, Field(alias="labelKey")]
    description_key: Annotated[
        LocalizationKeyV1 | None, Field(alias="descriptionKey")
    ] = None
    required: Annotated[
        bool | None,
        Field(
            description="A required data input must be satisfied by an edge or a literal before a graph can run."
        ),
    ] = None
    allows_fan_out: Annotated[
        bool | None,
        Field(
            alias="allowsFanOut",
            description="Only meaningful for an execution output. A node that declares it selects several successors in a defined order.",
        ),
    ] = None
    accepts_literal: Annotated[
        bool | None,
        Field(
            alias="acceptsLiteral",
            description="Whether the editor may offer an inline literal for this data input. Absent means no: most data types are runtime handles or structured values with no meaningful inline form, so a definition opts in where a literal makes sense.",
        ),
    ] = None


class TemplateNodeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    placeholder_id: Annotated[
        str,
        Field(
            alias="placeholderId",
            description="Identifies the node inside the template. Insertion assigns a fresh node identifier.",
            max_length=64,
            pattern="^[a-z][a-zA-Z0-9]*$",
        ),
    ]
    type_key: Annotated[NodeTypeKeyV1, Field(alias="typeKey")]
    offset: Offset
    input_values: Annotated[
        dict[str, JsonValue | None] | None,
        Field(
            alias="inputValues",
            description="Keys are port identifiers, checked against the referenced node definition's declared ports rather than by a key pattern here.",
            max_length=64,
        ),
    ] = None
    properties: Annotated[
        JsonObject | None,
        Field(
            description="Optional overrides applied on top of the referenced definition's property defaults."
        ),
    ] = None


class TypeDescriptorV1(
    RootModel[Union[PrimitiveTypeV1, CollectionTypeV1, OptionalTypeV1]]
):
    root: Annotated[
        PrimitiveTypeV1 | CollectionTypeV1 | OptionalTypeV1,
        Field(
            description="A port type. There is no implicit any type; a conversion between primitive types is always an explicit node.",
            title="TypeDescriptorV1",
        ),
    ]


class WorkflowTemplateV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    template_key: Annotated[
        str,
        Field(
            alias="templateKey",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    title_key: Annotated[LocalizationKeyV1, Field(alias="titleKey")]
    description_key: Annotated[LocalizationKeyV1, Field(alias="descriptionKey")]
    icon_key: Annotated[IconKeyV1, Field(alias="iconKey")]
    nodes: Annotated[list[TemplateNodeV1], Field(max_length=64, min_length=1)]
    edges: Annotated[list[TemplateEdgeV1] | None, Field(max_length=128)] = None
    exposed_ports: Annotated[
        list[TemplateWorkflowGroupPortV1] | None,
        Field(
            alias="exposedPorts",
            description="Optional template-level connection ports. Each port resolves to a real member node port after expansion.",
            max_length=32,
        ),
    ] = None
    workflow_group: Annotated[
        TemplateWorkflowGroupV1 | None, Field(alias="workflowGroup")
    ] = None


class RinoNodeRegistrySnapshotV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Annotated[Literal[1], Field(alias="schemaVersion")]
    registry_version: Annotated[
        str,
        Field(
            alias="registryVersion",
            description="Content hash of the snapshot, used to detect a registry change without comparing every definition.",
            pattern="^[0-9a-f]{64}$",
        ),
    ]
    definitions: Annotated[list[NodeDefinitionV1], Field(max_length=1000)]
    workflow_templates: Annotated[
        list[WorkflowTemplateV1] | None,
        Field(
            alias="workflowTemplates",
            description="Authoring assistance only. A template expands into ordinary registry nodes and edges and introduces no runtime behavior of its own.",
            max_length=200,
        ),
    ] = None


RinoRegistryArtifactCatalog.model_rebuild()
CollectionTypeV1.model_rebuild()
JsonObject.model_rebuild()
JsonValue.model_rebuild()
NodeDefinitionV1.model_rebuild()
OptionalTypeV1.model_rebuild()
PortDefinitionV1.model_rebuild()
