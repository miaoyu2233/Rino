import type {
  EdgeV1,
  EditorPositionV1,
  GraphV1,
  NodeV1,
  RepeatHintV1,
  RinoNodeRegistrySnapshotV1,
  WorkflowGroupV1,
  WorkflowTemplateV1,
} from "@rino/contracts";

import type {
  ConnectionCandidate,
  ConnectionEvaluation,
} from "../connection-rules";
import { evaluateConnection } from "../connection-rules";
import { initialDynamicPortState } from "../sequence-node";
import {
  DEFAULT_RECOGNITION_REPEAT_DELAY_MILLISECONDS,
  RECOGNITION_REPEAT_DELAY_ROLE,
} from "../workflow-groups";
import type { CompositeCommand, GraphCommand } from "./graph-commands";

/** Produces fresh identifiers. Injected so tests are deterministic and so identifier
 * generation stays out of the domain logic. */
export type IdentifierFactory = () => string;

/** A copied fragment of a graph.
 *
 * Only edges whose endpoints are both inside the selection are carried, because an edge
 * to a node outside the fragment has no meaning once the fragment is pasted elsewhere.
 */
export interface GraphFragment {
  nodes: readonly NodeV1[];
  edges: readonly EdgeV1[];
  workflowGroups: readonly WorkflowGroupV1[];
  repeatHints?: readonly RepeatHintV1[];
}

export interface PasteOptions {
  /** Offset applied to every node position, so a paste does not land exactly on the
   * original and become invisible. */
  offset?: EditorPositionV1;
}

const DEFAULT_PASTE_OFFSET: EditorPositionV1 = { x: 32, y: 32 };

/** Extracts the selected nodes and the edges wholly inside the selection. */
export function extractFragment(
  graph: GraphV1,
  nodeIds: readonly string[],
): GraphFragment {
  const selected = new Set(nodeIds);
  const nodes = graph.nodes.filter((node) => selected.has(node.nodeId));
  const edges = graph.edges.filter(
    (edge) =>
      selected.has(edge.sourceNodeId) && selected.has(edge.targetNodeId),
  );
  const workflowGroups = (graph.editorMetadata?.workflowGroups ?? []).filter(
    (group) => group.members.every((member) => selected.has(member.nodeId)),
  );
  const edgeIds = new Set(
    edges
      .filter((edge) => edge.edgeKind === "execution")
      .map((edge) => edge.edgeId),
  );
  const repeatHints = (graph.editorMetadata?.repeatHints ?? []).filter((hint) =>
    edgeIds.has(hint.edgeId),
  );
  return repeatHints.length === 0
    ? { nodes, edges, workflowGroups }
    : { nodes, edges, workflowGroups, repeatHints };
}

/** Builds one composite command that inserts a fragment under fresh identifiers.
 *
 * Every node and edge is renumbered and internal references are rewritten, so a fragment
 * can be pasted repeatedly into the same graph without colliding with what is already
 * there or with a previous paste.
 */
export function buildPasteCommand(
  graphId: string,
  fragment: GraphFragment,
  createIdentifier: IdentifierFactory,
  options: PasteOptions = {},
): CompositeCommand {
  const offset = options.offset ?? DEFAULT_PASTE_OFFSET;
  const remapped = new Map<string, string>();
  for (const node of fragment.nodes) {
    remapped.set(node.nodeId, createIdentifier());
  }

  const commands: GraphCommand[] = fragment.nodes.map((node) => ({
    kind: "addNode",
    graphId,
    node: {
      ...node,
      nodeId: remapped.get(node.nodeId) ?? node.nodeId,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      // Breakpoints belong to a debugging session rather than to the copied logic.
      breakpoint: false,
    },
  }));

  for (const group of fragment.workflowGroups) {
    const members = group.members.flatMap((member) => {
      const nodeId = remapped.get(member.nodeId);
      return nodeId === undefined ? [] : [{ ...member, nodeId }];
    });
    if (members.length !== group.members.length || members.length === 0) {
      continue;
    }
    commands.push({
      kind: "addWorkflowGroup",
      graphId,
      group: {
        ...group,
        groupId: createIdentifier(),
        members: members as WorkflowGroupV1["members"],
        exposedPorts: group.exposedPorts.flatMap((port) => {
          const nodeId = remapped.get(port.nodeId);
          return nodeId === undefined ? [] : [{ ...port, nodeId }];
        }),
      },
    });
  }

  const remappedEdgeIds = new Map<string, string>();
  for (const edge of fragment.edges) {
    const sourceNodeId = remapped.get(edge.sourceNodeId);
    const targetNodeId = remapped.get(edge.targetNodeId);
    if (!sourceNodeId || !targetNodeId) {
      continue;
    }
    const edgeId = createIdentifier();
    remappedEdgeIds.set(edge.edgeId, edgeId);
    commands.push({
      kind: "addEdge",
      graphId,
      edge: {
        ...edge,
        edgeId,
        sourceNodeId,
        targetNodeId,
      },
    });
  }

  for (const hint of fragment.repeatHints ?? []) {
    const edgeId = remappedEdgeIds.get(hint.edgeId);
    if (edgeId === undefined) {
      continue;
    }
    commands.push({
      kind: "addRepeatHint",
      graphId,
      hint: {
        ...hint,
        hintId: createIdentifier(),
        edgeId,
        position: {
          x: hint.position.x + offset.x,
          y: hint.position.y + offset.y,
        },
      },
    });
  }

  return { kind: "composite", label: "paste", commands };
}

