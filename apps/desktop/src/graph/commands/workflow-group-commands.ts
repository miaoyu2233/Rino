import type {
  EdgeV1,
  GraphV1,
  NodeDefinitionV1,
  NodeV1,
  WorkflowGroupV1,
} from "@rino/contracts";

import { createIdentifier } from "../../platform/identifiers";
import { useCoordinatePickerStore } from "../../device-preview/coordinate-picker-store";
import { useRegistryStore } from "../registry/registry-store";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import type { GraphCommand } from "./graph-commands";

export type ImageRecognitionMethod = "template" | "feature" | "color";
export type TextRecognitionClickMethod = "none" | "rectCenter" | "point";
export type RecognitionClickMethod = TextRecognitionClickMethod;
export type RecognitionDelayMode = "beforeRecognition" | "beforeClick";

export const MAXIMUM_TEXT_RECOGNITION_DELAY_MILLISECONDS = 86_400_000;

const IMAGE_RECOGNITION_TYPES: Record<ImageRecognitionMethod, string> = {
  template: "vision.templateMatch",
  feature: "vision.featureMatch",
  color: "vision.colorMatch",
};

const TEXT_CLICK_TYPES: Record<TextRecognitionClickMethod, string> = {
  none: "core.flow.sequence",
  rectCenter: "automation.clickRectCenter",
  point: "automation.clickPoint",
};

interface EditingContext {
  graph: GraphV1;
  definitions: ReadonlyMap<string, NodeDefinitionV1>;
}

function editingContext(): EditingContext | undefined {
  const graphId = useEditorSessionStore.getState().activeGraphId;
  const document = useDocumentStore.getState().history?.document;
  const snapshot = useRegistryStore.getState().snapshot;
  const graph = document?.graphs.find(
    (candidate) => candidate.graphId === graphId,
  );
  if (graph === undefined || snapshot === undefined) {
    return undefined;
  }
  return {
    graph,
    definitions: new Map(
      snapshot.definitions.map((definition) => [
        definition.typeKey,
        definition,
      ]),
    ),
  };
}

function groupById(
  graph: GraphV1,
  groupId: string,
): WorkflowGroupV1 | undefined {
  return graph.editorMetadata?.workflowGroups?.find(
    (group) => group.groupId === groupId,
  );
}

function memberNode(
  graph: GraphV1,
  group: WorkflowGroupV1,
  role: string,
): NodeV1 | undefined {
  const nodeId = group.members.find((member) => member.role === role)?.nodeId;
  return graph.nodes.find((node) => node.nodeId === nodeId);
}

/** Recognition groups keep a sequence node as the click member when clicking is
 * disabled, so the compact control can enable it again without changing group shape. */
function recognitionClickEnabled(node: NodeV1 | undefined): boolean {
  return node !== undefined && node.typeKey !== "core.flow.sequence";
}

function replacementNode(node: NodeV1, definition: NodeDefinitionV1): NodeV1 {
  const stableNode = { ...node };
  delete stableNode.dynamicPortState;
  return {
    ...stableNode,
    typeKey: definition.typeKey,
    typeVersion: definition.typeVersion,
    properties: { ...(definition.propertyDefaults ?? {}) },
    inputValues: {},
  };
}

function invalidIncidentEdges(
  graph: GraphV1,
  nodeId: string,
  definition: NodeDefinitionV1,
): readonly EdgeV1[] {
  const inputPorts = new Set(
    definition.ports
      .filter((port) => port.direction === "input")
      .map((port) => port.portId),
  );
  const outputPorts = new Set(
    definition.ports
      .filter((port) => port.direction === "output")
      .map((port) => port.portId),
  );
  return graph.edges.filter(
    (edge) =>
      (edge.sourceNodeId === nodeId && !outputPorts.has(edge.sourcePortId)) ||
      (edge.targetNodeId === nodeId && !inputPorts.has(edge.targetPortId)),
  );
}

function runComposite(label: string, commands: GraphCommand[]): boolean {
  if (commands.length === 0) {
    return true;
  }
  return useDocumentStore
    .getState()
    .runCommand(label, { kind: "composite", label, commands }).ok;
}

