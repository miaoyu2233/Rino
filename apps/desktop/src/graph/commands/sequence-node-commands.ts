import type { GraphV1 } from "@rino/contracts";

import {
  MAXIMUM_SEQUENCE_STEP_COUNT,
  moveSequenceOrder,
  naturalSequenceOrder,
  sequenceOrderForCount,
  type SequenceMoveDirection,
  sequenceStepCount,
  withSequenceOrder,
  withSequenceStepCount,
} from "../sequence-node";
import { useDocumentStore } from "../store/document-store";
import type { CompositeCommand, GraphCommand } from "./graph-commands";

export type AddSequenceStepFailure =
  "graphMissing" | "nodeMissing" | "nodeTypeMismatch" | "stepLimitReached";

export type AddSequenceStepResult =
  | { ok: true; command: CompositeCommand; stepCount: number }
  | { ok: false; reason: AddSequenceStepFailure };

export function buildAddSequenceStepCommand(
  graph: GraphV1,
  nodeId: string,
): AddSequenceStepResult {
  const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (node === undefined) {
    return { ok: false, reason: "nodeMissing" };
  }
  if (
    node.typeKey !== "core.flow.sequence" &&
    node.typeKey !== "core.flow.sequenceOrder"
  ) {
    return { ok: false, reason: "nodeTypeMismatch" };
  }
  const legacyEdges = graph.edges.filter(
    (edge) =>
      edge.sourceNodeId === node.nodeId && edge.sourcePortId === "steps",
  );
  const currentCount =
    sequenceStepCount(node) ?? Math.max(1, legacyEdges.length);
  if (currentCount >= MAXIMUM_SEQUENCE_STEP_COUNT) {
    return { ok: false, reason: "stepLimitReached" };
  }
  const nextCount = currentCount + 1;
  const commands: GraphCommand[] = [
    {
      kind: "replaceNode",
      graphId: graph.graphId,
      node: withSequenceStepCount(node, nextCount),
    },
  ];
  for (const [index, edge] of legacyEdges.entries()) {
    commands.push(
      { kind: "removeEdge", graphId: graph.graphId, edgeId: edge.edgeId },
      {
        kind: "addEdge",
        graphId: graph.graphId,
        edge: { ...edge, sourcePortId: `step${String(index + 1)}` },
      },
    );
  }
  return {
    ok: true,
    command: { kind: "composite", label: "addSequenceStep", commands },
    stepCount: nextCount,
  };
}

export type MoveSequenceStepFailure =
  | "graphMissing"
  | "nodeMissing"
  | "nodeTypeMismatch"
  | "stepMissing"
  | "boundary"
  | "orderInvalid";

export type MoveSequenceStepResult =
  | { ok: true; command: CompositeCommand; order: readonly string[] }
  | { ok: false; reason: MoveSequenceStepFailure };

export function buildMoveSequenceStepCommand(
  graph: GraphV1,
  nodeId: string,
  stepId: string,
  direction: SequenceMoveDirection,
): MoveSequenceStepResult {
  const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (node === undefined) {
    return { ok: false, reason: "nodeMissing" };
  }
  if (
    node.typeKey !== "core.flow.sequence" &&
    node.typeKey !== "core.flow.sequenceOrder"
  ) {
    return { ok: false, reason: "nodeTypeMismatch" };
  }
  const legacyEdges =
    node.typeKey === "core.flow.sequence" &&
    sequenceStepCount(node) === undefined
      ? graph.edges
          .map((edge, edgeIndex) => ({ edge, edgeIndex }))
          .filter(
            ({ edge }) =>
              edge.sourceNodeId === node.nodeId &&
              edge.sourcePortId === "steps",
          )
      : [];
  const count =
    sequenceStepCount(node) ??
    (legacyEdges.length > 0 ? legacyEdges.length : 0);
  const order =
    count > 0
      ? sequenceOrderForCount(node, count)
      : naturalSequenceOrder(
          node.typeKey === "core.flow.sequenceOrder" ? 2 : 0,
        );
  if (!order.includes(stepId)) {
    return { ok: false, reason: "stepMissing" };
  }
  const nextOrder = moveSequenceOrder(order, stepId, direction);
  if (nextOrder === undefined) {
    return { ok: false, reason: "boundary" };
  }
  const nextNode = withSequenceOrder(node, nextOrder);
  if (nextNode === node) {
    return { ok: false, reason: "orderInvalid" };
  }
  const commands: GraphCommand[] = [
    {
      kind: "replaceNode",
      graphId: graph.graphId,
      node: nextNode,
    },
  ];
  for (const [index, { edge, edgeIndex }] of legacyEdges.entries()) {
    commands.push(
      { kind: "removeEdge", graphId: graph.graphId, edgeId: edge.edgeId },
      {
        kind: "addEdge",
        graphId: graph.graphId,
        edge: { ...edge, sourcePortId: `step${String(index + 1)}` },
        index: edgeIndex,
      },
    );
  }
  return {
    ok: true,
    command: {
      kind: "composite",
      label: "moveSequenceStep",
      commands,
    },
    order: nextOrder,
  };
}

export function moveSequenceStep(
  graphId: string,
  nodeId: string,
  stepId: string,
  direction: SequenceMoveDirection,
): boolean {
  const documentStore = useDocumentStore.getState();
  const graph = documentStore.history?.document.graphs.find(
    (candidate) => candidate.graphId === graphId,
  );
  if (graph === undefined) {
    return false;
  }
  const result = buildMoveSequenceStepCommand(graph, nodeId, stepId, direction);
  return (
    result.ok &&
    documentStore.runCommand("graph.history.moveSequenceStep", result.command)
      .ok
  );
}

export function addSequenceStep(graphId: string, nodeId: string): boolean {
  const documentStore = useDocumentStore.getState();
  const graph = documentStore.history?.document.graphs.find(
    (candidate) => candidate.graphId === graphId,
  );
  if (graph === undefined) {
    return false;
  }
  const result = buildAddSequenceStepCommand(graph, nodeId);
  return (
    result.ok &&
    documentStore.runCommand("graph.history.addSequenceStep", result.command).ok
  );
}
