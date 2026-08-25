import type {
  EdgeV1,
  GraphV1,
  NodeV1,
  RepeatHintV1,
  RinoProjectDocumentV1,
  RinoNodeRegistrySnapshotV1,
  TypeDescriptorV1,
  WorkflowGroupV1,
} from "@rino/contracts";
import { MarkerType, type Edge, type Node } from "@xyflow/react";

import type { EditableValue } from "../commands/graph-commands";
import { literalEditorFor, type FieldEditor } from "../fields/field-editor";
import {
  readPropertyFields,
  type PropertyField,
} from "../fields/property-schema";
import {
  NodeRegistryIndex,
  type IndexedNodeDefinition,
} from "../node-registry-index";
import { describeType } from "../type-compatibility";
import {
  MAXIMUM_COLLECTION_ITEM_COUNT,
  MAXIMUM_NUMERIC_INPUT_COUNT,
  MAXIMUM_PARALLEL_BRANCH_COUNT,
  MAXIMUM_SEQUENCE_STEP_COUNT,
  collectionItemCount,
  isVisibleDynamicPort,
  numericInputCount,
  parallelBranchCount,
  sequenceOrderForCount,
  sequenceOrderForNode,
  sequenceStepCount,
} from "../sequence-node";
import { caseCatalogPortLabel } from "../task-choice";
import {
  portAppearance,
  requiresTypeLabel,
  type PortColorRole,
  type PortShape,
} from "./port-appearance";
import {
  collapsedWorkflowGroupByMember,
  groupPortForDomainEndpoint,
  workflowGroupMemberIds,
  workflowGroupNodeId,
  workflowGroupOrigin,
  workflowGroups,
} from "../workflow-groups";
import { variableValueKindForNodeTypeKey } from "../variables/variable-authoring";
import type { VariableValueKind } from "../variables/variable-authoring";
import {
  functionNodeDefinitionCacheKey,
  resolveFunctionNodeDefinition,
  type ResolvedNodeDefinition,
} from "../function-node-semantics";

type CanvasNodeDefinition = IndexedNodeDefinition | ResolvedNodeDefinition;

export const RINO_NODE_TYPE = "rinoNode";
export const RINO_EDGE_TYPE = "rinoEdge";
export const REPEAT_HINT_NODE_PREFIX = "editor-repeat-hint:";

export function repeatHintNodeId(hintId: string): string {
  return `${REPEAT_HINT_NODE_PREFIX}${hintId}`;
}

export function repeatHintIdFromNodeId(nodeId: string): string | undefined {
  if (!nodeId.startsWith(REPEAT_HINT_NODE_PREFIX)) {
    return undefined;
  }
  const hintId = nodeId.slice(REPEAT_HINT_NODE_PREFIX.length);
  return hintId.length === 0 ? undefined : hintId;
}

/** Default node width from the style guide. Declared here because the drop-position
 * conversion needs it before a node has ever been measured. */
export const NODE_WIDTH = 220;
export const NODE_HEADER_HEIGHT = 32;

/** How an edge relates to execution.
 *
 * `active` is the path a run is following right now and is the only state allowed ongoing
 * animation. `traversed` is a path an earlier step already took and stays static, so a
 * finished run reads as history rather than as continuing work.
 */
export type EdgeActivity = "idle" | "active" | "traversed";

export type EdgeActivityMap = ReadonlyMap<string, EdgeActivity>;

/** No run is in progress, so no edge carries execution state. The authoritative runtime
 * supplies real activity in P4-T06; until then this is the truthful value rather than a
 * default hidden inside the projection. */
export const EMPTY_EDGE_ACTIVITY: EdgeActivityMap = new Map<
  string,
  EdgeActivity
>();

export interface CanvasPortView {
  portId: string;
  domainNodeId: string;
  domainPortId: string;
  labelKey: string;
  /** User-authored label for a bounded task-choice branch. */
  labelOverride?: string;
  /** The rendered type, used in the tooltip and beside generically coloured ports so type
   * is never communicated by colour alone. */
  typeLabel: string;
  /** True when the port's colour stands for a family of types, in which case the rendered
   * type is shown beside the label as well. */
  showTypeLabel: boolean;
  portKind: "execution" | "data";
  colorRole: PortColorRole;
  shape: PortShape;
  required: boolean;
  /** True when an edge already supplies this input, in which case its literal editor is
   * replaced by the incoming connection. */
  connected: boolean;
  acceptsLiteral: boolean;
  literalValue: EditableValue | undefined;
  /** The control an inline literal is edited with. Derived from the port type by the same
   * function the inspector uses, so a value edited on the node and the same value edited
   * in the inspector obey identical rules. */
  literalEditor: FieldEditor;
  promotionKind: "number" | "string" | "point" | "rect" | undefined;
}

/* React Flow constrains node and edge payloads to an index-signature-bearing type, which
   only a type alias satisfies. These two declarations must therefore stay aliases. */