export function setWorkflowGroupCollapsed(
  groupId: string,
  collapsed: boolean,
): boolean {
  const graphId = useEditorSessionStore.getState().activeGraphId;
  if (graphId === undefined) {
    return false;
  }
  return useDocumentStore
    .getState()
    .runCommand("graph.history.setWorkflowGroupCollapsed", {
      kind: "setWorkflowGroupCollapsed",
      graphId,
      groupId,
      collapsed,
    }).ok;
}

export function setImageRecognitionMethod(
  groupId: string,
  method: ImageRecognitionMethod,
): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  if (context === undefined || group?.kind !== "imageRecognition") {
    return false;
  }
  const recognizer = memberNode(context.graph, group, "recognizer");
  const templateAsset = memberNode(context.graph, group, "templateAsset");
  const definition = context.definitions.get(IMAGE_RECOGNITION_TYPES[method]);
  if (recognizer === undefined || definition === undefined) {
    return false;
  }
  if (recognizer.typeKey === definition.typeKey) {
    return true;
  }

  const validPorts = new Set(definition.ports.map((port) => port.portId));
  const matchValuePortId = method === "template" ? "bestScore" : "bestCount";
  const exposedPorts = group.exposedPorts
    .map((port) =>
      port.nodeId === recognizer.nodeId && port.proxyPortId === "matchValue"
        ? { ...port, portId: matchValuePortId }
        : port,
    )
    .filter(
      (port) =>
        port.nodeId !== recognizer.nodeId || validPorts.has(port.portId),
    );
  if (
    method !== "color" &&
    !exposedPorts.some((port) => port.proxyPortId === "templates")
  ) {
    exposedPorts.splice(1, 0, {
      proxyPortId: "templates",
      nodeId: recognizer.nodeId,
      portId: "templates",
      labelKey: "workflowGroup.imageRecognition.port.templates",
    });
  }
  const commands: GraphCommand[] = invalidIncidentEdges(
    context.graph,
    recognizer.nodeId,
    definition,
  ).map((edge) => ({
    kind: "removeEdge",
    graphId: context.graph.graphId,
    edgeId: edge.edgeId,
  }));
  commands.push(
    {
      kind: "replaceNode",
      graphId: context.graph.graphId,
      node: replacementNode(recognizer, definition),
    },
    {
      kind: "replaceWorkflowGroup",
      graphId: context.graph.graphId,
      group: { ...group, exposedPorts },
    },
  );
  if (
    method !== "color" &&
    templateAsset !== undefined &&
    !edgeExists(
      context.graph,
      templateAsset.nodeId,
      "image",
      recognizer.nodeId,
      "template",
    )
  ) {
    commands.push(
      addEdgeCommand(
        context.graph.graphId,
        "data",
        templateAsset.nodeId,
        "image",
        recognizer.nodeId,
        "template",
      ),
    );
  }
  return runComposite("graph.history.setRecognitionMethod", commands);
}

export interface ImageRecognitionRegionValue {
  x: number;
  y: number;
  width: number;
  height: number;
  referenceWidth: number;
  referenceHeight: number;
}

export interface TextRecognitionPointValue {
  x: number;
  y: number;
  referenceWidth: number;
  referenceHeight: number;
}

const MAXIMUM_IMAGE_DIMENSION = 16_384;
const IMAGE_RECOGNITION_REGION_FIELDS = [
  "x",
  "y",
  "width",
  "height",
  "referenceWidth",
  "referenceHeight",
] as const satisfies readonly (keyof ImageRecognitionRegionValue)[];

