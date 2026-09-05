# Generated from contracts/graph/rino-graph-v1.schema.json. Do not edit directly.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, Optional, Union
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, RootModel


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
            description="A stable namespaced node definition key such as core.logic.numberCompare.",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
            title="NodeTypeKeyV1",
        ),
    ]


class PortIdV1(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="A port identifier that is stable across saves for one node definition version.",
            max_length=64,
            pattern="^[a-z][a-zA-Z0-9]*$",
            title="PortIdV1",
        ),
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


class ProjectMetadataV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Annotated[str, Field(max_length=200, min_length=1)]
    license_identifier: Annotated[
        str | None,
        Field(
            alias="licenseIdentifier",
            description="The project-wide SPDX expression or LicenseRef identifier inherited by every exported package.",
            pattern="^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$",
        ),
    ] = None
    created_at: Annotated[AwareDatetime, Field(alias="createdAt")]
    updated_at: Annotated[AwareDatetime, Field(alias="updatedAt")]


class EditorPositionV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    x: Annotated[float, Field(ge=-1000000.0, le=1000000.0)]
    y: Annotated[float, Field(ge=-1000000.0, le=1000000.0)]


class RepeatHintV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    hint_id: Annotated[UUID, Field(alias="hintId")]
    edge_id: Annotated[UUID, Field(alias="edgeId")]
    position: EditorPositionV1


class EditorSizeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    width: Annotated[float, Field(ge=160.0, le=100000.0)]
    height: Annotated[float, Field(ge=80.0, le=100000.0)]


class EdgeKindV1(StrEnum):
    execution = "execution"
    data = "data"


class EdgeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    edge_id: Annotated[UUID, Field(alias="edgeId")]
    edge_kind: Annotated[EdgeKindV1, Field(alias="edgeKind")]
    source_node_id: Annotated[UUID, Field(alias="sourceNodeId")]
    source_port_id: Annotated[PortIdV1, Field(alias="sourcePortId")]
    target_node_id: Annotated[UUID, Field(alias="targetNodeId")]
    target_port_id: Annotated[PortIdV1, Field(alias="targetPortId")]


class GraphCommentV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    comment_id: Annotated[UUID, Field(alias="commentId")]
    text: Annotated[str, Field(max_length=2000)]
    position: EditorPositionV1
    size: EditorSizeV1 | None = None


class WorkflowGroupKindV1(StrEnum):
    image_recognition = "imageRecognition"
    text_recognition = "textRecognition"


class WorkflowGroupMemberV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    role: Annotated[str, Field(max_length=64, pattern="^[a-z][a-zA-Z0-9]*$")]
    node_id: Annotated[UUID, Field(alias="nodeId")]


class WorkflowGroupPortV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    proxy_port_id: Annotated[PortIdV1, Field(alias="proxyPortId")]
    node_id: Annotated[UUID, Field(alias="nodeId")]
    port_id: Annotated[PortIdV1, Field(alias="portId")]
    label_key: Annotated[
        str,
        Field(
            alias="labelKey",
            max_length=160,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]


class WorkflowGroupV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    group_id: Annotated[UUID, Field(alias="groupId")]
    kind: WorkflowGroupKindV1
    members: Annotated[list[WorkflowGroupMemberV1], Field(max_length=32, min_length=1)]
    exposed_ports: Annotated[
        list[WorkflowGroupPortV1], Field(alias="exposedPorts", max_length=32)
    ]
    collapsed: bool


class GraphEditorMetadataV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    comments: Annotated[list[GraphCommentV1] | None, Field(max_length=500)] = None
    workflow_groups: Annotated[
        list[WorkflowGroupV1] | None, Field(alias="workflowGroups", max_length=500)
    ] = None
    repeat_hints: Annotated[
        list[RepeatHintV1] | None, Field(alias="repeatHints", max_length=500)
    ] = None


class GraphKindV1(StrEnum):
    entry = "entry"
    function = "function"


class VariableValueKindV1(StrEnum):
    bool = "bool"
    number = "number"
    string = "string"
    point = "point"
    rect = "rect"
    image_ref = "imageRef"


class VariableDefinitionV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    variable_id: Annotated[UUID, Field(alias="variableId")]
    name: Annotated[str, Field(max_length=80, min_length=1, pattern=".*\\S.*")]
    value_kind: Annotated[VariableValueKindV1, Field(alias="valueKind")]
    persistent: bool


class FunctionParameterV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    parameter_id: Annotated[UUID, Field(alias="parameterId")]
    port_id: Annotated[PortIdV1, Field(alias="portId")]
    name: Annotated[str, Field(max_length=80, min_length=1, pattern=".*\\S.*")]
    value_kind: Annotated[VariableValueKindV1, Field(alias="valueKind")]


class FunctionSignatureV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    inputs: Annotated[list[FunctionParameterV1], Field(max_length=16)]
    outputs: Annotated[list[FunctionParameterV1], Field(max_length=16)]


class CoordinateSpaceV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    space_id: Annotated[str, Field(alias="spaceId", max_length=128, min_length=1)]
    width: Annotated[int, Field(ge=1, le=65536)]
    height: Annotated[int, Field(ge=1, le=65536)]


class AssetSourceKindV1(StrEnum):
    device_capture = "deviceCapture"
    region_capture = "regionCapture"
    imported_file = "importedFile"


class MediaType(StrEnum):
    image_png = "image/png"


class ImageAssetV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    asset_id: Annotated[UUID, Field(alias="assetId")]
    display_name: Annotated[
        str,
        Field(
            alias="displayName",
            description="Persistent unique name. New captures use INSTALLATIONCODE_visible-name_ordinal; the editor hides the installation code and ordinal in user-facing labels. Legacy unqualified names remain valid.",
            max_length=200,
            min_length=1,
        ),
    ]
    content_hash: Annotated[
        str,
        Field(
            alias="contentHash",
            description="Lowercase SHA-256 of the stored bytes, so identical content can share one object.",
            pattern="^[0-9a-f]{64}$",
        ),
    ]
    media_type: Annotated[MediaType, Field(alias="mediaType")]
    byte_length: Annotated[int, Field(alias="byteLength", ge=1, le=268435456)]
    coordinate_space: Annotated[CoordinateSpaceV1, Field(alias="coordinateSpace")]
    source_kind: Annotated[AssetSourceKindV1, Field(alias="sourceKind")]
    created_at: Annotated[AwareDatetime, Field(alias="createdAt")]


class GraphFileNameV1(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="The name of one graph file inside the project's graphs directory. The pattern is deliberately narrower than the operating system allows: the editor allocates these names itself, so a project file can never direct a write outside the graphs directory or onto a reserved device name.",
            max_length=80,
            pattern="^[a-z0-9](?:[a-z0-9-]{0,62})\\.rino\\.graph\\.json$",
            title="GraphFileNameV1",
        ),
    ]