/* eslint-disable @typescript-eslint/consistent-type-definitions -- see above */
export type CanvasNodeData = {
  graphId: string;
  nodeId: string;
  typeKey: string;
  functionGraphId?: string;
  titleKey: string;
  /** Dynamic function calls show the target graph name while retaining titleKey for the
   * bilingual function-node kind and accessibility context. */
  titleOverride?: string;
  displayAlias: string | undefined;
  iconKey: string;
  category: string;
  inputs: readonly CanvasPortView[];
  outputs: readonly CanvasPortView[];
  disabled: boolean;
  breakpoint: boolean;
  /** The registry has no definition for this node's type. The node still renders so the
   * document is never silently reduced, but it carries no ports and cannot be rewired. */
  unresolved: boolean;
  repeatHint?: {
    hintId: string;
    edgeId: string;
  };
  propertyFields?: readonly (PropertyField & {
    value: EditableValue | undefined;
  })[];
  variableControl?: {
    valueKind: VariableValueKind;
    selectedVariableId: string | undefined;
    selectedVariableName: string | undefined;
    selectedPersistent: boolean | undefined;
    options: readonly {
      variableId: string;
      name: string;
      persistent: boolean;
    }[];
    canPersist: boolean;
    variableMissing: boolean;
  };
  logControl?: {
    segmentKinds: readonly ("text" | "number")[];
    appendNewline: boolean;
    canAdd: boolean;
  };
  workflowGroup?: {
    groupId: string;
    kind: WorkflowGroupV1["kind"];
    steps: readonly {
      role: string;
      nodeId: string;
      typeKey: string;
      titleKey: string;
      iconKey: string;
    }[];
    imageRecognitionParameters?: {
      delayMilliseconds: number;
      delayMode: "beforeRecognition" | "beforeClick";
      canDelayClick: boolean;
      matchThreshold: number;
      templateAssetNodeId: string;
      templateAssetId: string | undefined;
      roiNodeId: string;
      regionEnabled: boolean;
      region: {
        x: number;
        y: number;
        width: number;
        height: number;
        referenceWidth: number;
        referenceHeight: number;
      };
    };
    textRecognitionParameters?: {
      delayMilliseconds: number;
      delayMode: "beforeRecognition" | "beforeClick";
      canDelayClick: boolean;
      confidenceThreshold: number;
      region?: {
        nodeId: string;
        enabled: boolean;
        x: number;
        y: number;
        width: number;
        height: number;
        referenceWidth: number;
        referenceHeight: number;
      };
      clickPoint?: {
        nodeId: string;
        x: number;
        y: number;
        referenceWidth: number;
        referenceHeight: number;
      };
    };
  };
  workflowGroupControl?: {
    groupId: string;
    expanded: boolean;
  };
  sequenceControl?: {
    stepCount: number;
    canAdd: boolean;
    order?: readonly string[];
    kind?: "sequence" | "sequenceOrder";
    legacy?: boolean;
  };
  dynamicPortControl?: {
    kind: "parallelBranch" | "numericInput" | "collectionItem";
    count: number;
    canAdd: boolean;
  };
};

export type CanvasEdgeData = {
  edgeKind: EdgeV1["edgeKind"];
  colorRole: PortColorRole;
  typeLabel: string;
  activity: EdgeActivity;
};
/* eslint-enable @typescript-eslint/consistent-type-definitions */

export type RinoFlowNode = Node<CanvasNodeData, typeof RINO_NODE_TYPE>;
export type RinoFlowEdge = Edge<CanvasEdgeData, typeof RINO_EDGE_TYPE>;

function promotionKind(
  type: TypeDescriptorV1,
): CanvasPortView["promotionKind"] {
  if (type.kind === "optional") {
    return promotionKind(type.value);
  }
  return type.kind === "number" ||
    type.kind === "string" ||
    type.kind === "point" ||
    type.kind === "rect"
    ? type.kind
    : undefined;
}

function buildPortViews(
  definition: CanvasNodeDefinition,
  node: NodeV1,
  direction: "input" | "output",
  connectedPorts: ReadonlySet<string>,
): CanvasPortView[] {
  const views: CanvasPortView[] = [];
  for (const port of definition.ports.values()) {
    if (port.direction !== direction || !isVisibleNodePort(node, port.portId)) {
      continue;
    }
    const appearance = portAppearance(port.type);
    const connected = connectedPorts.has(port.portId);
    const labelOverride =
      caseCatalogPortLabel(node, port.portId) ??
      ("portLabels" in definition
        ? definition.portLabels.get(port.portId)
        : undefined);
    views.push({
      portId: port.portId,
      domainNodeId: node.nodeId,
      domainPortId: port.portId,
      labelKey:
        node.typeKey === "core.diagnostic.log" &&
        port.portId.startsWith("textPart")
          ? "node.core.diagnostic.log.port.textPart"
          : node.typeKey === "core.diagnostic.log" &&
              port.portId.startsWith("numberPart")
            ? "node.core.diagnostic.log.port.numberPart"
            : port.labelKey,
      ...(labelOverride === undefined ? {} : { labelOverride }),
      typeLabel: describeType(port.type),
      showTypeLabel: requiresTypeLabel(appearance.colorRole),
      portKind: port.portKind,
      colorRole: appearance.colorRole,
      shape: appearance.shape,
      required: port.required === true,
      connected,
      acceptsLiteral: port.acceptsLiteral === true,
      literalValue: Object.hasOwn(node.inputValues, port.portId)
        ? node.inputValues[port.portId]
        : undefined,
      literalEditor: literalEditorFor(port.type),
      promotionKind:
        direction === "input" ? promotionKind(port.type) : undefined,
    });
  }
  if (node.typeKey === "core.flow.sequence" && direction === "output") {
    const stepCount = sequenceStepCount(node);
    if (stepCount !== undefined) {
      const order = sequenceOrderForCount(node, stepCount);
      const rank = new Map(order.map((stepId, index) => [stepId, index]));
      views.sort(
        (left, right) =>
          (rank.get(left.portId) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(right.portId) ?? Number.MAX_SAFE_INTEGER),
      );
    }
  }
  return views;
}

function logSegmentKinds(node: NodeV1): readonly ("text" | "number")[] {
  const declared = node.properties["segmentKinds"];
  if (
    Array.isArray(declared) &&
    declared.length > 0 &&
    declared.length <= 16 &&
    declared.every((kind) => kind === "text" || kind === "number")
  ) {
    return declared;
  }
  return ["text"];
}