function validRegion(value: ImageRecognitionRegionValue): boolean {
  return (
    Number.isInteger(value.x) &&
    Number.isInteger(value.y) &&
    Number.isInteger(value.width) &&
    Number.isInteger(value.height) &&
    Number.isInteger(value.referenceWidth) &&
    Number.isInteger(value.referenceHeight) &&
    value.x >= 0 &&
    value.y >= 0 &&
    value.width > 0 &&
    value.height > 0 &&
    value.referenceWidth > 0 &&
    value.referenceHeight > 0 &&
    value.x < MAXIMUM_IMAGE_DIMENSION &&
    value.y < MAXIMUM_IMAGE_DIMENSION &&
    value.width <= MAXIMUM_IMAGE_DIMENSION &&
    value.height <= MAXIMUM_IMAGE_DIMENSION &&
    value.referenceWidth <= MAXIMUM_IMAGE_DIMENSION &&
    value.referenceHeight <= MAXIMUM_IMAGE_DIMENSION
  );
}

export function setImageRecognitionTemplateAsset(
  groupId: string,
  assetId: string,
): boolean {
  const context = editingContext();
  const document = useDocumentStore.getState().history?.document;
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const asset = document?.assets.find(
    (candidate) => candidate.assetId === assetId,
  );
  const templateAsset =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, "templateAsset");
  if (
    context === undefined ||
    group?.kind !== "imageRecognition" ||
    asset === undefined ||
    templateAsset?.typeKey !== "core.image.projectAsset"
  ) {
    return false;
  }
  return runComposite("graph.history.setRecognitionTemplate", [
    {
      kind: "setNodeProperty",
      graphId: context.graph.graphId,
      nodeId: templateAsset.nodeId,
      propertyKey: "assetId",
      value: assetId,
    },
  ]);
}

export function setImageRecognitionThreshold(
  groupId: string,
  matchThreshold: number,
): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const recognizer =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, "recognizer");
  if (
    context === undefined ||
    group?.kind !== "imageRecognition" ||
    recognizer?.typeKey !== "vision.templateMatch" ||
    !Number.isFinite(matchThreshold) ||
    matchThreshold < 0 ||
    matchThreshold > 1
  ) {
    return false;
  }
  return runComposite("graph.history.setImageRecognitionThreshold", [
    {
      kind: "setNodeProperty",
      graphId: context.graph.graphId,
      nodeId: recognizer.nodeId,
      propertyKey: "threshold",
      value: matchThreshold,
    },
  ]);
}

export function setImageRecognitionRegion(
  groupId: string,
  value: ImageRecognitionRegionValue,
): boolean {
  if (!validRegion(value)) {
    return false;
  }
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const roi =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, "roi");
  if (
    context === undefined ||
    group?.kind !== "imageRecognition" ||
    roi?.typeKey !== "core.geometry.rectangle"
  ) {
    return false;
  }
  const commands = IMAGE_RECOGNITION_REGION_FIELDS.map(
    (portId): GraphCommand => ({
      kind: "setInputValue",
      graphId: context.graph.graphId,
      nodeId: roi.nodeId,
      portId,
      value: value[portId],
    }),
  );
  return runComposite("graph.history.setRecognitionRegion", commands);
}

export function setImageRecognitionRegionEnabled(
  groupId: string,
  enabled: boolean,
): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const roi =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, "roi");
  const recognizer =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, "recognizer");
  if (
    context === undefined ||
    group?.kind !== "imageRecognition" ||
    roi === undefined ||
    recognizer === undefined
  ) {
    return false;
  }
  const existing = context.graph.edges.find(
    (edge) =>
      edge.sourceNodeId === roi.nodeId &&
      edge.sourcePortId === "rectangle" &&
      edge.targetNodeId === recognizer.nodeId &&
      edge.targetPortId === "roi",
  );
  if (enabled === (existing !== undefined)) {
    return true;
  }
  return runComposite("graph.history.setRecognitionRegionEnabled", [
    enabled
      ? addEdgeCommand(
          context.graph.graphId,
          "data",
          roi.nodeId,
          "rectangle",
          recognizer.nodeId,
          "roi",
        )
      : {
          kind: "removeEdge",
          graphId: context.graph.graphId,
          edgeId: existing?.edgeId ?? "",
        },
  ]);
}

