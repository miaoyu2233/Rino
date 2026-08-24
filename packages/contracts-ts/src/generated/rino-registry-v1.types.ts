/* Generated from contracts/registry/rino-registry-v1.schema.json. Do not edit directly. */

export type CapabilityKeyV1 = string;
/**
 * A port type. There is no implicit any type; a conversion between primitive types is always an explicit node.
 */
export type TypeDescriptorV1 = PrimitiveTypeV1 | CollectionTypeV1 | OptionalTypeV1;
export type PrimitiveTypeKindV1 =
  | "exec"
  | "bool"
  | "number"
  | "string"
  | "point"
  | "rect"
  | "imageRef"
  | "ocrCandidate"
  | "ocrResult";
/**
 * The registry sends localization keys rather than translated text, so node names follow the user's language.
 */
export type LocalizationKeyV1 = string;
export type NodeTypeKeyV1 = string;
/**
 * Resolved through the bundled static icon mapping. A project or runtime cannot supply image bytes or a remote icon address.
 */
export type IconKeyV1 = string;
/**
 * Any JSON value. Integer is listed ahead of number so generated models keep whole numbers integral instead of widening them to floating point.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type NodeCategoryV1 =
  "flow" | "logic" | "values" | "text" | "vision" | "device" | "timing" | "diagnostics";
export type RuntimeKindV1 = "entry" | "execution" | "pure";
export type SideEffectV1 =
  "none" | "runtime" | "deviceRead" | "deviceWrite" | "diagnostic";
export type PortIdV1 = string;
export type PortDirectionV1 = "input" | "output";
export type PortKindV1 = "execution" | "data";
export type WorkflowGroupKindV1 = "imageRecognition" | "textRecognition";

/**
 * Generation-only catalog that makes every definition reachable.
 */
export interface RinoRegistryArtifactCatalog {
  capabilityKeyV1?: CapabilityKeyV1;
  collectionTypeV1?: CollectionTypeV1;
  deprecationV1?: DeprecationV1;
  iconKeyV1?: IconKeyV1;
  jsonObject?: JsonObject;
  jsonValue?: JsonValue;
  localizationKeyV1?: LocalizationKeyV1;
  nodeCategoryV1?: NodeCategoryV1;
  nodeDefinitionV1?: NodeDefinitionV1;
  nodeTypeKeyV1?: NodeTypeKeyV1;
  optionalTypeV1?: OptionalTypeV1;
  portDefinitionV1?: PortDefinitionV1;
  portDirectionV1?: PortDirectionV1;
  portIdV1?: PortIdV1;
  portKindV1?: PortKindV1;
  primitiveTypeKindV1?: PrimitiveTypeKindV1;
  primitiveTypeV1?: PrimitiveTypeV1;
  runtimeKindV1?: RuntimeKindV1;
  sideEffectV1?: SideEffectV1;
  templateEdgeV1?: TemplateEdgeV1;
  templateNodeV1?: TemplateNodeV1;
  templateWorkflowGroupMemberV1?: TemplateWorkflowGroupMemberV1;
  templateWorkflowGroupPortV1?: TemplateWorkflowGroupPortV1;
  templateWorkflowGroupV1?: TemplateWorkflowGroupV1;
  typeDescriptorV1?: TypeDescriptorV1;
  workflowGroupKindV1?: WorkflowGroupKindV1;
  workflowTemplateV1?: WorkflowTemplateV1;
  rinoNodeRegistrySnapshotV1?: RinoNodeRegistrySnapshotV1;
}
export interface CollectionTypeV1 {
  kind: "collection";
  element: TypeDescriptorV1;
}
export interface PrimitiveTypeV1 {
  kind: PrimitiveTypeKindV1;
}
export interface OptionalTypeV1 {
  kind: "optional";
  value: TypeDescriptorV1;
}
/**
 * A deprecated definition stays visible in a project that already uses it; only new insertion is prevented.
 */