function variableControlForNode(
  graph: GraphV1,
  node: NodeV1,
  document?: RinoProjectDocumentV1,
): CanvasNodeData["variableControl"] {
  const valueKind = variableValueKindForNodeTypeKey(node.typeKey);
  if (valueKind === undefined) {
    return undefined;
  }
  const variables = document?.variables ?? graph.variables ?? [];
  const selectedVariableId =
    typeof node.properties["variableId"] === "string"
      ? node.properties["variableId"]
      : undefined;
  const options = variables
    .filter((variable) => variable.valueKind === valueKind)
    .map((variable) => ({
      variableId: variable.variableId,
      name: variable.name,
      persistent: variable.persistent,
    }));
  const selected = options.find(
    (option) => option.variableId === selectedVariableId,
  );
  return {
    valueKind,
    selectedVariableId,
    selectedVariableName: selected?.name,
    selectedPersistent: selected?.persistent,
    options,
    canPersist: graph.kind !== "function" && valueKind !== "imageRef",
    variableMissing: selected === undefined,
  };
}

function isVisibleNodePort(node: NodeV1, portId: string): boolean {
  if (!isVisibleDynamicPort(node, portId)) return false;
  if (node.typeKey === "automation.clickPoint") {
    const mode = node.properties["inputMode"];
    if (
      portId === "run" ||
      portId === "clicked" ||
      portId === "clickedCount" ||
      portId === "selectedIndex" ||
      portId === "next" ||
      portId === "failed"
    ) {
      return true;
    }
    if (mode === "point") return portId === "point";
    if (mode === "coordinates") {
      return ["image", "x", "y", "referenceWidth", "referenceHeight"].includes(
        portId,
      );
    }
    if (mode === "randomPoints" || mode === "sequentialPoints") {
      return portId === "points";
    }
    if (mode === "rectCenter" || mode === "rectRandom") {
      return portId === "rect";
    }
    return portId === "point";
  }
  if (node.typeKey === "text.readValue") {
    if (
      portId === "run" ||
      portId === "result" ||
      portId === "selected" ||
      portId === "missing" ||
      portId === "invalid"
    ) {
      return true;
    }
    const valueMode =
      node.properties["valueMode"] === "text" ? "text" : "number";
    const selectionMode =
      node.properties["selectionMode"] === "all" ? "all" : "position";
    if (valueMode === "text") {
      return selectionMode === "all"
        ? portId === "texts" || portId === "rects"
        : portId === "text" || portId === "rect";
    }
    return selectionMode === "all"
      ? portId === "numbers" || portId === "rects"
      : portId === "number" || portId === "rect";
  }
  if (node.typeKey !== "core.diagnostic.log") return true;
  if (portId === "run" || portId === "next") return true;
  const declared = node.properties["segmentKinds"];
  const hasValidStructuredState =
    Array.isArray(declared) &&
    declared.length > 0 &&
    declared.length <= 16 &&
    declared.every((kind) => kind === "text" || kind === "number");
  if (!hasValidStructuredState && Object.hasOwn(node.inputValues, "message")) {
    return portId === "message";
  }
  return logSegmentKinds(node).some(
    (kind, index) => portId === `${kind}Part${(index + 1).toString()}`,
  );
}

function buildWorkflowGroupPortView(
  graph: GraphV1,
  index: NodeRegistryIndex,
  groupPort: WorkflowGroupV1["exposedPorts"][number],
  connectedPorts: ReadonlyMap<string, ConnectedPorts>,
): CanvasPortView | undefined {
  const node = graph.nodes.find(
    (candidate) => candidate.nodeId === groupPort.nodeId,
  );
  const definition = node === undefined ? undefined : index.find(node.typeKey);
  const port = definition?.ports.get(groupPort.portId);
  if (node === undefined || port === undefined) {
    return undefined;
  }
  const appearance = portAppearance(port.type);
  const nodeConnections = connectedPorts.get(node.nodeId) ?? NO_CONNECTED_PORTS;
  const connected =
    port.direction === "input"
      ? nodeConnections.inputs.has(port.portId)
      : nodeConnections.outputs.has(port.portId);
  return {
    portId: groupPort.proxyPortId,
    domainNodeId: node.nodeId,
    domainPortId: port.portId,
    labelKey: groupPort.labelKey,
    typeLabel: describeType(port.type),
    showTypeLabel: requiresTypeLabel(appearance.colorRole),
    portKind: port.portKind,
    colorRole: appearance.colorRole,
    shape: appearance.shape,
    required: port.required === true,
    connected,
    acceptsLiteral: port.acceptsLiteral === true,
    literalValue: Object.hasOwn(node.inputValues, port.portId)
      ? node.inputValues[port.portId]
      : undefined,
    literalEditor: literalEditorFor(port.type),
    promotionKind:
      port.direction === "input" ? promotionKind(port.type) : undefined,
  };
}

function workflowGroupSteps(
  graph: GraphV1,
  index: NodeRegistryIndex,
  group: WorkflowGroupV1,
): NonNullable<CanvasNodeData["workflowGroup"]>["steps"] {
  const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  return group.members.flatMap((member) => {
    if (
      (group.kind === "imageRecognition" &&
        (member.role === "templateAsset" || member.role === "roi")) ||
      (group.kind === "textRecognition" &&
        (member.role === "roi" || member.role === "clickPoint"))
    ) {
      return [];
    }
    const node = nodes.get(member.nodeId);
    const definition =
      node === undefined ? undefined : index.find(node.typeKey);
    return node === undefined
      ? []
      : [
          {
            role: member.role,
            nodeId: node.nodeId,
            typeKey: node.typeKey,
            titleKey: definition?.definition.titleKey ?? node.typeKey,
            iconKey: definition?.definition.iconKey ?? "node.unknown",
          },
        ];
  });
}