export function focusImageRecognitionRegion(groupId: string): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const roi =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, "roi");
  if (
    context === undefined ||
    group?.kind !== "imageRecognition" ||
    roi?.typeKey !== "core.geometry.rectangle"
  ) {
    return false;
  }
  useEditorSessionStore.getState().setSelection([roi.nodeId], []);
  useCoordinatePickerStore.getState().requestSelection("rectangle", {
    graphId: context.graph.graphId,
    nodeId: roi.nodeId,
    nodeTypeKey: "core.geometry.rectangle",
  });
  return true;
}

export function focusCoordinateNode(graphId: string, nodeId: string): boolean {
  const context = editingContext();
  const node = context?.graph.nodes.find(
    (candidate) => candidate.nodeId === nodeId,
  );
  if (context?.graph.graphId !== graphId || node === undefined) return false;
  const kind =
    node.typeKey === "core.geometry.rectangle" ? "rectangle" : "point";
  if (
    node.typeKey !== "core.geometry.point" &&
    node.typeKey !== "core.geometry.rectangle" &&
    node.typeKey !== "automation.clickPoint"
  ) {
    return false;
  }
  useEditorSessionStore.getState().setSelection([node.nodeId], []);
  useCoordinatePickerStore.getState().requestSelection(kind, {
    graphId,
    nodeId,
    nodeTypeKey: node.typeKey,
  });
  return true;
}

export function setRecognitionDelay(
  groupId: string,
  milliseconds: number,
): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const delay =
    context === undefined || group === undefined
      ? undefined
      : (memberNode(context.graph, group, "delay") ??
        memberNode(context.graph, group, "beforeDelay"));
  if (
    context === undefined ||
    group === undefined ||
    delay?.typeKey !== "core.time.delay" ||
    !Number.isInteger(milliseconds) ||
    milliseconds < 0 ||
    milliseconds > MAXIMUM_TEXT_RECOGNITION_DELAY_MILLISECONDS
  ) {
    return false;
  }
  return runComposite("graph.history.setRecognitionDelay", [
    {
      kind: "setInputValue",
      graphId: context.graph.graphId,
      nodeId: delay.nodeId,
      portId: "durationMilliseconds",
      value: milliseconds,
    },
  ]);
}

export function setTextRecognitionDelay(
  groupId: string,
  phase: "beforeDelay" | "afterDelay",
  milliseconds: number,
): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const delay =
    context === undefined || group === undefined
      ? undefined
      : (memberNode(context.graph, group, phase) ??
        memberNode(context.graph, group, "delay"));
  if (
    context === undefined ||
    delay?.typeKey !== "core.time.delay" ||
    !Number.isInteger(milliseconds) ||
    milliseconds < 0 ||
    milliseconds > MAXIMUM_TEXT_RECOGNITION_DELAY_MILLISECONDS
  ) {
    return false;
  }
  return runComposite("graph.history.setTextRecognitionDelay", [
    {
      kind: "setInputValue",
      graphId: context.graph.graphId,
      nodeId: delay.nodeId,
      portId: "durationMilliseconds",
      value: milliseconds,
    },
  ]);
}

