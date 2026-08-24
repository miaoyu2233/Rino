/* Generated from contracts/graph/rino-graph-v1.schema.json. Do not edit directly. */

export type AssetSourceKindV1 = "deviceCapture" | "regionCapture" | "importedFile";
export type CapabilityKeyV1 = string;
export type EdgeKindV1 = "execution" | "data";
/**
 * A port identifier that is stable across saves for one node definition version.
 */
export type PortIdV1 = string;
export type VariableValueKindV1 =
  "bool" | "number" | "string" | "point" | "rect" | "imageRef";
export type GraphKindV1 = "entry" | "function";
/**
 * A stable namespaced node definition key such as core.logic.numberCompare.
 */
export type NodeTypeKeyV1 = string;
/**
 * Any JSON value. Integer is listed ahead of number so generated models keep whole numbers integral instead of widening them to floating point.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type WorkflowGroupKindV1 = "imageRecognition" | "textRecognition";
/**
 * The name of one graph file inside the project's graphs directory. The pattern is deliberately narrower than the operating system allows: the editor allocates these names itself, so a project file can never direct a write outside the graphs directory or onto a reserved device name.
 */
export type GraphFileNameV1 = string;

/**
 * Generation-only catalog that makes every definition reachable.
 */
export interface RinoGraphArtifactCatalog {
  assetSourceKindV1?: AssetSourceKindV1;
  capabilityKeyV1?: CapabilityKeyV1;
  coordinateSpaceV1?: CoordinateSpaceV1;
  edgeKindV1?: EdgeKindV1;
  edgeV1?: EdgeV1;
  editorPositionV1?: EditorPositionV1;
  editorSizeV1?: EditorSizeV1;
  functionParameterV1?: FunctionParameterV1;
  functionSignatureV1?: FunctionSignatureV1;
  graphCommentV1?: GraphCommentV1;
  graphDocumentV1?: GraphDocumentV1;
  graphEditorMetadataV1?: GraphEditorMetadataV1;
  graphFileNameV1?: GraphFileNameV1;
  graphKindV1?: GraphKindV1;
  graphV1?: GraphV1;
  imageAssetV1?: ImageAssetV1;
  jsonObject?: JsonObject;
  jsonValue?: JsonValue;
  nodeTypeKeyV1?: NodeTypeKeyV1;
  nodeV1?: NodeV1;
  portIdV1?: PortIdV1;
  projectGraphFileV1?: ProjectGraphFileV1;
  projectManifestV1?: ProjectManifestV1;
  projectMetadataV1?: ProjectMetadataV1;
  repeatHintV1?: RepeatHintV1;
  variableDefinitionV1?: VariableDefinitionV1;
  variableValueKindV1?: VariableValueKindV1;
  workflowGroupKindV1?: WorkflowGroupKindV1;
  workflowGroupMemberV1?: WorkflowGroupMemberV1;
  workflowGroupPortV1?: WorkflowGroupPortV1;
  workflowGroupV1?: WorkflowGroupV1;
  rinoProjectDocumentV1?: RinoProjectDocumentV1;
}
/**
 * The pixel space a captured image and any region derived from it belong to. Comparing coordinates across spaces is a validation error, not a silent conversion.
 */
export interface CoordinateSpaceV1 {
  spaceId: string;
  width: number;
  height: number;
}
export interface EdgeV1 {
  edgeId: string;
  edgeKind: EdgeKindV1;
  sourceNodeId: string;
  sourcePortId: PortIdV1;
  targetNodeId: string;
  targetPortId: PortIdV1;
}
/**
 * Editor-space coordinates. Bounded so a corrupted document cannot place a node beyond any reachable viewport.
 */
export interface EditorPositionV1 {
  x: number;
  y: number;
}
/**
 * Editor-space dimensions for presentation-only regions such as comments.
 */
export interface EditorSizeV1 {
  width: number;
  height: number;
}
/**
 * One typed function boundary parameter. parameterId is editor identity; portId is the stable graph boundary port.
 */
export interface FunctionParameterV1 {
  parameterId: string;
  portId: PortIdV1;
  name: string;
  valueKind: VariableValueKindV1;
}
/**
 * The author-ordered typed boundary of a function graph.
 */
export interface FunctionSignatureV1 {
  /**
   * @maxItems 16
   */
  inputs:
    | []
    | [FunctionParameterV1]
    | [FunctionParameterV1, FunctionParameterV1]
    | [FunctionParameterV1, FunctionParameterV1, FunctionParameterV1]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ];
  /**
   * @maxItems 16
   */
  outputs:
    | []
    | [FunctionParameterV1]
    | [FunctionParameterV1, FunctionParameterV1]
    | [FunctionParameterV1, FunctionParameterV1, FunctionParameterV1]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ]
    | [
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
        FunctionParameterV1,
      ];
}
export interface GraphCommentV1 {
  commentId: string;
  text: string;
  position: EditorPositionV1;
  size?: EditorSizeV1;
}
/**
 * One persisted graphs/*.rino.graph.json file. documentId repeats the owning project's identifier so a graph file copied into another project is rejected instead of silently adopted.
 */