function textRecognitionParameters(
  graph: GraphV1,
  group: WorkflowGroupV1,
):
  | NonNullable<
      NonNullable<CanvasNodeData["workflowGroup"]>["textRecognitionParameters"]
    >
  | undefined {
  if (group.kind !== "textRecognition") {
    return undefined;
  }
  const nodeByRole = (role: string) => {
    const nodeId = group.members.find((member) => member.role === role)?.nodeId;
    return graph.nodes.find((node) => node.nodeId === nodeId);
  };
  const delay = nodeByRole("delay") ?? nodeByRole("beforeDelay");
  const hasLegacyAfterDelay = nodeByRole("afterDelay") !== undefined;
  const recognizer = nodeByRole("recognizer");
  if (delay === undefined || recognizer === undefined) {
    return undefined;
  }
  const roi = nodeByRole("roi");
  const clickPoint = nodeByRole("clickPoint");
  return {
    delayMilliseconds: numericInput(delay, "durationMilliseconds"),
    delayMode:
      hasLegacyAfterDelay ||
      group.exposedPorts.find((port) => port.proxyPortId === "run")?.nodeId ===
        delay.nodeId
        ? "beforeRecognition"
        : "beforeClick",
    canDelayClick: recognitionClickEnabled(nodeByRole("click")),
    confidenceThreshold:
      typeof recognizer.properties["confidenceThreshold"] === "number"
        ? recognizer.properties["confidenceThreshold"]
        : 0.3,
    ...(roi === undefined
      ? {}
      : {
          region: {
            nodeId: roi.nodeId,
            enabled: graph.edges.some(
              (edge) =>
                edge.sourceNodeId === roi.nodeId &&
                edge.sourcePortId === "rectangle" &&
                edge.targetNodeId === recognizer.nodeId &&
                edge.targetPortId === "roi",
            ),
            x: numericInput(roi, "x"),
            y: numericInput(roi, "y"),
            width: numericInput(roi, "width"),
            height: numericInput(roi, "height"),
            referenceWidth: numericInput(roi, "referenceWidth"),
            referenceHeight: numericInput(roi, "referenceHeight"),
          },
        }),
    ...(clickPoint === undefined
      ? {}
      : {
          clickPoint: {
            nodeId: clickPoint.nodeId,
            x: numericInput(clickPoint, "x"),
            y: numericInput(clickPoint, "y"),
            referenceWidth: numericInput(clickPoint, "referenceWidth"),
            referenceHeight: numericInput(clickPoint, "referenceHeight"),
          },
        }),
  };
}

/** A click member remains in a recognition group as a sequence sentinel when the
 * author turns clicking off. It is still present so the same compact control can
 * turn clicking back on, but it must not make click-only timing fields appear. */
function recognitionClickEnabled(node: NodeV1 | undefined): boolean {
  return node !== undefined && node.typeKey !== "core.flow.sequence";
}

function numericInput(node: NodeV1, portId: string): number {
  const value = node.inputValues[portId];
  return typeof value === "number" ? value : 0;
}

function imageRecognitionParameters(
  graph: GraphV1,
  group: WorkflowGroupV1,
):
  | NonNullable<
      NonNullable<CanvasNodeData["workflowGroup"]>["imageRecognitionParameters"]
    >
  | undefined {
  if (group.kind !== "imageRecognition") {
    return undefined;
  }
  const nodeByRole = (role: string) => {
    const nodeId = group.members.find((member) => member.role === role)?.nodeId;
    return graph.nodes.find((node) => node.nodeId === nodeId);
  };
  const templateAsset = nodeByRole("templateAsset");
  const roi = nodeByRole("roi");
  const recognizer = nodeByRole("recognizer");
  const delay = nodeByRole("delay");
  if (
    templateAsset === undefined ||
    roi === undefined ||
    recognizer === undefined ||
    delay === undefined
  ) {
    return undefined;
  }
  const threshold = recognizer.properties["threshold"];
  return {
    delayMilliseconds: numericInput(delay, "durationMilliseconds"),
    delayMode:
      group.exposedPorts.find((port) => port.proxyPortId === "run")?.nodeId ===
      delay.nodeId
        ? "beforeRecognition"
        : "beforeClick",
    canDelayClick: recognitionClickEnabled(nodeByRole("click")),
    matchThreshold:
      typeof threshold === "number" &&
      Number.isFinite(threshold) &&
      threshold >= 0 &&
      threshold <= 1
        ? threshold
        : 0.7,
    templateAssetNodeId: templateAsset.nodeId,
    templateAssetId:
      typeof templateAsset.properties["assetId"] === "string"
        ? templateAsset.properties["assetId"]
        : undefined,
    roiNodeId: roi.nodeId,
    regionEnabled: graph.edges.some(
      (edge) =>
        edge.sourceNodeId === roi.nodeId &&
        edge.sourcePortId === "rectangle" &&
        edge.targetNodeId === recognizer.nodeId &&
        edge.targetPortId === "roi",
    ),
    region: {
      x: numericInput(roi, "x"),
      y: numericInput(roi, "y"),
      width: numericInput(roi, "width"),
      height: numericInput(roi, "height"),
      referenceWidth: numericInput(roi, "referenceWidth"),
      referenceHeight: numericInput(roi, "referenceHeight"),
    },
  };
}

function workflowGroupVisiblePorts(
  graph: GraphV1,
  group: WorkflowGroupV1,
): WorkflowGroupV1["exposedPorts"] {
  const memberIds = workflowGroupMemberIds(group);
  const ports = new Map(
    group.exposedPorts.map((port) => [port.proxyPortId, port]),
  );
  for (const edge of graph.edges) {
    const sourceInside = memberIds.has(edge.sourceNodeId);
    const targetInside = memberIds.has(edge.targetNodeId);
    if (sourceInside === targetInside) {
      continue;
    }
    const port = sourceInside
      ? groupPortForDomainEndpoint(group, edge.sourceNodeId, edge.sourcePortId)
      : groupPortForDomainEndpoint(group, edge.targetNodeId, edge.targetPortId);
    ports.set(port.proxyPortId, port);
  }
  return [...ports.values()];
}

interface ConnectedPorts {
  inputs: ReadonlySet<string>;
  outputs: ReadonlySet<string>;
  signature: string;
}