/** Builds the composite command that duplicates a selection in place. */
export function buildDuplicateCommand(
  graph: GraphV1,
  nodeIds: readonly string[],
  createIdentifier: IdentifierFactory,
  options: PasteOptions = {},
): CompositeCommand {
  const fragment = extractFragment(graph, nodeIds);
  const command = buildPasteCommand(
    graph.graphId,
    fragment,
    createIdentifier,
    options,
  );
  return { ...command, label: "duplicate" };
}

export type NodeInsertionResult =
  | { ok: true; command: Extract<GraphCommand, { kind: "addNode" }> }
  | { ok: false; reason: "definitionUnknown" };

export type TemplateExpansionFailure =
  "templateUnknown" | "definitionUnknown" | "placeholderUnknown";

export interface TemplateExpansionPort {
  proxyPortId: string;
  nodeId: string;
  portId: string;
}

export type TemplateExpansionResult =
  | {
      ok: true;
      command: CompositeCommand;
      exposedPorts: readonly TemplateExpansionPort[];
    }
  | { ok: false; reason: TemplateExpansionFailure };

/** Expands a workflow template into ordinary nodes and edges.
 *
 * The result is one composite command, so an insertion is a single undo step, and the
 * inserted nodes are ordinary editable graph entities rather than an opaque unit: a
 * template is authoring assistance and introduces no runtime behavior of its own.
 */