export interface DeprecationV1 {
  reasonKey: LocalizationKeyV1;
  replacementTypeKey?: NodeTypeKeyV1;
}
export interface JsonObject {
  [k: string]: JsonValue;
}
export interface NodeDefinitionV1 {
  typeKey: NodeTypeKeyV1;
  typeVersion: number;
  runtimeKind: RuntimeKindV1;
  sideEffect: SideEffectV1;
  category: NodeCategoryV1;
  titleKey: LocalizationKeyV1;
  descriptionKey: LocalizationKeyV1;
  iconKey: IconKeyV1;
  /**
   * @maxItems 32
   */
  keywordKeys?: LocalizationKeyV1[];
  /**
   * @maxItems 64
   */
  ports: PortDefinitionV1[];
  propertySchema?: JsonObject1;
  propertyDefaults?: JsonObject;
  /**
   * Selects a bundled specialist editor from an allowlist. A project cannot load an arbitrary component.
   */
  rendererKey?: string;
  /**
   * @maxItems 16
   */
  requiredCapabilities?:
    | []
    | [CapabilityKeyV1]
    | [CapabilityKeyV1, CapabilityKeyV1]
    | [CapabilityKeyV1, CapabilityKeyV1, CapabilityKeyV1]
    | [CapabilityKeyV1, CapabilityKeyV1, CapabilityKeyV1, CapabilityKeyV1]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ]
    | [
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
        CapabilityKeyV1,
      ];
  deprecation?: DeprecationV1;
}
/**
 * Connection cardinality is derived from direction and kind rather than configured per port: a data input accepts one edge, a data output and an execution input accept many, and an execution output accepts one unless it declares fan-out.
 */
export interface PortDefinitionV1 {
  portId: PortIdV1;
  direction: PortDirectionV1;
  portKind: PortKindV1;
  type: TypeDescriptorV1;
  labelKey: LocalizationKeyV1;
  descriptionKey?: LocalizationKeyV1;
  /**
   * A required data input must be satisfied by an edge or a literal before a graph can run.
   */
  required?: boolean;
  /**
   * Only meaningful for an execution output. A node that declares it selects several successors in a defined order.
   */
  allowsFanOut?: boolean;
  /**
   * Whether the editor may offer an inline literal for this data input. Absent means no: most data types are runtime handles or structured values with no meaningful inline form, so a definition opts in where a literal makes sense.
   */
  acceptsLiteral?: boolean;
}
/**
 * A validated schema for behavior configuration that is not supplied through data ports.
 */
export interface JsonObject1 {
  [k: string]: JsonValue;
}
export interface TemplateEdgeV1 {
  edgeKind: "execution" | "data";
  sourcePlaceholderId: string;
  sourcePortId: PortIdV1;
  targetPlaceholderId: string;
  targetPortId: PortIdV1;
}
export interface TemplateNodeV1 {
  /**
   * Identifies the node inside the template. Insertion assigns a fresh node identifier.
   */
  placeholderId: string;
  typeKey: NodeTypeKeyV1;
  offset: {
    x: number;
    y: number;
  };
  /**
   * Keys are port identifiers, checked against the referenced node definition's declared ports rather than by a key pattern here.
   */
  inputValues?: {
    [k: string]: JsonValue;
  };
  properties?: JsonObject2;
}
/**
 * Optional overrides applied on top of the referenced definition's property defaults.
 */
export interface JsonObject2 {
  [k: string]: JsonValue;
}
export interface TemplateWorkflowGroupMemberV1 {
  role: string;
  placeholderId: string;
}
export interface TemplateWorkflowGroupPortV1 {
  proxyPortId: PortIdV1;
  placeholderId: string;
  portId: PortIdV1;
  labelKey: LocalizationKeyV1;
}
export interface TemplateWorkflowGroupV1 {
  kind: WorkflowGroupKindV1;
  /**
   * @minItems 1
   * @maxItems 32
   */
  members: [TemplateWorkflowGroupMemberV1, ...TemplateWorkflowGroupMemberV1[]];
  /**
   * @maxItems 32
   */
  exposedPorts: TemplateWorkflowGroupPortV1[];
}
export interface WorkflowTemplateV1 {
  templateKey: string;
  titleKey: LocalizationKeyV1;
  descriptionKey: LocalizationKeyV1;
  iconKey: IconKeyV1;
  /**
   * @minItems 1
   * @maxItems 64
   */
  nodes: [TemplateNodeV1, ...TemplateNodeV1[]];
  /**
   * @maxItems 128
   */
  edges?: TemplateEdgeV1[];
  /**
   * Optional template-level connection ports. Each port resolves to a real member node port after expansion.
   *
   * @maxItems 32
   */
  exposedPorts?: TemplateWorkflowGroupPortV1[];
  workflowGroup?: TemplateWorkflowGroupV1;
}
export interface RinoNodeRegistrySnapshotV1 {
  schemaVersion: 1;
  /**
   * Content hash of the snapshot, used to detect a registry change without comparing every definition.
   */
  registryVersion: string;
  /**
   * @maxItems 1000
   */
  definitions: NodeDefinitionV1[];
  /**
   * Authoring assistance only. A template expands into ordinary registry nodes and edges and introduces no runtime behavior of its own.
   *
   * @maxItems 200
   */
  workflowTemplates?: WorkflowTemplateV1[];
}