/** Joins port identifiers into one comparable string. A port identifier cannot contain
 * this character, so two different sets of ports cannot produce the same signature. */
const PORT_SIGNATURE_SEPARATOR = "\u0000";

const NO_CONNECTED_PORTS: ConnectedPorts = {
  inputs: new Set<string>(),
  outputs: new Set<string>(),
  signature: "",
};

/** Which input and output ports of each node already carry an edge.
 *
 * Built once per projection pass rather than once per node. Asking every node to scan the
 * edge list would cost one pass over every edge for every node, which is quadratic in a
 * graph the persisted format allows to hold five thousand nodes and ten thousand edges.
 */
function connectedPortsByNode(graph: GraphV1): Map<string, ConnectedPorts> {
  const inputsByNode = new Map<string, string[]>();
  const outputsByNode = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const existingInputs = inputsByNode.get(edge.targetNodeId);
    if (existingInputs === undefined) {
      inputsByNode.set(edge.targetNodeId, [edge.targetPortId]);
    } else {
      existingInputs.push(edge.targetPortId);
    }
    const existingOutputs = outputsByNode.get(edge.sourceNodeId);
    if (existingOutputs === undefined) {
      outputsByNode.set(edge.sourceNodeId, [edge.sourcePortId]);
    } else {
      existingOutputs.push(edge.sourcePortId);
    }
  }

  const connected = new Map<string, ConnectedPorts>();
  const nodeIds = new Set([...inputsByNode.keys(), ...outputsByNode.keys()]);
  for (const nodeId of nodeIds) {
    const inputPortIds = inputsByNode.get(nodeId) ?? [];
    const outputPortIds = outputsByNode.get(nodeId) ?? [];
    inputPortIds.sort();
    outputPortIds.sort();
    connected.set(nodeId, {
      inputs: new Set(inputPortIds),
      outputs: new Set(outputPortIds),
      signature: `${inputPortIds.join(PORT_SIGNATURE_SEPARATOR)}${PORT_SIGNATURE_SEPARATOR}${PORT_SIGNATURE_SEPARATOR}${outputPortIds.join(PORT_SIGNATURE_SEPARATOR)}`,
    });
  }
  return connected;
}

function legacySequenceStepCounts(graph: GraphV1): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.sourcePortId === "steps") {
      counts.set(edge.sourceNodeId, (counts.get(edge.sourceNodeId) ?? 0) + 1);
    }
  }
  return counts;
}

interface NodeCacheEntry {
  source: NodeV1;
  definition: CanvasNodeDefinition | undefined;
  definitionKey: string;
  connectedSignature: string;
  flowNode: RinoFlowNode;
}

interface RepeatHintCacheEntry {
  source: RepeatHintV1;
  flowNode: RinoFlowNode;
}

interface EdgeCacheEntry {
  source: EdgeV1;
  sourceDefinitionKey: string;
  targetDefinitionKey: string;
  activity: EdgeActivity;
  flowEdge: RinoFlowEdge;
}

/** Translates the domain graph into what React Flow renders.
 *
 * The projection is stateful only as a cache: given the same domain input it returns the
 * same object references, so memoized node components skip re-rendering when an unrelated
 * part of the document changes. Commands replace only the entities they touch, so an
 * unchanged node arrives with its previous identity and short-circuits here immediately.
 */
export class GraphProjection {
  private readonly nodeCache = new Map<string, NodeCacheEntry>();
  private readonly repeatHintCache = new Map<string, RepeatHintCacheEntry>();
  private readonly edgeCache = new Map<string, EdgeCacheEntry>();
  private graphId: string | undefined;
  private registryIndex: NodeRegistryIndex | undefined;
  private registrySource: RinoNodeRegistrySnapshotV1 | undefined;
  private workflowGroupsSource: readonly WorkflowGroupV1[] | undefined;
  private variablesSource: RinoProjectDocumentV1["variables"] | undefined;

  private indexFor(registry: RinoNodeRegistrySnapshotV1): NodeRegistryIndex {
    if (this.registrySource !== registry || !this.registryIndex) {
      // A new registry snapshot invalidates every derived port view.
      this.registrySource = registry;
      this.registryIndex = new NodeRegistryIndex(registry);
      this.nodeCache.clear();
      this.edgeCache.clear();
    }
    return this.registryIndex;
  }

  private definitionFor(
    graph: GraphV1,
    node: NodeV1,
    index: NodeRegistryIndex,
    document: RinoProjectDocumentV1 | undefined,
  ): CanvasNodeDefinition | undefined {
    return (
      resolveFunctionNodeDefinition(node, graph, document) ??
      index.find(node.typeKey)
    );
  }

  private titleOverrideFor(
    node: NodeV1,
    document: RinoProjectDocumentV1 | undefined,
  ): string | undefined {
    if (node.typeKey !== "core.function.call" || document === undefined) {
      return undefined;
    }
    const graphId = node.properties["functionGraphId"];
    if (typeof graphId !== "string") {
      return undefined;
    }
    return document.graphs.find((candidate) => candidate.graphId === graphId)
      ?.name;
  }