export function buildTemplateInsertCommand(
  graphId: string,
  templateKey: string,
  registry: RinoNodeRegistrySnapshotV1,
  origin: EditorPositionV1,
  createIdentifier: IdentifierFactory,
): TemplateExpansionResult {
  const template: WorkflowTemplateV1 | undefined = (
    registry.workflowTemplates ?? []
  ).find((candidate) => candidate.templateKey === templateKey);
  if (!template) {
    return { ok: false, reason: "templateUnknown" };
  }

  const definitions = new Map(
    registry.definitions.map((definition) => [definition.typeKey, definition]),
  );
  const nodeIdByPlaceholder = new Map<string, string>();
  const commands: GraphCommand[] = [];

  for (const templateNode of template.nodes) {
    const definition = definitions.get(templateNode.typeKey);
    if (definition === undefined) {
      return { ok: false, reason: "definitionUnknown" };
    }
    const nodeId = createIdentifier();
    const dynamicPortState = initialDynamicPortState(templateNode.typeKey);
    nodeIdByPlaceholder.set(templateNode.placeholderId, nodeId);
    commands.push({
      kind: "addNode",
      graphId,
      node: {
        nodeId,
        typeKey: templateNode.typeKey,
        typeVersion: definition.typeVersion,
        position: {
          x: origin.x + templateNode.offset.x,
          y: origin.y + templateNode.offset.y,
        },
        properties: {
          ...(definition.propertyDefaults ?? {}),
          ...(templateNode.properties ?? {}),
        },
        inputValues: { ...templateNode.inputValues },
        ...(dynamicPortState === undefined ? {} : { dynamicPortState }),
      },
    });
  }

  let recognitionRepeat:
    | {
        delayNodeId: string;
        repeatEdgeId: string;
        sourceNodeId: string;
        sourcePortId: string;
        targetNodeId: string;
        targetPortId: string;
      }
    | undefined;
  if (
    template.workflowGroup?.kind === "imageRecognition" ||
    template.workflowGroup?.kind === "textRecognition"
  ) {
    const noMatchPort = template.workflowGroup.exposedPorts.find(
      (port) => port.proxyPortId === "noMatch",
    );
    const runPort = template.workflowGroup.exposedPorts.find(
      (port) => port.proxyPortId === "run",
    );
    if (noMatchPort !== undefined && runPort !== undefined) {
      const delayDefinition = definitions.get("core.time.delay");
      if (delayDefinition === undefined) {
        return { ok: false, reason: "definitionUnknown" };
      }
      const sourceNodeId = nodeIdByPlaceholder.get(noMatchPort.placeholderId);
      const targetNodeId = nodeIdByPlaceholder.get(runPort.placeholderId);
      if (sourceNodeId === undefined || targetNodeId === undefined) {
        return { ok: false, reason: "placeholderUnknown" };
      }
      const delayNodeId = createIdentifier();
      const repeatEdgeId = createIdentifier();
      recognitionRepeat = {
        delayNodeId,
        repeatEdgeId,
        sourceNodeId,
        sourcePortId: noMatchPort.portId,
        targetNodeId,
        targetPortId: runPort.portId,
      };
      commands.push({
        kind: "addNode",
        graphId,
        node: {
          nodeId: delayNodeId,
          typeKey: delayDefinition.typeKey,
          typeVersion: delayDefinition.typeVersion,
          position: { x: origin.x + 320, y: origin.y + 240 },
          properties: { ...(delayDefinition.propertyDefaults ?? {}) },
          inputValues: {
            durationMilliseconds: DEFAULT_RECOGNITION_REPEAT_DELAY_MILLISECONDS,
          },
        },
      });
    }
  }

  for (const templateEdge of template.edges ?? []) {
    const sourceNodeId = nodeIdByPlaceholder.get(
      templateEdge.sourcePlaceholderId,
    );
    const targetNodeId = nodeIdByPlaceholder.get(
      templateEdge.targetPlaceholderId,
    );
    if (!sourceNodeId || !targetNodeId) {
      return { ok: false, reason: "placeholderUnknown" };
    }
    commands.push({
      kind: "addEdge",
      graphId,
      edge: {
        edgeId: createIdentifier(),
        edgeKind: templateEdge.edgeKind,
        sourceNodeId,
        sourcePortId: templateEdge.sourcePortId,
        targetNodeId,
        targetPortId: templateEdge.targetPortId,
      },
    });
  }

  if (recognitionRepeat !== undefined) {
    commands.push(
      {
        kind: "addEdge",
        graphId,
        edge: {
          edgeId: recognitionRepeat.repeatEdgeId,
          edgeKind: "execution",
          sourceNodeId: recognitionRepeat.sourceNodeId,
          sourcePortId: recognitionRepeat.sourcePortId,
          targetNodeId: recognitionRepeat.delayNodeId,
          targetPortId: "run",
        },
      },
      {
        kind: "addEdge",
        graphId,
        edge: {
          edgeId: createIdentifier(),
          edgeKind: "execution",
          sourceNodeId: recognitionRepeat.delayNodeId,
          sourcePortId: "next",
          targetNodeId: recognitionRepeat.targetNodeId,
          targetPortId: recognitionRepeat.targetPortId,
        },
      },
    );
  }

  const templateExposedPorts = [
    ...(template.exposedPorts ?? []),
    ...(template.workflowGroup?.exposedPorts ?? []),
  ];
  const exposedPorts: TemplateExpansionPort[] = [];
  const exposedProxyPortIds = new Set<string>();
  for (const port of templateExposedPorts) {
    if (exposedProxyPortIds.has(port.proxyPortId)) {
      continue;
    }
    const nodeId = nodeIdByPlaceholder.get(port.placeholderId);
    if (nodeId === undefined) {
      return { ok: false, reason: "placeholderUnknown" };
    }
    exposedProxyPortIds.add(port.proxyPortId);
    exposedPorts.push({
      proxyPortId: port.proxyPortId,
      nodeId,
      portId: port.portId,
    });
  }

  if (template.workflowGroup !== undefined) {
    const templateMembers = template.workflowGroup.members.flatMap((member) => {
      const nodeId = nodeIdByPlaceholder.get(member.placeholderId);
      return nodeId === undefined ? [] : [{ role: member.role, nodeId }];
    });
    const members =
      recognitionRepeat === undefined
        ? templateMembers
        : [
            ...templateMembers,
            {
              role: RECOGNITION_REPEAT_DELAY_ROLE,
              nodeId: recognitionRepeat.delayNodeId,
            },
          ];
    const exposedPorts = template.workflowGroup.exposedPorts.flatMap((port) => {
      const nodeId = nodeIdByPlaceholder.get(port.placeholderId);
      return nodeId === undefined
        ? []
        : [
            {
              proxyPortId: port.proxyPortId,
              nodeId,
              portId: port.portId,
              labelKey: port.labelKey,
            },
          ];
    });
    if (
      templateMembers.length !== template.workflowGroup.members.length ||
      exposedPorts.length !== template.workflowGroup.exposedPorts.length ||
      members.length === 0
    ) {
      return { ok: false, reason: "placeholderUnknown" };
    }
    commands.push({
      kind: "addWorkflowGroup",
      graphId,
      group: {
        groupId: createIdentifier(),
        kind: template.workflowGroup.kind,
        members: members as WorkflowGroupV1["members"],
        exposedPorts,
        collapsed: true,
      },
    });
  }

  return {
    ok: true,
    command: { kind: "composite", label: "insertTemplate", commands },
    exposedPorts,
  };
}