export function setRecognitionDelayMode(
  groupId: string,
  mode: RecognitionDelayMode,
): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  if (context === undefined || group === undefined) return false;
  const delay =
    memberNode(context.graph, group, "delay") ??
    memberNode(context.graph, group, "beforeDelay");
  const capture = memberNode(context.graph, group, "capture");
  const click = memberNode(context.graph, group, "click");
  const success =
    group.kind === "imageRecognition"
      ? (memberNode(context.graph, group, "visibleOcr") ??
        memberNode(context.graph, group, "matchBranch"))
      : memberNode(context.graph, group, "matchBranch");
  const successPort =
    group.kind === "imageRecognition" &&
    group.members.some((member) => member.role === "visibleOcr")
      ? "next"
      : "whenTrue";
  if (
    delay === undefined ||
    capture === undefined ||
    success === undefined ||
    (mode === "beforeClick" && !recognitionClickEnabled(click))
  ) {
    return false;
  }

  const currentRun = group.exposedPorts.find(
    (port) => port.proxyPortId === "run",
  );
  const desiredRun = mode === "beforeRecognition" ? delay : capture;
  const memberIds = new Set(group.members.map((member) => member.nodeId));
  const commands: GraphCommand[] = [];
  for (const edge of context.graph.edges) {
    const isExternalRunEdge =
      currentRun !== undefined &&
      edge.edgeKind === "execution" &&
      edge.targetNodeId === currentRun.nodeId &&
      edge.targetPortId === currentRun.portId &&
      !memberIds.has(edge.sourceNodeId);
    const isInternalTimingEdge =
      edge.edgeKind === "execution" &&
      ((edge.sourceNodeId === delay.nodeId &&
        (edge.targetNodeId === capture.nodeId ||
          edge.targetNodeId === click?.nodeId)) ||
        (edge.sourceNodeId === success.nodeId &&
          (edge.targetNodeId === delay.nodeId ||
            edge.targetNodeId === click?.nodeId)));
    if (!isExternalRunEdge && !isInternalTimingEdge) continue;
    commands.push({
      kind: "removeEdge",
      graphId: context.graph.graphId,
      edgeId: edge.edgeId,
    });
    if (isExternalRunEdge) {
      commands.push({
        kind: "addEdge",
        graphId: context.graph.graphId,
        edge: { ...edge, targetNodeId: desiredRun.nodeId, targetPortId: "run" },
      });
    }
  }

  commands.push(
    mode === "beforeRecognition"
      ? addEdgeCommand(
          context.graph.graphId,
          "execution",
          delay.nodeId,
          "next",
          capture.nodeId,
          "run",
        )
      : addEdgeCommand(
          context.graph.graphId,
          "execution",
          success.nodeId,
          successPort,
          delay.nodeId,
          "run",
        ),
  );
  if (click !== undefined) {
    commands.push(
      mode === "beforeRecognition"
        ? addEdgeCommand(
            context.graph.graphId,
            "execution",
            success.nodeId,
            successPort,
            click.nodeId,
            "run",
          )
        : addEdgeCommand(
            context.graph.graphId,
            "execution",
            delay.nodeId,
            "next",
            click.nodeId,
            "run",
          ),
    );
  }
  commands.push({
    kind: "replaceWorkflowGroup",
    graphId: context.graph.graphId,
    group: {
      ...group,
      exposedPorts: group.exposedPorts.map((port) =>
        port.proxyPortId === "run"
          ? { ...port, nodeId: desiredRun.nodeId, portId: "run" }
          : port,
      ),
    },
  });
  return runComposite("graph.history.setRecognitionDelayMode", commands);
}

export function setTextRecognitionConfidence(
  groupId: string,
  confidenceThreshold: number,
): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const recognizer =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, "recognizer");
  if (
    context === undefined ||
    group?.kind !== "textRecognition" ||
    recognizer?.typeKey !== "vision.ocr" ||
    !Number.isFinite(confidenceThreshold) ||
    confidenceThreshold < 0 ||
    confidenceThreshold > 1
  ) {
    return false;
  }
  return runComposite("graph.history.setTextRecognitionConfidence", [
    {
      kind: "setNodeProperty",
      graphId: context.graph.graphId,
      nodeId: recognizer.nodeId,
      propertyKey: "confidenceThreshold",
      value: confidenceThreshold,
    },
  ]);
}

export function setTextRecognitionRegion(
  groupId: string,
  value: ImageRecognitionRegionValue,
): boolean {
  if (!validRegion(value)) {
    return false;
  }
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const roi =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, "roi");
  if (
    context === undefined ||
    group?.kind !== "textRecognition" ||
    roi?.typeKey !== "core.geometry.rectangle"
  ) {
    return false;
  }
  return runComposite(
    "graph.history.setTextRecognitionRegion",
    IMAGE_RECOGNITION_REGION_FIELDS.map((portId): GraphCommand => ({
      kind: "setInputValue",
      graphId: context.graph.graphId,
      nodeId: roi.nodeId,
      portId,
      value: value[portId],
    })),
  );
}

