/* Generated from contracts/diagnostics/rino-diagnostics-v1.schema.json. Do not edit directly. */

/**
 * Where the diagnostic applies, so the interface can focus the affected element instead of only naming it.
 */
export type DiagnosticLocationV1 =
  | DocumentLocationV1
  | GraphLocationV1
  | NodeLocationV1
  | PortLocationV1
  | EdgeLocationV1
  | AssetLocationV1;
/**
 * An error blocks execution. A warning is surfaced but does not block a run.
 */
export type DiagnosticSeverityV1 = "error" | "warning";
/**
 * Stable validation codes. A code is never reused for a different meaning, because the interface navigates and explains failures by code.
 */
export type GraphDiagnosticCodeV1 =
  | "GRAPH_DUPLICATE_GRAPH_ID"
  | "GRAPH_DUPLICATE_NODE_ID"
  | "GRAPH_DUPLICATE_EDGE_ID"
  | "GRAPH_ENTRY_GRAPH_MISSING"
  | "GRAPH_ENTRY_KIND_INVALID"
  | "GRAPH_NON_ENTRY_KIND_INVALID"
  | "GRAPH_ENTRY_NODE_MISSING"
  | "GRAPH_MULTIPLE_ENTRY_NODES"
  | "GRAPH_PURE_DATA_CYCLE"
  | "GRAPH_MULTIPLE_PARALLEL_ON_PATH"
  | "GRAPH_DUPLICATE_VARIABLE_ID"
  | "GRAPH_DUPLICATE_VARIABLE_NAME"
  | "GRAPH_VARIABLE_PERSISTENCE_UNSUPPORTED"
  | "FUNCTION_DUPLICATE_PARAMETER_ID"
  | "FUNCTION_DUPLICATE_PORT_ID"
  | "FUNCTION_DUPLICATE_PARAMETER_NAME"
  | "FUNCTION_PARALLEL_FORBIDDEN"
  | "FUNCTION_PARAMETER_PORT_RESERVED"
  | "FUNCTION_ENTRY_NODE_MISSING"
  | "FUNCTION_MULTIPLE_ENTRY_NODES"
  | "FUNCTION_RETURN_NODE_MISSING"
  | "FUNCTION_NODE_OUTSIDE_FUNCTION"
  | "FUNCTION_CALL_TARGET_MISSING"
  | "FUNCTION_CALL_TARGET_NOT_FUNCTION"
  | "FUNCTION_RECURSION_FORBIDDEN"
  | "FUNCTION_CALL_DEPTH_EXCEEDED"
  | "FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN"
  | "DOCUMENT_DUPLICATE_ASSET_ID"
  | "DOCUMENT_DUPLICATE_ASSET_NAME"
  | "NODE_TYPE_UNKNOWN"
  | "NODE_TYPE_VERSION_UNSUPPORTED"
  | "NODE_TYPE_DEPRECATED"
  | "NODE_CAPABILITY_UNAVAILABLE"
  | "NODE_INPUT_VALUE_UNKNOWN_PORT"
  | "NODE_INPUT_VALUE_NOT_ACCEPTED"
  | "NODE_REQUIRED_INPUT_MISSING"
  | "NODE_VARIABLE_UNKNOWN"
  | "NODE_VARIABLE_TYPE_MISMATCH"
  | "EDGE_SELF_CONNECTION"
  | "EDGE_SOURCE_NODE_MISSING"
  | "EDGE_TARGET_NODE_MISSING"
  | "EDGE_SOURCE_PORT_MISSING"
  | "EDGE_TARGET_PORT_MISSING"
  | "EDGE_DIRECTION_INVALID"
  | "EDGE_KIND_MISMATCH"
  | "EDGE_TYPE_INCOMPATIBLE"
  | "EDGE_CARDINALITY_EXCEEDED";
/**
 * Any JSON value. Integer is listed ahead of number so generated models keep whole numbers integral instead of widening them to floating point.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject1;

/**
 * Generation-only catalog that makes every definition reachable.
 */
export interface RinoDiagnosticsArtifactCatalog {
  assetLocationV1?: AssetLocationV1;
  diagnosticLocationV1?: DiagnosticLocationV1;
  diagnosticSeverityV1?: DiagnosticSeverityV1;
  documentLocationV1?: DocumentLocationV1;
  edgeLocationV1?: EdgeLocationV1;
  graphDiagnosticCodeV1?: GraphDiagnosticCodeV1;
  graphDiagnosticV1?: GraphDiagnosticV1;
  graphLocationV1?: GraphLocationV1;
  jsonObject?: JsonObject1;
  jsonValue?: JsonValue;
  nodeLocationV1?: NodeLocationV1;
  portLocationV1?: PortLocationV1;
  rinoGraphDiagnosticReportV1?: RinoGraphDiagnosticReportV1;
}
export interface AssetLocationV1 {
  scope: "asset";
  assetId: string;
}
export interface DocumentLocationV1 {
  scope: "document";
}
export interface GraphLocationV1 {
  scope: "graph";
  graphId: string;
}
export interface NodeLocationV1 {
  scope: "node";
  graphId: string;
  nodeId: string;
}
export interface PortLocationV1 {
  scope: "port";
  graphId: string;
  nodeId: string;
  portId: string;
}
export interface EdgeLocationV1 {
  scope: "edge";
  graphId: string;
  edgeId: string;
}
export interface GraphDiagnosticV1 {
  code: GraphDiagnosticCodeV1;
  severity: DiagnosticSeverityV1;
  location: DiagnosticLocationV1;
  /**
   * Localization key. The report carries keys and safe parameters rather than translated text, so a diagnostic produced by the runtime reads in the user's language.
   */
  messageKey: string;
  parameters: JsonObject;
}
/**
 * Bounded interpolation values. Never contains project content beyond identifiers and type names.
 */
export interface JsonObject {
  [k: string]: JsonValue;
}
export interface JsonObject1 {
  [k: string]: JsonValue;
}
export interface RinoGraphDiagnosticReportV1 {
  schemaVersion: 1;
  /**
   * @maxItems 2000
   */
  diagnostics: GraphDiagnosticV1[];
}