/** Builds the command that realizes an accepted connection.
 *
 * Displaced edges are removed inside the same composite command, so replacing a
 * connection is one undo step and the graph is never briefly left with two edges on a
 * port that accepts one.
 */
export function buildConnectCommand(
  graphId: string,
  candidate: ConnectionCandidate,
  evaluation: Extract<ConnectionEvaluation, { accepted: true }>,
  createIdentifier: IdentifierFactory,
): CompositeCommand {
  const commands: GraphCommand[] = evaluation.replaces.map((edgeId) => ({
    kind: "removeEdge",
    graphId,
    edgeId,
  }));
  commands.push({
    kind: "addEdge",
    graphId,
    edge: {
      edgeId: createIdentifier(),
      edgeKind: evaluation.edgeKind,
      sourceNodeId: candidate.sourceNodeId,
      sourcePortId: candidate.sourcePortId,
      targetNodeId: candidate.targetNodeId,
      targetPortId: candidate.targetPortId,
    },
  });
  return { kind: "composite", label: "connect", commands };
}

/** An address of one graph port. Moving connections only ever moves between ports on
 * the same side, so every existing edge keeps its opposite endpoint unchanged. */
export interface GraphPortAddress {
  nodeId: string;
  portId: string;
  direction: "input" | "output";
}

export type RetargetPortConnectionsResult =
  | { ok: true; command: CompositeCommand }
  | {
      ok: false;
      reason:
        | "samePort"
        | "noConnections"
        | "directionMismatch"
        | "connectionRejected"
        | "wouldDisplaceMovedConnection";
    };

function edgeTouchesPort(edge: EdgeV1, port: GraphPortAddress): boolean {
  return port.direction === "output"
    ? edge.sourceNodeId === port.nodeId && edge.sourcePortId === port.portId
    : edge.targetNodeId === port.nodeId && edge.targetPortId === port.portId;
}

function retargetCandidate(
  edge: EdgeV1,
  destination: GraphPortAddress,
): ConnectionCandidate {
  return destination.direction === "output"
    ? {
        sourceNodeId: destination.nodeId,
        sourcePortId: destination.portId,
        targetNodeId: edge.targetNodeId,
        targetPortId: edge.targetPortId,
      }
    : {
        sourceNodeId: edge.sourceNodeId,
        sourcePortId: edge.sourcePortId,
        targetNodeId: destination.nodeId,
        targetPortId: destination.portId,
      };
}

/** Removes every edge incident to one port as a single undoable edit. */
export function buildDisconnectPortCommand(
  graphId: string,
  edgeIds: readonly string[],
): CompositeCommand {
  return {
    kind: "composite",
    label: "disconnectPort",
    commands: edgeIds.map((edgeId) => ({
      kind: "removeEdge" as const,
      graphId,
      edgeId,
    })),
  };
}

/** Reconnects a single wire by replacing its persisted edge in one history entry. */
export function buildReconnectEdgeCommand(
  graphId: string,
  edgeId: string,
  candidate: ConnectionCandidate,
  evaluation: Extract<ConnectionEvaluation, { accepted: true }>,
  createIdentifier: IdentifierFactory,
): CompositeCommand {
  const removed = new Set([edgeId, ...evaluation.replaces]);
  const commands: GraphCommand[] = [...removed].map((removedEdgeId) => ({
    kind: "removeEdge",
    graphId,
    edgeId: removedEdgeId,
  }));
  commands.push({
    kind: "addEdge",
    graphId,
    edge: {
      edgeId: createIdentifier(),
      edgeKind: evaluation.edgeKind,
      sourceNodeId: candidate.sourceNodeId,
      sourcePortId: candidate.sourcePortId,
      targetNodeId: candidate.targetNodeId,
      targetPortId: candidate.targetPortId,
    },
  });
  return { kind: "composite", label: "reconnectEdge", commands };
}