  projectNodes(
    graph: GraphV1,
    registry: RinoNodeRegistrySnapshotV1,
    document?: RinoProjectDocumentV1,
  ): RinoFlowNode[] {
    this.prepareGraph(graph, document);
    const index = this.indexFor(registry);
    const connectedPorts = connectedPortsByNode(graph);
    const legacyStepCounts = legacySequenceStepCounts(graph);
    const collapsedGroups = workflowGroups(graph).filter(
      (group) => group.collapsed,
    );
    const collapsedByMember = collapsedWorkflowGroupByMember(graph);
    const expandedPrimaryByMember = new Map<string, WorkflowGroupV1>();
    for (const group of workflowGroups(graph)) {
      const primary = group.members[0];
      if (!group.collapsed) {
        expandedPrimaryByMember.set(primary.nodeId, group);
      }
    }
    const live = new Set<string>();
    const liveRepeatHints = new Set<string>();
    const nodes: RinoFlowNode[] = [];

    for (const node of graph.nodes) {
      if (collapsedByMember.has(node.nodeId)) {
        continue;
      }
      live.add(node.nodeId);
      const definition = this.definitionFor(graph, node, index, document);
      const definitionKey = functionNodeDefinitionCacheKey(
        node,
        graph,
        document,
      );
      const titleOverride = this.titleOverrideFor(node, document);
      const connected = connectedPorts.get(node.nodeId) ?? NO_CONNECTED_PORTS;
      const visibleSequenceStepCount =
        node.typeKey === "core.flow.sequence"
          ? (sequenceStepCount(node) ??
            Math.max(1, legacyStepCounts.get(node.nodeId) ?? 0))
          : undefined;
      const legacySequenceStepCount =
        node.typeKey === "core.flow.sequence" &&
        sequenceStepCount(node) === undefined
          ? (legacyStepCounts.get(node.nodeId) ?? 0)
          : undefined;
      const legacySequence =
        node.typeKey === "core.flow.sequence" &&
        sequenceStepCount(node) === undefined &&
        (legacyStepCounts.get(node.nodeId) ?? 0) > 0;
      const connectedSignature =
        visibleSequenceStepCount === undefined
          ? connected.signature
          : `${connected.signature}${PORT_SIGNATURE_SEPARATOR}${visibleSequenceStepCount.toString()}${PORT_SIGNATURE_SEPARATOR}${(legacySequenceStepCount ?? -1).toString()}`;
      const cached = this.nodeCache.get(node.nodeId);
      if (
        cached?.source === node &&
        cached.definitionKey === definitionKey &&
        cached.connectedSignature === connectedSignature
      ) {
        nodes.push(cached.flowNode);
        continue;
      }

      const variableControl = variableControlForNode(graph, node, document);
      const data: CanvasNodeData = {
        graphId: graph.graphId,
        nodeId: node.nodeId,
        typeKey: node.typeKey,
        ...(node.typeKey === "core.function.call" &&
        typeof node.properties["functionGraphId"] === "string"
          ? { functionGraphId: node.properties["functionGraphId"] }
          : {}),
        titleKey: definition?.definition.titleKey ?? node.typeKey,
        ...(titleOverride === undefined ? {} : { titleOverride }),
        displayAlias: node.displayAlias,
        iconKey: definition?.definition.iconKey ?? "node.unknown",
        category: definition?.definition.category ?? "unknown",
        inputs: definition
          ? buildPortViews(definition, node, "input", connected.inputs)
          : [],
        outputs: definition
          ? buildPortViews(definition, node, "output", connected.outputs)
          : [],
        disabled: node.disabled === true,
        breakpoint: node.breakpoint === true,
        unresolved: definition === undefined,
        ...(variableControl === undefined ? {} : { variableControl }),
        ...(definition === undefined
          ? {}
          : {
              propertyFields: readPropertyFields(definition.definition)
                .fields.filter(
                  (field) =>
                    !(
                      variableValueKindForNodeTypeKey(node.typeKey) !==
                        undefined && field.propertyKey === "variableId"
                    ),
                )
                .map((field) => ({
                  ...field,
                  value: Object.hasOwn(node.properties, field.propertyKey)
                    ? node.properties[field.propertyKey]
                    : field.defaultValue,
                })),
            }),
        ...(node.typeKey !== "core.diagnostic.log"
          ? {}
          : {
              logControl: {
                segmentKinds: logSegmentKinds(node),
                appendNewline: node.properties["appendNewline"] === true,
                canAdd: logSegmentKinds(node).length < 16,
              },
            }),
        ...(node.typeKey !== "core.flow.sequence" &&
        node.typeKey !== "core.flow.sequenceOrder"
          ? {}
          : {
              sequenceControl: {
                stepCount:
                  node.typeKey === "core.flow.sequenceOrder"
                    ? (sequenceStepCount(node) ??
                      sequenceOrderForNode(node).length)
                    : (visibleSequenceStepCount ?? 1),
                canAdd:
                  (node.typeKey === "core.flow.sequenceOrder"
                    ? (sequenceStepCount(node) ??
                      sequenceOrderForNode(node).length)
                    : (visibleSequenceStepCount ?? 1)) <
                  MAXIMUM_SEQUENCE_STEP_COUNT,
                order:
                  node.typeKey === "core.flow.sequenceOrder"
                    ? sequenceOrderForNode(node)
                    : sequenceOrderForCount(
                        node,
                        visibleSequenceStepCount ?? 1,
                      ),
                kind:
                  node.typeKey === "core.flow.sequenceOrder"
                    ? ("sequenceOrder" as const)
                    : ("sequence" as const),
                ...(legacySequence ? { legacy: true } : {}),
              },
            }),
        ...(node.typeKey !== "core.flow.parallel"
          ? {}
          : {
              dynamicPortControl: {
                kind: "parallelBranch" as const,
                count: parallelBranchCount(node) ?? 2,
                canAdd:
                  (parallelBranchCount(node) ?? 2) <
                  MAXIMUM_PARALLEL_BRANCH_COUNT,
              },
            }),
        ...(node.typeKey !== "core.math.expression" &&
        node.typeKey !== "core.logic.numberSelect"
          ? {}
          : {
              dynamicPortControl: {
                kind: "numericInput" as const,
                count: numericInputCount(node) ?? 3,
                canAdd:
                  (numericInputCount(node) ?? 3) < MAXIMUM_NUMERIC_INPUT_COUNT,
              },
            }),
        ...(node.typeKey !== "core.collection.imageList" &&
        node.typeKey !== "core.collection.regionList" &&
        node.typeKey !== "core.collection.pointList"
          ? {}
          : {
              dynamicPortControl: {
                kind: "collectionItem" as const,
                count: collectionItemCount(node) ?? 2,
                canAdd:
                  (collectionItemCount(node) ?? 2) <
                  MAXIMUM_COLLECTION_ITEM_COUNT,
              },
            }),
        ...(expandedPrimaryByMember.get(node.nodeId) === undefined
          ? {}
          : {
              workflowGroupControl: {
                groupId:
                  expandedPrimaryByMember.get(node.nodeId)?.groupId ?? "",
                expanded: true,
              },
            }),
      };
      const flowNode: RinoFlowNode = {
        id: node.nodeId,
        type: RINO_NODE_TYPE,
        position: { x: node.position.x, y: node.position.y },
        data,
      };
      this.nodeCache.set(node.nodeId, {
        source: node,
        definition,
        definitionKey,
        connectedSignature,
        flowNode,
      });
      nodes.push(flowNode);
    }

    for (const group of collapsedGroups) {
      const virtualNodeId = workflowGroupNodeId(group.groupId);
      const steps = workflowGroupSteps(graph, index, group);
      const aliasTargetNode = graph.nodes.find(
        (node) => node.nodeId === steps[0]?.nodeId,
      );
      live.add(virtualNodeId);
      const portViews = workflowGroupVisiblePorts(graph, group).flatMap(
        (groupPort) => {
          const view = buildWorkflowGroupPortView(
            graph,
            index,
            groupPort,
            connectedPorts,
          );
          return view === undefined ? [] : [view];
        },
      );
      const recognitionParameters = imageRecognitionParameters(graph, group);
      const textParameters = textRecognitionParameters(graph, group);
      const data: CanvasNodeData = {
        graphId: graph.graphId,
        nodeId: virtualNodeId,
        typeKey: `workflowGroup.${group.kind}`,
        titleKey: `workflowGroup.${group.kind}.title`,
        displayAlias: aliasTargetNode?.displayAlias,
        iconKey:
          group.kind === "imageRecognition"
            ? "node.imageRecognition"
            : "node.ocr",
        category: "vision",
        inputs: portViews.filter((port) => {
          const node = graph.nodes.find(
            (candidate) => candidate.nodeId === port.domainNodeId,
          );
          return (
            node !== undefined &&
            index.find(node.typeKey)?.ports.get(port.domainPortId)
              ?.direction === "input"
          );
        }),
        outputs: portViews.filter((port) => {
          const node = graph.nodes.find(
            (candidate) => candidate.nodeId === port.domainNodeId,
          );
          return (
            node !== undefined &&
            index.find(node.typeKey)?.ports.get(port.domainPortId)
              ?.direction === "output"
          );
        }),
        disabled: false,
        breakpoint: false,
        unresolved: false,
        workflowGroup: {
          groupId: group.groupId,
          kind: group.kind,
          steps,
          ...(recognitionParameters === undefined
            ? {}
            : {
                imageRecognitionParameters: recognitionParameters,
              }),
          ...(textParameters === undefined
            ? {}
            : {
                textRecognitionParameters: textParameters,
              }),
        },
        workflowGroupControl: { groupId: group.groupId, expanded: false },
      };
      nodes.push({
        id: virtualNodeId,
        type: RINO_NODE_TYPE,
        position: workflowGroupOrigin(graph, group),
        data,
      });
    }

    for (const hint of graph.editorMetadata?.repeatHints ?? []) {
      const edge = graph.edges.find(
        (candidate) => candidate.edgeId === hint.edgeId,
      );
      if (edge?.edgeKind !== "execution") {
        continue;
      }
      const nodeId = repeatHintNodeId(hint.hintId);
      liveRepeatHints.add(hint.hintId);
      const cached = this.repeatHintCache.get(hint.hintId);
      if (cached?.source === hint) {
        nodes.push(cached.flowNode);
        continue;
      }
      const flowNode: RinoFlowNode = {
        id: nodeId,
        type: RINO_NODE_TYPE,
        position: { x: hint.position.x, y: hint.position.y },
        data: {
          graphId: graph.graphId,
          nodeId,
          typeKey: "editor.repeatHint",
          titleKey: "graph.repeatHint.title",
          displayAlias: undefined,
          iconKey: "node.imageRecognition",
          category: "vision",
          inputs: [],
          outputs: [],
          disabled: false,
          breakpoint: false,
          unresolved: false,
          repeatHint: { hintId: hint.hintId, edgeId: hint.edgeId },
        },
      };
      this.repeatHintCache.set(hint.hintId, { source: hint, flowNode });
      nodes.push(flowNode);
    }

    for (const nodeId of [...this.nodeCache.keys()]) {
      if (!live.has(nodeId)) {
        this.nodeCache.delete(nodeId);
      }
    }
    for (const hintId of [...this.repeatHintCache.keys()]) {
      if (!liveRepeatHints.has(hintId)) {
        this.repeatHintCache.delete(hintId);
      }
    }
    return nodes;
  }

