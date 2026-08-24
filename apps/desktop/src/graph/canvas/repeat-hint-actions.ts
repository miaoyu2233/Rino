import type {
  EditorPositionV1,
  GraphV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";

import { createIdentifier } from "../../platform/identifiers";
import type { LocalizationKey } from "../../diagnostics/diagnostic-model";
import { useDocumentStore } from "../store/document-store";
import { useRegistryStore } from "../registry/registry-store";
import {
  GraphConnectionIndex,
  type ConnectionCandidate,
  type ConnectionEvaluation,
} from "../connection-rules";
import { NodeRegistryIndex } from "../node-registry-index";
import { isAssignable } from "../type-compatibility";
import {
  canonicalExecutionInput,
  type ExecutionInputEndpoint,
} from "./smart-connection";
import { workflowGroupIdFromNodeId, workflowGroups } from "../workflow-groups";
import {
  NODE_HEADER_HEIGHT,
  NODE_WIDTH,
  type RinoFlowNode,
} from "./graph-view-model";
import type {
  CompositeCommand,
  GraphCommand,
} from "../commands/graph-commands";

const RECOGNITION_NODE_TYPES = new Set([
  "vision.ocr",
  "vision.templateMatch",
  "vision.featureMatch",
  "vision.colorMatch",
]);

export function isRepeatHintFailurePort(
  visualPortId: string,
  domainPortId: string,
): boolean {
  return [visualPortId, domainPortId].some(
    (portId) =>
      portId === "noMatch" ||
      portId === "notReached" ||
      portId === "unmatched" ||
      portId.endsWith(":noMatch") ||
      portId.endsWith(":notReached") ||
      portId.endsWith(":unmatched"),
  );
}

export interface RepeatHintSourceEndpoint {
  nodeId: string;
  portId: string;
}

export interface RepeatHintTarget {
  /** The visual node used for the recommendation and its stable canvas identity. */
  visualNodeId: string;
  stableId: string;
  target: ExecutionInputEndpoint;
  titleKey: LocalizationKey;
}

export interface RepeatHintQuickAddAction {
  graphId: string;
  source: RepeatHintSourceEndpoint;
  position: EditorPositionV1;
  target: RepeatHintTarget | undefined;
}

export type RepeatHintCommandResult =
  | { ok: true; command: CompositeCommand; edgeId: string; hintId: string }
  | {
      ok: false;
      reason:
        | "graphMissing"
        | "sourceMissing"
        | "targetMissing"
        | "notExecution"
        | "connectionRejected";
      evaluation?: ConnectionEvaluation;
    };

function validExecutionEdge(
  graph: GraphV1,
  registry: NodeRegistryIndex,
  edge: GraphV1["edges"][number],
): boolean {
  if (edge.edgeKind !== "execution") {
    return false;
  }
  const sourceNode = graph.nodes.find(
    (candidate) => candidate.nodeId === edge.sourceNodeId,
  );
  const targetNode = graph.nodes.find(
    (candidate) => candidate.nodeId === edge.targetNodeId,
  );
  const sourcePort = sourceNode
    ? registry.find(sourceNode.typeKey)?.ports.get(edge.sourcePortId)
    : undefined;
  const targetPort = targetNode
    ? registry.find(targetNode.typeKey)?.ports.get(edge.targetPortId)
    : undefined;
  return (
    sourceNode !== undefined &&
    targetNode !== undefined &&
    sourcePort?.direction === "output" &&
    sourcePort.portKind === "execution" &&
    targetPort?.direction === "input" &&
    targetPort.portKind === "execution" &&
    isAssignable(sourcePort.type, targetPort.type)
  );
}

function reachesSource(
  graph: GraphV1,
  registry: NodeRegistryIndex,
  startNodeId: string,
  sourceNodeId: string,
): boolean {
  if (startNodeId === sourceNodeId) {
    return true;
  }
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!validExecutionEdge(graph, registry, edge)) {
      continue;
    }
    const targets = adjacency.get(edge.sourceNodeId);
    if (targets === undefined) {
      adjacency.set(edge.sourceNodeId, [edge.targetNodeId]);
    } else {
      targets.push(edge.targetNodeId);
    }
  }
  const pending = [startNodeId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.shift();
    if (nodeId === undefined || visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    for (const targetNodeId of adjacency.get(nodeId) ?? []) {
      if (targetNodeId === sourceNodeId) {
        return true;
      }
      pending.push(targetNodeId);
    }
  }
  return false;
}

function isRecognitionTarget(
  graph: GraphV1,
  visualNode: RinoFlowNode,
): boolean {
  const groupId = workflowGroupIdFromNodeId(visualNode.id);
  if (groupId !== undefined) {
    return workflowGroups(graph).some(
      (group) => group.groupId === groupId && group.collapsed,
    );
  }
  const node = graph.nodes.find(
    (candidate) => candidate.nodeId === visualNode.id,
  );
  if (node === undefined || !RECOGNITION_NODE_TYPES.has(node.typeKey)) {
    return false;
  }
  // A member is represented by its workflow group while the group is collapsed. During
  // an expanded edit its internal nodes remain visible, but they are not independent
  // recognition entry points for a repeat hint.
  return !workflowGroups(graph).some((group) =>
    group.members.some((member) => member.nodeId === node.nodeId),
  );
}

function candidateStableId(
  graph: GraphV1,
  visualNode: RinoFlowNode,
): string | undefined {
  const groupId = workflowGroupIdFromNodeId(visualNode.id);
  if (groupId !== undefined) {
    return workflowGroups(graph).some((group) => group.groupId === groupId)
      ? groupId
      : undefined;
  }
  return graph.nodes.some((node) => node.nodeId === visualNode.id)
    ? visualNode.id
    : undefined;
}