/** Moves all wires from one port to another compatible port atomically.
 *
 * The original wires are first removed from a simulated graph. Every replacement is then
 * evaluated against the graph produced so far, which prevents a partial move and catches
 * a destination that cannot hold every moved wire. */
export function buildRetargetPortConnectionsCommand(
  graph: GraphV1,
  registry: RinoNodeRegistrySnapshotV1,
  origin: GraphPortAddress,
  destination: GraphPortAddress,
  createIdentifier: IdentifierFactory,
): RetargetPortConnectionsResult {
  if (
    origin.nodeId === destination.nodeId &&
    origin.portId === destination.portId
  ) {
    return { ok: false, reason: "samePort" };
  }
  if (origin.direction !== destination.direction) {
    return { ok: false, reason: "directionMismatch" };
  }

  const movedEdges = graph.edges.filter((edge) =>
    edgeTouchesPort(edge, origin),
  );
  if (movedEdges.length === 0) {
    return { ok: false, reason: "noConnections" };
  }

  const movedIds = new Set(movedEdges.map((edge) => edge.edgeId));
  let simulatedGraph: GraphV1 = {
    ...graph,
    edges: graph.edges.filter((edge) => !movedIds.has(edge.edgeId)),
  };
  const commands: GraphCommand[] = movedEdges.map((edge) => ({
    kind: "removeEdge",
    graphId: graph.graphId,
    edgeId: edge.edgeId,
  }));
  const addedIds = new Set<string>();

  for (const edge of movedEdges) {
    const candidate = retargetCandidate(edge, destination);
    const evaluation = evaluateConnection(simulatedGraph, registry, candidate);
    if (!evaluation.accepted) {
      return { ok: false, reason: "connectionRejected" };
    }
    if (evaluation.replaces.some((edgeId) => addedIds.has(edgeId))) {
      return { ok: false, reason: "wouldDisplaceMovedConnection" };
    }

    const removedIds = new Set(evaluation.replaces);
    for (const edgeId of removedIds) {
      commands.push({ kind: "removeEdge", graphId: graph.graphId, edgeId });
    }
    simulatedGraph = {
      ...simulatedGraph,
      edges: simulatedGraph.edges.filter(
        (current) => !removedIds.has(current.edgeId),
      ),
    };

    const replacement: EdgeV1 = {
      edgeId: createIdentifier(),
      edgeKind: evaluation.edgeKind,
      sourceNodeId: candidate.sourceNodeId,
      sourcePortId: candidate.sourcePortId,
      targetNodeId: candidate.targetNodeId,
      targetPortId: candidate.targetPortId,
    };
    addedIds.add(replacement.edgeId);
    commands.push({
      kind: "addEdge",
      graphId: graph.graphId,
      edge: replacement,
    });
    simulatedGraph = {
      ...simulatedGraph,
      edges: [...simulatedGraph.edges, replacement],
    };
  }

  return {
    ok: true,
    command: { kind: "composite", label: "retargetPortConnections", commands },
  };
}

/** Builds the command that places one new node of the given type. */
export function buildInsertNodeCommand(
  graphId: string,
  typeKey: string,
  registry: RinoNodeRegistrySnapshotV1,
  position: EditorPositionV1,
  createIdentifier: IdentifierFactory,
): NodeInsertionResult {
  const definition = registry.definitions.find(
    (candidate) => candidate.typeKey === typeKey,
  );
  if (!definition) {
    return { ok: false, reason: "definitionUnknown" };
  }
  const dynamicPortState = initialDynamicPortState(definition.typeKey);
  return {
    ok: true,
    command: {
      kind: "addNode",
      graphId,
      node: {
        nodeId: createIdentifier(),
        typeKey: definition.typeKey,
        typeVersion: definition.typeVersion,
        position,
        properties: { ...(definition.propertyDefaults ?? {}) },
        inputValues: {},
        ...(dynamicPortState === undefined ? {} : { dynamicPortState }),
      },
    },
  };
}

/** Builds the composite command that removes a selection, including its edges. */
export function buildRemoveSelectionCommand(
  graphId: string,
  nodeIds: readonly string[],
): CompositeCommand {
  return {
    kind: "composite",
    label: "removeSelection",
    commands: nodeIds.map((nodeId) => ({
      kind: "removeNode",
      graphId,
      nodeId,
    })),
  };
}
