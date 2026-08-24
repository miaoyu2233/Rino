import type {
  GraphV1,
  WorkflowGroupV1,
  WorkflowGroupPortV1,
} from "@rino/contracts";

const WORKFLOW_GROUP_NODE_PREFIX = "workflow-group:";

export function workflowGroups(graph: GraphV1): readonly WorkflowGroupV1[] {
  return graph.editorMetadata?.workflowGroups ?? [];
}

export function workflowGroupNodeId(groupId: string): string {
  return `${WORKFLOW_GROUP_NODE_PREFIX}${groupId}`;
}

export function workflowGroupIdFromNodeId(nodeId: string): string | undefined {
  return nodeId.startsWith(WORKFLOW_GROUP_NODE_PREFIX)
    ? nodeId.slice(WORKFLOW_GROUP_NODE_PREFIX.length)
    : undefined;
}

export function workflowGroupMemberIds(group: WorkflowGroupV1): Set<string> {
  return new Set(group.members.map((member) => member.nodeId));
}

export function collapsedWorkflowGroupByMember(
  graph: GraphV1,
): Map<string, WorkflowGroupV1> {
  const groups = new Map<string, WorkflowGroupV1>();
  for (const group of workflowGroups(graph)) {
    if (!group.collapsed) {
      continue;
    }
    for (const member of group.members) {
      groups.set(member.nodeId, group);
    }
  }
  return groups;
}

export function workflowGroupOrigin(
  graph: GraphV1,
  group: WorkflowGroupV1,
): { x: number; y: number } {
  const memberIds = workflowGroupMemberIds(group);
  const positions = graph.nodes
    .filter((node) => memberIds.has(node.nodeId))
    .map((node) => node.position);
  if (positions.length === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.min(...positions.map((position) => position.x)),
    y: Math.min(...positions.map((position) => position.y)),
  };
}

function derivedProxyPortId(
  group: WorkflowGroupV1,
  nodeId: string,
  portId: string,
) {
  const role =
    group.members.find((member) => member.nodeId === nodeId)?.role ?? "member";
  return `${role}:${portId}`;
}

export function groupPortForDomainEndpoint(
  group: WorkflowGroupV1,
  nodeId: string,
  portId: string,
): WorkflowGroupPortV1 {
  return (
    group.exposedPorts.find(
      (port) => port.nodeId === nodeId && port.portId === portId,
    ) ?? {
      proxyPortId: derivedProxyPortId(group, nodeId, portId),
      nodeId,
      portId,
      labelKey: "graph.port.groupBoundary",
    }
  );
}

export function resolveWorkflowGroupEndpoint(
  graph: GraphV1,
  nodeId: string,
  proxyPortId: string,
): { nodeId: string; portId: string } | undefined {
  const groupId = workflowGroupIdFromNodeId(nodeId);
  if (groupId === undefined) {
    return { nodeId, portId: proxyPortId };
  }
  const group = workflowGroups(graph).find(
    (candidate) => candidate.groupId === groupId && candidate.collapsed,
  );
  const port = group?.exposedPorts.find(
    (candidate) => candidate.proxyPortId === proxyPortId,
  );
  if (port !== undefined) {
    return { nodeId: port.nodeId, portId: port.portId };
  }
  const separator = proxyPortId.indexOf(":");
  if (separator < 1 || group === undefined) {
    return undefined;
  }
  const role = proxyPortId.slice(0, separator);
  const portId = proxyPortId.slice(separator + 1);
  const member = group.members.find((candidate) => candidate.role === role);
  return member === undefined || portId.length === 0
    ? undefined
    : { nodeId: member.nodeId, portId };
}