export function setTextRecognitionRegionEnabled(
  groupId: string,
  enabled: boolean,
): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const roi =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, "roi");
  const recognizer =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, "recognizer");
  if (
    context === undefined ||
    group?.kind !== "textRecognition" ||
    roi === undefined ||
    recognizer === undefined
  ) {
    return false;
  }
  const existing = context.graph.edges.find(
    (edge) =>
      edge.sourceNodeId === roi.nodeId &&
      edge.sourcePortId === "rectangle" &&
      edge.targetNodeId === recognizer.nodeId &&
      edge.targetPortId === "roi",
  );
  if (enabled === (existing !== undefined)) {
    return true;
  }
  return runComposite("graph.history.setTextRecognitionRegionEnabled", [
    enabled
      ? addEdgeCommand(
          context.graph.graphId,
          "data",
          roi.nodeId,
          "rectangle",
          recognizer.nodeId,
          "roi",
        )
      : {
          kind: "removeEdge",
          graphId: context.graph.graphId,
          edgeId: existing?.edgeId ?? "",
        },
  ]);
}

export function setTextRecognitionClickPoint(
  groupId: string,
  value: TextRecognitionPointValue,
): boolean {
  if (
    !Number.isInteger(value.x) ||
    !Number.isInteger(value.y) ||
    !Number.isInteger(value.referenceWidth) ||
    !Number.isInteger(value.referenceHeight) ||
    value.x < 0 ||
    value.y < 0 ||
    value.referenceWidth <= 0 ||
    value.referenceHeight <= 0 ||
    value.x >= MAXIMUM_IMAGE_DIMENSION ||
    value.y >= MAXIMUM_IMAGE_DIMENSION ||
    value.referenceWidth > MAXIMUM_IMAGE_DIMENSION ||
    value.referenceHeight > MAXIMUM_IMAGE_DIMENSION
  ) {
    return false;
  }
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const point =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, "clickPoint");
  if (
    context === undefined ||
    group?.kind !== "textRecognition" ||
    point?.typeKey !== "core.geometry.point"
  ) {
    return false;
  }
  return runComposite(
    "graph.history.setTextRecognitionClickPoint",
    (["x", "y", "referenceWidth", "referenceHeight"] as const).map(
      (portId): GraphCommand => ({
        kind: "setInputValue",
        graphId: context.graph.graphId,
        nodeId: point.nodeId,
        portId,
        value: value[portId],
      }),
    ),
  );
}

export function focusTextRecognitionParameter(
  groupId: string,
  role: "roi" | "clickPoint",
): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const node =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, role);
  const expectedTypeKey =
    role === "clickPoint" ? "core.geometry.point" : "core.geometry.rectangle";
  if (
    context === undefined ||
    group?.kind !== "textRecognition" ||
    node?.typeKey !== expectedTypeKey
  ) {
    return false;
  }
  useEditorSessionStore.getState().setSelection([node.nodeId], []);
  useCoordinatePickerStore
    .getState()
    .requestSelection(role === "clickPoint" ? "point" : "rectangle", {
      graphId: context.graph.graphId,
      nodeId: node.nodeId,
      nodeTypeKey: expectedTypeKey,
    });
  return true;
}

export function revealWorkflowGroupParameter(
  groupId: string,
  role:
    | "templateAsset"
    | "roi"
    | "clickPoint"
    | "beforeDelay"
    | "afterDelay"
    | "delay"
    | "recognizer",
): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  const node =
    context === undefined || group === undefined
      ? undefined
      : memberNode(context.graph, group, role);
  const allowed =
    (group?.kind === "imageRecognition" &&
      (role === "templateAsset" || role === "roi")) ||
    (group?.kind === "textRecognition" &&
      (role === "roi" ||
        role === "clickPoint" ||
        role === "delay" ||
        role === "beforeDelay" ||
        role === "afterDelay" ||
        role === "recognizer")) ||
    (group?.kind === "imageRecognition" && role === "delay");
  if (!allowed || node === undefined) {
    return false;
  }
  const expanded = setWorkflowGroupCollapsed(groupId, false);
  if (expanded) {
    useEditorSessionStore.getState().setSelection([node.nodeId], []);
  }
  return expanded;
}

