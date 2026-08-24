import type { GraphV1, NodeV1 } from "@rino/contracts";

import {
  MAXIMUM_COLLECTION_ITEM_COUNT,
  MAXIMUM_NUMERIC_INPUT_COUNT,
  MAXIMUM_PARALLEL_BRANCH_COUNT,
  collectionItemCount,
  numericInputCount,
  parallelBranchCount,
  withDynamicPortCount,
} from "../sequence-node";
import { useDocumentStore } from "../store/document-store";
import type { CompositeCommand, GraphCommand } from "./graph-commands";

const NUMERIC_INPUT_PORT_IDS = "abcdefghijklmnop";

type DynamicPortKind = "parallelBranch" | "numericInput" | "collectionItem";

interface DynamicPortState {
  kind: DynamicPortKind;
  count: number;
  minimum: number;
  portId: string;
}

function dynamicPortState(node: NodeV1): DynamicPortState | undefined {
  const parallelCount = parallelBranchCount(node);
  if (parallelCount !== undefined) {
    return {
      kind: "parallelBranch",
      count: parallelCount,
      minimum: 2,
      portId: `branch${String(parallelCount)}`,
    };
  }
  const numericCount = numericInputCount(node);
  if (numericCount !== undefined) {
    return {
      kind: "numericInput",
      count: numericCount,
      minimum: 2,
      portId: NUMERIC_INPUT_PORT_IDS[numericCount - 1] ?? "",
    };
  }
  const collectionCount = collectionItemCount(node);
  if (collectionCount !== undefined) {
    return {
      kind: "collectionItem",
      count: collectionCount,
      minimum: 1,
      portId: `item${String(collectionCount)}`,
    };
  }

  // Legacy nodes can omit dynamicPortState while the projection still exposes the
  // documented default number of collection items. Treat that state as authored at the
  // default so the last collection item can still be removed safely.
  if (
    node.typeKey === "core.collection.imageList" ||
    node.typeKey === "core.collection.regionList" ||
    node.typeKey === "core.collection.pointList"
  ) {
    return { kind: "collectionItem", count: 2, minimum: 1, portId: "item2" };
  }
  return undefined;
}

export type RemoveDynamicPortFailure =
  "nodeMissing" | "nodeTypeMismatch" | "minimumCount";

export type RemoveDynamicPortResult =
  | {
      ok: true;
      command: CompositeCommand;
      count: number;
      portId: string;
    }
  | { ok: false; reason: RemoveDynamicPortFailure };

export function buildRemoveDynamicPortCommand(
  graph: GraphV1,
  nodeId: string,
): RemoveDynamicPortResult {
  const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (node === undefined) {
    return { ok: false, reason: "nodeMissing" };
  }
  const state = dynamicPortState(node);
  if (state === undefined) {
    return { ok: false, reason: "nodeTypeMismatch" };
  }
  if (state.count <= state.minimum || state.portId.length === 0) {
    return { ok: false, reason: "minimumCount" };
  }

  const inputValues = Object.entries(node.inputValues).reduce<
    NodeV1["inputValues"]
  >((remaining, [portId, value]) => {
    if (portId !== state.portId) {
      remaining[portId] = value;
    }
    return remaining;
  }, {});
  const nextNode = withDynamicPortCount(
    { ...node, inputValues },
    state.count - 1,
  );
  const commands: GraphCommand[] = [
    { kind: "replaceNode", graphId: graph.graphId, node: nextNode },
    ...graph.edges
      .filter(
        (edge) =>
          (edge.sourceNodeId === nodeId &&
            edge.sourcePortId === state.portId) ||
          (edge.targetNodeId === nodeId && edge.targetPortId === state.portId),
      )
      .map((edge) => ({
        kind: "removeEdge" as const,
        graphId: graph.graphId,
        edgeId: edge.edgeId,
      })),
  ];
  return {
    ok: true,
    command: { kind: "composite", label: "removeDynamicPort", commands },
    count: state.count - 1,
    portId: state.portId,
  };
}

export function addDynamicPort(graphId: string, nodeId: string): boolean {
  const documentStore = useDocumentStore.getState();
  const graph = documentStore.history?.document.graphs.find(
    (candidate) => candidate.graphId === graphId,
  );
  return graph === undefined
    ? false
    : applyDynamicPortCount(documentStore, graph, nodeId);
}

export function removeDynamicPort(graphId: string, nodeId: string): boolean {
  const documentStore = useDocumentStore.getState();
  const graph = documentStore.history?.document.graphs.find(
    (candidate) => candidate.graphId === graphId,
  );
  if (graph === undefined) {
    return false;
  }
  const result = buildRemoveDynamicPortCommand(graph, nodeId);
  return (
    result.ok &&
    documentStore.runCommand("graph.history.removeDynamicPort", result.command)
      .ok
  );
}

function applyDynamicPortCount(
  documentStore: ReturnType<typeof useDocumentStore.getState>,
  graph: GraphV1,
  nodeId: string,
): boolean {
  const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (node === undefined) {
    return false;
  }
  const current = parallelBranchCount(node) ?? numericInputCount(node);
  const effectiveCurrent = current ?? collectionItemCount(node);
  const maximum =
    node.typeKey === "core.flow.parallel"
      ? MAXIMUM_PARALLEL_BRANCH_COUNT
      : node.typeKey === "core.collection.imageList" ||
          node.typeKey === "core.collection.regionList" ||
          node.typeKey === "core.collection.pointList"
        ? MAXIMUM_COLLECTION_ITEM_COUNT
        : MAXIMUM_NUMERIC_INPUT_COUNT;
  if (effectiveCurrent === undefined || effectiveCurrent >= maximum) {
    return false;
  }
  return documentStore.runCommand("graph.history.addDynamicPort", {
    kind: "replaceNode",
    graphId: graph.graphId,
    node: withDynamicPortCount(node, effectiveCurrent + 1),
  }).ok;
}