function candidateCenter(visualNode: RinoFlowNode): { x: number; y: number } {
  const width =
    visualNode.measured?.width ??
    visualNode.width ??
    (visualNode.data.workflowGroup === undefined ? NODE_WIDTH : 300);
  const height =
    visualNode.measured?.height ?? visualNode.height ?? NODE_HEADER_HEIGHT;
  return {
    x: visualNode.position.x + width / 2,
    y: visualNode.position.y + height / 2,
  };
}

/** Finds the nearest visible recognition entry that already precedes the source. */
export function recommendRepeatHintTarget(
  graph: GraphV1,
  registry: RinoNodeRegistrySnapshotV1,
  source: RepeatHintSourceEndpoint,
  position: EditorPositionV1,
  visibleNodes: readonly RinoFlowNode[],
): RepeatHintTarget | undefined {
  const index = new NodeRegistryIndex(registry);
  const sourceGroup = workflowGroups(graph).find((group) =>
    group.members.some((member) => member.nodeId === source.nodeId),
  );
  const candidates: (RepeatHintTarget & { distance: number })[] = [];
  for (const visualNode of visibleNodes) {
    if (!isRecognitionTarget(graph, visualNode)) {
      continue;
    }
    const stableId = candidateStableId(graph, visualNode);
    if (stableId === undefined) {
      continue;
    }
    if (sourceGroup?.groupId === stableId) {
      continue;
    }
    const target = canonicalExecutionInput(graph, registry, visualNode.id);
    if (target?.portId !== "run") {
      continue;
    }
    if (
      target.nodeId === source.nodeId ||
      !reachesSource(graph, index, target.nodeId, source.nodeId)
    ) {
      continue;
    }
    const center = candidateCenter(visualNode);
    const distance =
      (center.x - position.x) ** 2 + (center.y - position.y) ** 2;
    candidates.push({
      visualNodeId: visualNode.id,
      stableId,
      target,
      titleKey: visualNode.data.titleKey as LocalizationKey,
      distance,
    });
  }
  candidates.sort(
    (left, right) =>
      left.distance - right.distance ||
      (left.stableId < right.stableId
        ? -1
        : left.stableId > right.stableId
          ? 1
          : 0),
  );
  const selected = candidates[0];
  if (selected === undefined) {
    return undefined;
  }
  return {
    visualNodeId: selected.visualNodeId,
    stableId: selected.stableId,
    target: selected.target,
    titleKey: selected.titleKey,
  };
}

/** Builds the one history entry used by the repeat editor action. */
export function buildRepeatHintCommand(
  graph: GraphV1,
  registry: RinoNodeRegistrySnapshotV1,
  action: RepeatHintQuickAddAction,
  createIdentifier: () => string,
): RepeatHintCommandResult {
  if (graph.graphId !== action.graphId) {
    return { ok: false, reason: "graphMissing" };
  }
  const sourceNode = graph.nodes.find(
    (node) => node.nodeId === action.source.nodeId,
  );
  const targetNode = graph.nodes.find(
    (node) => node.nodeId === action.target?.target.nodeId,
  );
  if (sourceNode === undefined) {
    return { ok: false, reason: "sourceMissing" };
  }
  if (targetNode === undefined || action.target === undefined) {
    return { ok: false, reason: "targetMissing" };
  }

  const candidate: ConnectionCandidate = {
    sourceNodeId: action.source.nodeId,
    sourcePortId: action.source.portId,
    targetNodeId: action.target.target.nodeId,
    targetPortId: action.target.target.portId,
  };
  const evaluation = new GraphConnectionIndex(graph, registry).evaluate(
    candidate,
  );
  if (!evaluation.accepted) {
    return { ok: false, reason: "connectionRejected", evaluation };
  }
  if (evaluation.edgeKind !== "execution") {
    return { ok: false, reason: "notExecution", evaluation };
  }

  const edgeId = createIdentifier();
  const hintId = createIdentifier();
  const commands: GraphCommand[] = evaluation.replaces.map(
    (replacedEdgeId) => ({
      kind: "removeEdge",
      graphId: graph.graphId,
      edgeId: replacedEdgeId,
    }),
  );
  commands.push(
    {
      kind: "addEdge",
      graphId: graph.graphId,
      edge: {
        edgeId,
        edgeKind: "execution",
        sourceNodeId: candidate.sourceNodeId,
        sourcePortId: candidate.sourcePortId,
        targetNodeId: candidate.targetNodeId,
        targetPortId: candidate.targetPortId,
      },
    },
    {
      kind: "addRepeatHint",
      graphId: graph.graphId,
      hint: { hintId, edgeId, position: action.position },
    },
  );
  return {
    ok: true,
    command: { kind: "composite", label: "repeatHint", commands },
    edgeId,
    hintId,
  };
}

/** Applies a Quick Add repeat action against the current document, revalidating its
 * recommendation because the graph may have changed while the picker was open. */
export function applyRepeatHintAction(
  action: RepeatHintQuickAddAction,
): boolean {
  const document = useDocumentStore.getState().history?.document;
  const registry = useRegistryStore.getState().snapshot;
  const graph = document?.graphs.find(
    (candidate) => candidate.graphId === action.graphId,
  );
  if (
    graph === undefined ||
    registry === undefined ||
    action.target === undefined
  ) {
    return false;
  }
  const result = buildRepeatHintCommand(
    graph,
    registry,
    action,
    createIdentifier,
  );
  if (!result.ok) {
    return false;
  }
  return useDocumentStore
    .getState()
    .runCommand("graph.history.addRepeatHint", result.command).ok;
}
