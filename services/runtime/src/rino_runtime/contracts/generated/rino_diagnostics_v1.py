# Generated from contracts/diagnostics/rino-diagnostics-v1.schema.json. Do not edit directly.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, Optional, Union
from uuid import UUID

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


class DiagnosticSeverityV1(StrEnum):
    error = "error"
    warning = "warning"


class GraphDiagnosticCodeV1(StrEnum):
    graph_duplicate_graph_id = "GRAPH_DUPLICATE_GRAPH_ID"
    graph_duplicate_node_id = "GRAPH_DUPLICATE_NODE_ID"
    graph_duplicate_edge_id = "GRAPH_DUPLICATE_EDGE_ID"
    graph_entry_graph_missing = "GRAPH_ENTRY_GRAPH_MISSING"
    graph_entry_kind_invalid = "GRAPH_ENTRY_KIND_INVALID"
    graph_non_entry_kind_invalid = "GRAPH_NON_ENTRY_KIND_INVALID"
    graph_entry_node_missing = "GRAPH_ENTRY_NODE_MISSING"
    graph_multiple_entry_nodes = "GRAPH_MULTIPLE_ENTRY_NODES"
    graph_pure_data_cycle = "GRAPH_PURE_DATA_CYCLE"
    graph_multiple_parallel_on_path = "GRAPH_MULTIPLE_PARALLEL_ON_PATH"
    graph_duplicate_variable_id = "GRAPH_DUPLICATE_VARIABLE_ID"
    graph_duplicate_variable_name = "GRAPH_DUPLICATE_VARIABLE_NAME"
    graph_variable_persistence_unsupported = "GRAPH_VARIABLE_PERSISTENCE_UNSUPPORTED"
    function_duplicate_parameter_id = "FUNCTION_DUPLICATE_PARAMETER_ID"
    function_duplicate_port_id = "FUNCTION_DUPLICATE_PORT_ID"
    function_duplicate_parameter_name = "FUNCTION_DUPLICATE_PARAMETER_NAME"
    function_parallel_forbidden = "FUNCTION_PARALLEL_FORBIDDEN"
    function_parameter_port_reserved = "FUNCTION_PARAMETER_PORT_RESERVED"
    function_entry_node_missing = "FUNCTION_ENTRY_NODE_MISSING"
    function_multiple_entry_nodes = "FUNCTION_MULTIPLE_ENTRY_NODES"
    function_return_node_missing = "FUNCTION_RETURN_NODE_MISSING"
    function_node_outside_function = "FUNCTION_NODE_OUTSIDE_FUNCTION"
    function_call_target_missing = "FUNCTION_CALL_TARGET_MISSING"
    function_call_target_not_function = "FUNCTION_CALL_TARGET_NOT_FUNCTION"
    function_recursion_forbidden = "FUNCTION_RECURSION_FORBIDDEN"
    function_call_depth_exceeded = "FUNCTION_CALL_DEPTH_EXCEEDED"
    function_persistent_variable_forbidden = "FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN"
    document_duplicate_asset_id = "DOCUMENT_DUPLICATE_ASSET_ID"
    document_duplicate_asset_name = "DOCUMENT_DUPLICATE_ASSET_NAME"
    node_type_unknown = "NODE_TYPE_UNKNOWN"
    node_type_version_unsupported = "NODE_TYPE_VERSION_UNSUPPORTED"
    node_type_deprecated = "NODE_TYPE_DEPRECATED"
    node_capability_unavailable = "NODE_CAPABILITY_UNAVAILABLE"
    node_input_value_unknown_port = "NODE_INPUT_VALUE_UNKNOWN_PORT"
    node_input_value_not_accepted = "NODE_INPUT_VALUE_NOT_ACCEPTED"
    node_required_input_missing = "NODE_REQUIRED_INPUT_MISSING"
    node_variable_unknown = "NODE_VARIABLE_UNKNOWN"
    node_variable_type_mismatch = "NODE_VARIABLE_TYPE_MISMATCH"
    edge_self_connection = "EDGE_SELF_CONNECTION"
    edge_source_node_missing = "EDGE_SOURCE_NODE_MISSING"
    edge_target_node_missing = "EDGE_TARGET_NODE_MISSING"
    edge_source_port_missing = "EDGE_SOURCE_PORT_MISSING"
    edge_target_port_missing = "EDGE_TARGET_PORT_MISSING"
    edge_direction_invalid = "EDGE_DIRECTION_INVALID"
    edge_kind_mismatch = "EDGE_KIND_MISMATCH"
    edge_type_incompatible = "EDGE_TYPE_INCOMPATIBLE"
    edge_cardinality_exceeded = "EDGE_CARDINALITY_EXCEEDED"