  projectEdges(
    graph: GraphV1,
    registry: RinoNodeRegistrySnapshotV1,
    edgeActivity: EdgeActivityMap,
    document?: RinoProjectDocumentV1,
  ): RinoFlowEdge[] {
    this.prepareGraph(graph, document);
    const index = this.indexFor(registry);
    const collapsedByMember = collapsedWorkflowGroupByMember(graph);
    const live = new Set<string>();
    const edges: RinoFlowEdge[] = [];

    for (const edge of graph.edges) {
      const sourceGroup = collapsedByMember.get(edge.sourceNodeId);
      const targetGroup = collapsedByMember.get(edge.targetNodeId);
      if (
        sourceGroup !== undefined &&
        sourceGroup.groupId === targetGroup?.groupId
      ) {
        continue;
      }
      live.add(edge.edgeId);
      const activity = edgeActivity.get(edge.edgeId) ?? "idle";
      const cached = this.edgeCache.get(edge.edgeId);

      const sourceNode = graph.nodes.find(
        (node) => node.nodeId === edge.sourceNodeId,
      );
      const targetNode = graph.nodes.find(
        (node) => node.nodeId === edge.targetNodeId,
      );
      const sourceDefinition =
        sourceNode === undefined
          ? undefined
          : this.definitionFor(graph, sourceNode, index, document);
      const sourcePort = sourceDefinition?.ports.get(edge.sourcePortId);
      const sourceDefinitionKey =
        sourceNode === undefined
          ? "missing"
          : functionNodeDefinitionCacheKey(sourceNode, graph, document);
      const targetDefinitionKey =
        targetNode === undefined
          ? "missing"
          : functionNodeDefinitionCacheKey(targetNode, graph, document);
      if (
        cached?.source === edge &&
        cached.activity === activity &&
        cached.sourceDefinitionKey === sourceDefinitionKey &&
        cached.targetDefinitionKey === targetDefinitionKey
      ) {
        edges.push(cached.flowEdge);
        continue;
      }
      const appearance = sourcePort
        ? portAppearance(sourcePort.type)
        : { colorRole: "unknown" as const };

      const flowEdge: RinoFlowEdge = {
        id: edge.edgeId,
        type: RINO_EDGE_TYPE,
        source:
          sourceGroup === undefined
            ? edge.sourceNodeId
            : workflowGroupNodeId(sourceGroup.groupId),
        sourceHandle:
          sourceGroup === undefined
            ? edge.sourcePortId
            : groupPortForDomainEndpoint(
                sourceGroup,
                edge.sourceNodeId,
                edge.sourcePortId,
              ).proxyPortId,
        target:
          targetGroup === undefined
            ? edge.targetNodeId
            : workflowGroupNodeId(targetGroup.groupId),
        targetHandle:
          targetGroup === undefined
            ? edge.targetPortId
            : groupPortForDomainEndpoint(
                targetGroup,
                edge.targetNodeId,
                edge.targetPortId,
              ).proxyPortId,
        ...(edge.edgeKind === "execution"
          ? {
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 18,
                height: 18,
                color: "var(--port-execution)",
              },
            }
          : {}),
        data: {
          edgeKind: edge.edgeKind,
          colorRole: appearance.colorRole,
          typeLabel: sourcePort ? describeType(sourcePort.type) : "",
          activity,
        },
      };
      this.edgeCache.set(edge.edgeId, {
        source: edge,
        sourceDefinitionKey,
        targetDefinitionKey,
        activity,
        flowEdge,
      });
      edges.push(flowEdge);
    }

