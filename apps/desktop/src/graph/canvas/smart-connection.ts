import type { GraphV1, RinoNodeRegistrySnapshotV1 } from "@rino/contracts";

import { NodeRegistryIndex } from "../node-registry-index";
import { resolveWorkflowGroupEndpoint } from "../workflow-groups";

export interface ExecutionInputEndpoint {
  nodeId: string;
  portId: string;
}

export function canonicalExecutionInput(
  graph: GraphV1,
  registry: RinoNodeRegistrySnapshotV1,
  visualNodeId: string,
): ExecutionInputEndpoint | undefined {
  const index = new NodeRegistryIndex(registry);
  const groupEndpoint = resolveWorkflowGroupEndpoint(
    graph,
    visualNodeId,
    "run",
  );
  if (groupEndpoint !== undefined) {
    const groupNode = graph.nodes.find(
      (node) => node.nodeId === groupEndpoint.nodeId,
    );
    const groupPort = groupNode
      ? index.find(groupNode.typeKey)?.ports.get(groupEndpoint.portId)
      : undefined;
    if (
      groupPort?.portKind === "execution" &&
      groupPort.direction === "input"
    ) {
      return groupEndpoint;
    }
  }

  const node = graph.nodes.find(
    (candidate) => candidate.nodeId === visualNodeId,
  );
  if (node === undefined) {
    return undefined;
  }
  const inputs = [...(index.find(node.typeKey)?.ports.values() ?? [])].filter(
    (candidate) =>
      candidate.portKind === "execution" && candidate.direction === "input",
  );
  const input = inputs.length === 1 ? inputs[0] : undefined;
  return input === undefined
    ? undefined
    : { nodeId: node.nodeId, portId: input.portId };
}