class DocumentLocationV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scope: Literal["document"]


class GraphLocationV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scope: Literal["graph"]
    graph_id: Annotated[UUID, Field(alias="graphId")]


class NodeLocationV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scope: Literal["node"]
    graph_id: Annotated[UUID, Field(alias="graphId")]
    node_id: Annotated[UUID, Field(alias="nodeId")]


class PortLocationV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scope: Literal["port"]
    graph_id: Annotated[UUID, Field(alias="graphId")]
    node_id: Annotated[UUID, Field(alias="nodeId")]
    port_id: Annotated[str, Field(alias="portId", max_length=64)]


class EdgeLocationV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scope: Literal["edge"]
    graph_id: Annotated[UUID, Field(alias="graphId")]
    edge_id: Annotated[UUID, Field(alias="edgeId")]


class AssetLocationV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    scope: Literal["asset"]
    asset_id: Annotated[UUID, Field(alias="assetId")]


class DiagnosticLocationV1(
    RootModel[
        Union[
            DocumentLocationV1,
            GraphLocationV1,
            NodeLocationV1,
            PortLocationV1,
            EdgeLocationV1,
            AssetLocationV1,
        ]
    ]
):
    root: Annotated[
        DocumentLocationV1
        | GraphLocationV1
        | NodeLocationV1
        | PortLocationV1
        | EdgeLocationV1
        | AssetLocationV1,
        Field(
            description="Where the diagnostic applies, so the interface can focus the affected element instead of only naming it.",
            title="DiagnosticLocationV1",
        ),
    ]


class RinoDiagnosticsArtifactCatalog(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    asset_location_v1: Annotated[
        AssetLocationV1 | None, Field(alias="assetLocationV1")
    ] = None
    diagnostic_location_v1: Annotated[
        DiagnosticLocationV1 | None, Field(alias="diagnosticLocationV1")
    ] = None
    diagnostic_severity_v1: Annotated[
        DiagnosticSeverityV1 | None, Field(alias="diagnosticSeverityV1")
    ] = None
    document_location_v1: Annotated[
        DocumentLocationV1 | None, Field(alias="documentLocationV1")
    ] = None
    edge_location_v1: Annotated[
        EdgeLocationV1 | None, Field(alias="edgeLocationV1")
    ] = None
    graph_diagnostic_code_v1: Annotated[
        GraphDiagnosticCodeV1 | None, Field(alias="graphDiagnosticCodeV1")
    ] = None
    graph_diagnostic_v1: Annotated[
        GraphDiagnosticV1 | None, Field(alias="graphDiagnosticV1")
    ] = None
    graph_location_v1: Annotated[
        GraphLocationV1 | None, Field(alias="graphLocationV1")
    ] = None
    json_object: Annotated[JsonObject | None, Field(alias="jsonObject")] = None
    json_value: Annotated[JsonValue | None, Field(alias="jsonValue")] = None
    node_location_v1: Annotated[
        NodeLocationV1 | None, Field(alias="nodeLocationV1")
    ] = None
    port_location_v1: Annotated[
        PortLocationV1 | None, Field(alias="portLocationV1")
    ] = None
    rino_graph_diagnostic_report_v1: Annotated[
        RinoGraphDiagnosticReportV1 | None,
        Field(alias="rinoGraphDiagnosticReportV1", title="RinoGraphDiagnosticReportV1"),
    ] = None


class GraphDiagnosticV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: GraphDiagnosticCodeV1
    severity: DiagnosticSeverityV1
    location: DiagnosticLocationV1
    message_key: Annotated[
        str,
        Field(
            alias="messageKey",
            description="Localization key. The report carries keys and safe parameters rather than translated text, so a diagnostic produced by the runtime reads in the user's language.",
            max_length=200,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-zA-Z0-9]+)+$",
        ),
    ]
    parameters: Annotated[
        JsonObject,
        Field(
            description="Bounded interpolation values. Never contains project content beyond identifiers and type names."
        ),
    ]


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


class RinoGraphDiagnosticReportV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    schema_version: Annotated[Literal[1], Field(alias="schemaVersion")]
    diagnostics: Annotated[list[GraphDiagnosticV1], Field(max_length=2000)]


RinoDiagnosticsArtifactCatalog.model_rebuild()
GraphDiagnosticV1.model_rebuild()
JsonObject.model_rebuild()
JsonValue.model_rebuild()