    for (const edgeId of [...this.edgeCache.keys()]) {
      if (!live.has(edgeId)) {
        this.edgeCache.delete(edgeId);
      }
    }
    return edges;
  }

  private prepareGraph(graph: GraphV1, document?: RinoProjectDocumentV1): void {
    const workflowGroups = graph.editorMetadata?.workflowGroups;
    const variables = document?.variables ?? graph.variables;
    if (this.graphId === graph.graphId) {
      if (this.workflowGroupsSource !== workflowGroups) {
        this.nodeCache.clear();
        this.edgeCache.clear();
      }
      if (this.variablesSource !== variables) {
        this.nodeCache.clear();
      }
      this.workflowGroupsSource = workflowGroups;
      this.variablesSource = variables;
      return;
    }
    this.graphId = graph.graphId;
    this.workflowGroupsSource = workflowGroups;
    this.variablesSource = variables;
    this.nodeCache.clear();
    this.repeatHintCache.clear();
    this.edgeCache.clear();
  }
}

function samePosition(
  left: { x: number; y: number },
  right: { x: number; y: number },
): boolean {
  return left.x === right.x && left.y === right.y;
}

/** Carries React Flow's render-only state across a re-projection.
 *
 * Selection, drag state, and measured dimensions belong to the rendering model and never
 * enter the document. Merging them here means a document change redraws content without
 * clearing what the user has selected or interrupting a drag in progress.
 */
export function mergeNodeRenderState(
  projected: readonly RinoFlowNode[],
  current: readonly RinoFlowNode[],
): RinoFlowNode[] {
  if (current.length === 0) {
    return [...projected];
  }
  const existingById = new Map(current.map((node) => [node.id, node]));

  return projected.map((node) => {
    const existing = existingById.get(node.id);
    if (!existing) {
      return node;
    }
    // A node being dragged owns its own position until the drag commits, so the
    // projected position is ignored rather than snapping the node back mid-gesture.
    if (existing.dragging === true) {
      return existing;
    }
    if (
      existing.data === node.data &&
      samePosition(existing.position, node.position)
    ) {
      return existing;
    }
    // Render-only fields are copied only when present. React Flow distinguishes an absent
    // measurement from one that is explicitly undefined.
    const merged: RinoFlowNode = { ...node };
    if (existing.selected !== undefined) {
      merged.selected = existing.selected;
    }
    if (existing.measured !== undefined) {
      merged.measured = existing.measured;
    }
    if (existing.width !== undefined) {
      merged.width = existing.width;
    }
    if (existing.height !== undefined) {
      merged.height = existing.height;
    }
    return merged;
  });
}

export function mergeEdgeRenderState(
  projected: readonly RinoFlowEdge[],
  current: readonly RinoFlowEdge[],
): RinoFlowEdge[] {
  if (current.length === 0) {
    return [...projected];
  }
  const existingById = new Map(current.map((edge) => [edge.id, edge]));

  return projected.map((edge) => {
    const existing = existingById.get(edge.id);
    if (!existing) {
      return edge;
    }
    if (existing.data === edge.data) {
      return existing;
    }
    const merged: RinoFlowEdge = { ...edge };
    if (existing.selected !== undefined) {
      merged.selected = existing.selected;
    }
    return merged;
  });
}