class ProjectGraphFileV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    graph_id: Annotated[UUID, Field(alias="graphId")]
    file_name: Annotated[GraphFileNameV1, Field(alias="fileName")]


class ProjectManifestV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Annotated[Literal[1], Field(alias="schemaVersion")]
    document_id: Annotated[UUID, Field(alias="documentId")]
    metadata: ProjectMetadataV1
    entry_graph_id: Annotated[UUID, Field(alias="entryGraphId")]
    graphs: Annotated[list[ProjectGraphFileV1], Field(max_length=64)]
    variables: Annotated[
        list[VariableDefinitionV1] | None,
        Field(
            description="Project-scoped variable definitions shared by every graph, including function graphs.",
            max_length=128,
        ),
    ] = None
    assets: Annotated[list[ImageAssetV1], Field(max_length=2000)]
    required_capabilities: Annotated[
        list[CapabilityKeyV1], Field(alias="requiredCapabilities", max_length=64)
    ]


class RinoGraphArtifactCatalog(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    asset_source_kind_v1: Annotated[
        AssetSourceKindV1 | None, Field(alias="assetSourceKindV1")
    ] = None
    capability_key_v1: Annotated[
        CapabilityKeyV1 | None, Field(alias="capabilityKeyV1")
    ] = None
    coordinate_space_v1: Annotated[
        CoordinateSpaceV1 | None, Field(alias="coordinateSpaceV1")
    ] = None
    edge_kind_v1: Annotated[EdgeKindV1 | None, Field(alias="edgeKindV1")] = None
    edge_v1: Annotated[EdgeV1 | None, Field(alias="edgeV1")] = None
    editor_position_v1: Annotated[
        EditorPositionV1 | None, Field(alias="editorPositionV1")
    ] = None
    editor_size_v1: Annotated[EditorSizeV1 | None, Field(alias="editorSizeV1")] = None
    function_parameter_v1: Annotated[
        FunctionParameterV1 | None, Field(alias="functionParameterV1")
    ] = None
    function_signature_v1: Annotated[
        FunctionSignatureV1 | None, Field(alias="functionSignatureV1")
    ] = None
    graph_comment_v1: Annotated[
        GraphCommentV1 | None, Field(alias="graphCommentV1")
    ] = None
    graph_document_v1: Annotated[
        GraphDocumentV1 | None, Field(alias="graphDocumentV1")
    ] = None
    graph_editor_metadata_v1: Annotated[
        GraphEditorMetadataV1 | None, Field(alias="graphEditorMetadataV1")
    ] = None
    graph_file_name_v1: Annotated[
        GraphFileNameV1 | None, Field(alias="graphFileNameV1")
    ] = None
    graph_kind_v1: Annotated[GraphKindV1 | None, Field(alias="graphKindV1")] = None
    graph_v1: Annotated[GraphV1 | None, Field(alias="graphV1")] = None
    image_asset_v1: Annotated[ImageAssetV1 | None, Field(alias="imageAssetV1")] = None
    json_object: Annotated[JsonObject | None, Field(alias="jsonObject")] = None
    json_value: Annotated[JsonValue | None, Field(alias="jsonValue")] = None
    node_type_key_v1: Annotated[NodeTypeKeyV1 | None, Field(alias="nodeTypeKeyV1")] = (
        None
    )
    node_v1: Annotated[NodeV1 | None, Field(alias="nodeV1")] = None
    port_id_v1: Annotated[PortIdV1 | None, Field(alias="portIdV1")] = None
    project_graph_file_v1: Annotated[
        ProjectGraphFileV1 | None, Field(alias="projectGraphFileV1")
    ] = None
    project_manifest_v1: Annotated[
        ProjectManifestV1 | None, Field(alias="projectManifestV1")
    ] = None
    project_metadata_v1: Annotated[
        ProjectMetadataV1 | None, Field(alias="projectMetadataV1")
    ] = None
    repeat_hint_v1: Annotated[RepeatHintV1 | None, Field(alias="repeatHintV1")] = None
    variable_definition_v1: Annotated[
        VariableDefinitionV1 | None, Field(alias="variableDefinitionV1")
    ] = None
    variable_value_kind_v1: Annotated[
        VariableValueKindV1 | None, Field(alias="variableValueKindV1")
    ] = None
    workflow_group_kind_v1: Annotated[
        WorkflowGroupKindV1 | None, Field(alias="workflowGroupKindV1")
    ] = None
    workflow_group_member_v1: Annotated[
        WorkflowGroupMemberV1 | None, Field(alias="workflowGroupMemberV1")
    ] = None
    workflow_group_port_v1: Annotated[
        WorkflowGroupPortV1 | None, Field(alias="workflowGroupPortV1")
    ] = None
    workflow_group_v1: Annotated[
        WorkflowGroupV1 | None, Field(alias="workflowGroupV1")
    ] = None
    rino_project_document_v1: Annotated[
        RinoProjectDocumentV1 | None,
        Field(alias="rinoProjectDocumentV1", title="RinoProjectDocumentV1"),
    ] = None


class GraphDocumentV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Annotated[Literal[1], Field(alias="schemaVersion")]
    document_id: Annotated[UUID, Field(alias="documentId")]
    graph: GraphV1


class GraphV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    graph_id: Annotated[UUID, Field(alias="graphId")]
    name: Annotated[str, Field(max_length=200, min_length=1)]
    kind: GraphKindV1
    function_signature: Annotated[
        FunctionSignatureV1 | None, Field(alias="functionSignature")
    ] = None
    variables: Annotated[list[VariableDefinitionV1] | None, Field(max_length=128)] = (
        None
    )
    nodes: Annotated[list[NodeV1], Field(max_length=5000)]
    edges: Annotated[list[EdgeV1], Field(max_length=10000)]
    editor_metadata: Annotated[
        GraphEditorMetadataV1 | None, Field(alias="editorMetadata")
    ] = None


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


class NodeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    node_id: Annotated[UUID, Field(alias="nodeId")]
    type_key: Annotated[NodeTypeKeyV1, Field(alias="typeKey")]
    type_version: Annotated[int, Field(alias="typeVersion", ge=1, le=1000)]
    display_alias: Annotated[
        str | None,
        Field(
            alias="displayAlias",
            description="Optional authoring note shown beside the localized title. Presentation metadata only; it never changes execution identity.",
            max_length=80,
        ),
    ] = None
    position: EditorPositionV1
    properties: JsonObject
    input_values: Annotated[
        dict[str, JsonValue | None],
        Field(
            alias="inputValues",
            description="Literal fallbacks for configurable data inputs that carry no incoming edge. Keys are port identifiers. Their validity is checked against the node definition's declared ports rather than by a key pattern here, because matching a declared port is the rule that matters and a pattern would only weakly approximate it.",
            max_length=64,
        ),
    ]
    dynamic_port_state: Annotated[
        JsonObject | None,
        Field(
            alias="dynamicPortState",
            description="Present only for node definitions that declare dynamic ports.",
        ),
    ] = None
    disabled: bool | None = None
    breakpoint: bool | None = None


class RinoProjectDocumentV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Annotated[Literal[1], Field(alias="schemaVersion")]
    document_id: Annotated[UUID, Field(alias="documentId")]
    metadata: ProjectMetadataV1
    entry_graph_id: Annotated[UUID, Field(alias="entryGraphId")]
    graphs: Annotated[list[GraphV1], Field(max_length=64)]
    variables: Annotated[
        list[VariableDefinitionV1] | None,
        Field(
            description="Project-scoped variable definitions shared by every graph, including function graphs.",
            max_length=128,
        ),
    ] = None
    assets: Annotated[list[ImageAssetV1], Field(max_length=2000)]
    required_capabilities: Annotated[
        list[CapabilityKeyV1], Field(alias="requiredCapabilities", max_length=64)
    ]


RinoGraphArtifactCatalog.model_rebuild()
GraphDocumentV1.model_rebuild()
GraphV1.model_rebuild()
JsonObject.model_rebuild()
JsonValue.model_rebuild()