function executionOutput(typeKey: string): string {
  return typeKey === "core.flow.sequence" ? "steps" : "next";
}

function edgeExists(
  graph: GraphV1,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): boolean {
  return graph.edges.some(
    (edge) =>
      edge.sourceNodeId === sourceNodeId &&
      edge.sourcePortId === sourcePortId &&
      edge.targetNodeId === targetNodeId &&
      edge.targetPortId === targetPortId,
  );
}

function addEdgeCommand(
  graphId: string,
  edgeKind: EdgeV1["edgeKind"],
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): GraphCommand {
  return {
    kind: "addEdge",
    graphId,
    edge: {
      edgeId: createIdentifier(),
      edgeKind,
      sourceNodeId,
      sourcePortId,
      targetNodeId,
      targetPortId,
    },
  };
}

export function setTextRecognitionClickMethod(
  groupId: string,
  method: TextRecognitionClickMethod,
): boolean {
  return setRecognitionClickMethod(groupId, method);
}

export function setRecognitionClickMethod(
  groupId: string,
  method: RecognitionClickMethod,
): boolean {
  const context = editingContext();
  const group =
    context === undefined ? undefined : groupById(context.graph, groupId);
  if (context === undefined || group === undefined) {
    return false;
  }
  if (group.kind === "imageRecognition" && method === "point") {
    return false;
  }
  const click = memberNode(context.graph, group, "click");
  const branch = memberNode(context.graph, group, "matchBranch");
  const recognizer = memberNode(context.graph, group, "recognizer");
  const afterDelay = memberNode(context.graph, group, "afterDelay");
  const clickPoint = memberNode(context.graph, group, "clickPoint");
  const definition = context.definitions.get(TEXT_CLICK_TYPES[method]);
  if (
    click === undefined ||
    branch === undefined ||
    recognizer === undefined ||
    definition === undefined
  ) {
    return false;
  }
  if (click.typeKey === definition.typeKey) {
    return true;
  }

  const removedEdges = new Map(
    invalidIncidentEdges(context.graph, click.nodeId, definition).map(
      (edge) => [edge.edgeId, edge],
    ),
  );
  for (const edge of context.graph.edges) {
    if (
      edge.sourceNodeId === click.nodeId &&
      edge.edgeKind === "execution" &&
      edge.targetNodeId === afterDelay?.nodeId &&
      edge.sourcePortId !== executionOutput(definition.typeKey)
    ) {
      removedEdges.set(edge.edgeId, edge);
    }
    if (
      edge.targetNodeId === click.nodeId &&
      edge.edgeKind === "data" &&
      method !== "rectCenter"
    ) {
      removedEdges.set(edge.edgeId, edge);
    }
  }

  const commands: GraphCommand[] = [...removedEdges.values()].map((edge) => ({
    kind: "removeEdge",
    graphId: context.graph.graphId,
    edgeId: edge.edgeId,
  }));
  commands.push({
    kind: "replaceNode",
    graphId: context.graph.graphId,
    node: replacementNode(click, definition),
  });

  if (
    !context.graph.edges.some(
      (edge) =>
        edge.edgeKind === "execution" &&
        edge.targetNodeId === click.nodeId &&
        edge.targetPortId === "run",
    )
  ) {
    commands.push(
      addEdgeCommand(
        context.graph.graphId,
        "execution",
        branch.nodeId,
        "whenTrue",
        click.nodeId,
        "run",
      ),
    );
  }
  const nextPort = executionOutput(definition.typeKey);
  if (
    afterDelay !== undefined &&
    !edgeExists(context.graph, click.nodeId, nextPort, afterDelay.nodeId, "run")
  ) {
    commands.push(
      addEdgeCommand(
        context.graph.graphId,
        "execution",
        click.nodeId,
        nextPort,
        afterDelay.nodeId,
        "run",
      ),
    );
  }
  if (
    method === "rectCenter" &&
    !edgeExists(
      context.graph,
      recognizer.nodeId,
      "bestRect",
      click.nodeId,
      "rect",
    )
  ) {
    commands.push(
      addEdgeCommand(
        context.graph.graphId,
        "data",
        recognizer.nodeId,
        "bestRect",
        click.nodeId,
        "rect",
      ),
    );
  }

  if (
    method === "point" &&
    clickPoint !== undefined &&
    !edgeExists(
      context.graph,
      clickPoint.nodeId,
      "point",
      click.nodeId,
      "point",
    )
  ) {
    commands.push(
      addEdgeCommand(
        context.graph.graphId,
        "data",
        clickPoint.nodeId,
        "point",
        click.nodeId,
        "point",
      ),
    );
  }

  const exposedPorts = group.exposedPorts.filter(
    (port) => port.nodeId !== click.nodeId,
  );
  if (method === "point" && clickPoint === undefined) {
    exposedPorts.splice(3, 0, {
      proxyPortId: "clickPoint",
      nodeId: click.nodeId,
      portId: "point",
      labelKey: "workflowGroup.textRecognition.port.clickPoint",
    });
  }
  commands.push({
    kind: "replaceWorkflowGroup",
    graphId: context.graph.graphId,
    group: { ...group, exposedPorts },
  });
  return runComposite("graph.history.setClickMethod", commands);
}