export interface GraphDocumentV1 {
  schemaVersion: 1;
  documentId: string;
  graph: GraphV1;
}
export interface GraphV1 {
  graphId: string;
  name: string;
  kind: GraphKindV1;
  functionSignature?: FunctionSignatureV1;
  /**
   * @maxItems 128
   */
  variables?: VariableDefinitionV1[];
  /**
   * @maxItems 5000
   */
  nodes: NodeV1[];
  /**
   * @maxItems 10000
   */
  edges: EdgeV1[];
  editorMetadata?: GraphEditorMetadataV1;
}
export interface VariableDefinitionV1 {
  variableId: string;
  name: string;
  valueKind: VariableValueKindV1;
  persistent: boolean;
}
export interface NodeV1 {
  nodeId: string;
  typeKey: NodeTypeKeyV1;
  typeVersion: number;
  /**
   * Optional authoring note shown beside the localized title. Presentation metadata only; it never changes execution identity.
   */
  displayAlias?: string;
  position: EditorPositionV1;
  properties: JsonObject;
  /**
   * Literal fallbacks for configurable data inputs that carry no incoming edge. Keys are port identifiers. Their validity is checked against the node definition's declared ports rather than by a key pattern here, because matching a declared port is the rule that matters and a pattern would only weakly approximate it.
   */
  inputValues: {
    [k: string]: JsonValue;
  };
  dynamicPortState?: JsonObject1;
  disabled?: boolean;
  breakpoint?: boolean;
}
export interface JsonObject {
  [k: string]: JsonValue;
}
/**
 * Present only for node definitions that declare dynamic ports.
 */
export interface JsonObject1 {
  [k: string]: JsonValue;
}
/**
 * Presentation state that must never affect execution.
 */
export interface GraphEditorMetadataV1 {
  /**
   * @maxItems 500
   */
  comments?: GraphCommentV1[];
  /**
   * @maxItems 500
   */
  workflowGroups?: WorkflowGroupV1[];
  /**
   * @maxItems 500
   */
  repeatHints?: RepeatHintV1[];
}
/**
 * Authoring-only grouping of ordinary executable nodes. Group metadata never changes runtime semantics.
 */
export interface WorkflowGroupV1 {
  groupId: string;
  kind: WorkflowGroupKindV1;
  /**
   * @minItems 1
   * @maxItems 32
   */
  members: [WorkflowGroupMemberV1, ...WorkflowGroupMemberV1[]];
  /**
   * @maxItems 32
   */
  exposedPorts: WorkflowGroupPortV1[];
  collapsed: boolean;
}
export interface WorkflowGroupMemberV1 {
  role: string;
  nodeId: string;
}
export interface WorkflowGroupPortV1 {
  proxyPortId: PortIdV1;
  nodeId: string;
  portId: PortIdV1;
  labelKey: string;
}
/**
 * Presentation-only hint attached to a direct execution edge. The edge remains the runtime authority.
 */
export interface RepeatHintV1 {
  hintId: string;
  edgeId: string;
  position: EditorPositionV1;
}
/**
 * One stored image. Graph references target assetId, so renaming an asset never breaks a node.
 */
export interface ImageAssetV1 {
  assetId: string;
  /**
   * Persistent unique name. New captures use INSTALLATIONCODE_visible-name_ordinal; the editor hides the installation code and ordinal in user-facing labels. Legacy unqualified names remain valid.
   */
  displayName: string;
  /**
   * Lowercase SHA-256 of the stored bytes, so identical content can share one object.
   */
  contentHash: string;
  mediaType: "image/png";
  byteLength: number;
  coordinateSpace: CoordinateSpaceV1;
  sourceKind: AssetSourceKindV1;
  createdAt: string;
}
/**
 * The manifest's record of where one graph is stored. The manifest is the authority: a graph file present on disk but absent here is not part of the project.
 */
export interface ProjectGraphFileV1 {
  graphId: string;
  fileName: GraphFileNameV1;
}
/**
 * The persisted project.rino.json at a project root. It carries everything a project document holds except the graphs themselves, which live in their own files so one graph edit rewrites one file.
 */
export interface ProjectManifestV1 {
  schemaVersion: 1;
  documentId: string;
  metadata: ProjectMetadataV1;
  entryGraphId: string;
  /**
   * @maxItems 64
   */
  graphs: ProjectGraphFileV1[];
  /**
   * Project-scoped variable definitions shared by every graph, including function graphs.
   *
   * @maxItems 128
   */
  variables?: VariableDefinitionV1[];
  /**
   * @maxItems 2000
   */
  assets: ImageAssetV1[];
  /**
   * @maxItems 64
   */
  requiredCapabilities: CapabilityKeyV1[];
}
export interface ProjectMetadataV1 {
  name: string;
  createdAt: string;
  updatedAt: string;
}
export interface RinoProjectDocumentV1 {
  schemaVersion: 1;
  documentId: string;
  metadata: ProjectMetadataV1;
  entryGraphId: string;
  /**
   * @maxItems 64
   */
  graphs: GraphV1[];
  /**
   * Project-scoped variable definitions shared by every graph, including function graphs.
   *
   * @maxItems 128
   */
  variables?: VariableDefinitionV1[];
  /**
   * @maxItems 2000
   */
  assets: ImageAssetV1[];
  /**
   * @maxItems 64
   */
  requiredCapabilities: CapabilityKeyV1[];
}