type PromotedInputKind = "number" | "string" | "point" | "rect";

const PROMOTION_NODE: Record<
  PromotedInputKind,
  { typeKey: string; outputPortId: string }
> = {
  number: { typeKey: "core.value.numberLiteral", outputPortId: "value" },
  string: { typeKey: "core.value.stringLiteral", outputPortId: "value" },
  point: { typeKey: "core.geometry.point", outputPortId: "point" },
  rect: { typeKey: "core.geometry.rectangle", outputPortId: "rectangle" },
};

export function promoteInputToNode(
  nodeId: string,
  portId: string,
  kind: PromotedInputKind,
): boolean {
  const context = editingContext();
  const target = context?.graph.nodes.find((node) => node.nodeId === nodeId);
  const promotion = PROMOTION_NODE[kind];
  const definition = context?.definitions.get(promotion.typeKey);
  if (
    context === undefined ||
    target === undefined ||
    definition === undefined
  ) {
    return false;
  }
  if (
    context.graph.edges.some(
      (edge) => edge.targetNodeId === nodeId && edge.targetPortId === portId,
    )
  ) {
    return false;
  }

  const promotedNodeId = createIdentifier();
  const literal = target.inputValues[portId];
  const properties = { ...(definition.propertyDefaults ?? {}) };
  if (
    (kind === "number" && typeof literal === "number") ||
    (kind === "string" && typeof literal === "string")
  ) {
    properties["value"] = literal;
  }
  const promotedNode: NodeV1 = {
    nodeId: promotedNodeId,
    typeKey: definition.typeKey,
    typeVersion: definition.typeVersion,
    position: { x: target.position.x - 280, y: target.position.y + 48 },
    properties,
    inputValues: {},
  };
  const commands: GraphCommand[] = [
    { kind: "addNode", graphId: context.graph.graphId, node: promotedNode },
  ];
  if (Object.hasOwn(target.inputValues, portId)) {
    commands.push({
      kind: "setInputValue",
      graphId: context.graph.graphId,
      nodeId,
      portId,
    });
  }

  const owningGroup = context.graph.editorMetadata?.workflowGroups?.find(
    (group) => group.members.some((member) => member.nodeId === nodeId),
  );
  const capture =
    owningGroup === undefined
      ? undefined
      : memberNode(context.graph, owningGroup, "capture");
  if ((kind === "point" || kind === "rect") && capture !== undefined) {
    commands.push(
      addEdgeCommand(
        context.graph.graphId,
        "data",
        capture.nodeId,
        "image",
        promotedNodeId,
        "image",
      ),
    );
  }
  commands.push(
    addEdgeCommand(
      context.graph.graphId,
      "data",
      promotedNodeId,
      promotion.outputPortId,
      nodeId,
      portId,
    ),
  );
  return runComposite("graph.history.promoteInput", commands);
}
