import type {
  EdgeV1,
  GraphV1,
  NodeV1,
  RinoProjectDocumentV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";

import {
  resolveFunctionNodeDefinition,
  type ResolvedNodeDefinition,
} from "./function-node-semantics";
import {
  NodeRegistryIndex,
  maximumConnections,
  type IndexedNodeDefinition,
} from "./node-registry-index";
import { isAssignable, isExecutionType } from "./type-compatibility";

/** A connection the user is attempting, expressed in domain terms. */
export interface ConnectionCandidate {
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

export type ConnectionRejectionReason =
  | "nodeMissing"
  | "portMissing"
  | "portDirectionMismatch"
  | "portKindMismatch"
  | "typeIncompatible"
  | "selfConnection"
  | "duplicateConnection"
  | "wouldCreateDataCycle"
  | "wouldCreateMultipleParallelOnPath";

export type ConnectionEvaluation =
  | {
      accepted: true;
      edgeKind: EdgeV1["edgeKind"];
      /** Identifiers of edges the connection displaces because a port that accepts a
       * single connection is already occupied. Replacing rather than rejecting matches
       * the established node-editor gesture, and the removal travels in the same
       * composite command so one undo restores the previous wiring. */
      replaces: readonly string[];
    }
  | { accepted: false; reason: ConnectionRejectionReason };

function rejected(reason: ConnectionRejectionReason): ConnectionEvaluation {
  return { accepted: false, reason };
}

/** One graph prepared for repeated connection evaluation.
 *
 * Highlighting compatible targets asks the same question once per port on the canvas, so
 * the per-candidate cost has to stay independent of graph size. The index resolves nodes
 * and pure-node ancestry through prepared lookups instead of scanning the graph again for
 * every candidate, and it answers with exactly the rules `evaluateConnection` applies so
 * a highlighted port cannot then be refused.
 */
export class GraphConnectionIndex {
  readonly graph: GraphV1;
  readonly registry: NodeRegistryIndex;
  private readonly nodesById: ReadonlyMap<string, NodeV1>;
  private readonly document: RinoProjectDocumentV1 | undefined;
  private readonly incomingDataEdges: ReadonlyMap<string, readonly EdgeV1[]>;
  private readonly pureAncestors = new Map<string, ReadonlySet<string>>();

  constructor(
    graph: GraphV1,
    registry: RinoNodeRegistrySnapshotV1 | NodeRegistryIndex,
    document?: RinoProjectDocumentV1,
  ) {
    this.graph = graph;
    this.registry =
      registry instanceof NodeRegistryIndex
        ? registry
        : new NodeRegistryIndex(registry);
    this.nodesById = new Map(graph.nodes.map((node) => [node.nodeId, node]));
    this.document = document;

    const incoming = new Map<string, EdgeV1[]>();
    for (const edge of graph.edges) {
      if (edge.edgeKind !== "data") {
        continue;
      }
      const existing = incoming.get(edge.targetNodeId);
      if (existing) {
        existing.push(edge);
      } else {
        incoming.set(edge.targetNodeId, [edge]);
      }
    }
    this.incomingDataEdges = incoming;
  }

  node(nodeId: string): NodeV1 | undefined {
    return this.nodesById.get(nodeId);
  }

  /** Resolves the same effective definition used by graph validation and the canvas.
   * Function boundary/call nodes deliberately live outside the production registry. */
  definition(node: NodeV1): NodeRegistryDefinition | undefined {
    return (
      resolveFunctionNodeDefinition(node, this.graph, this.document) ??
      this.registry.find(node.typeKey)
    );
  }

  private isPure(nodeId: string): boolean {
    const node = this.nodesById.get(nodeId);
    return (
      node !== undefined &&
      this.definition(node)?.definition.runtimeKind === "pure"
    );
  }

  /** The pure nodes whose values `nodeId` already depends on, including itself.
   *
   * Empty when `nodeId` is not pure: a node with its own execution turn is entered by the
   * scheduler rather than pulled by a consumer, so it cannot take part in a pure cycle.
   */
  private pureDataAncestorsOf(nodeId: string): ReadonlySet<string> {
    const memoized = this.pureAncestors.get(nodeId);
    if (memoized) {
      return memoized;
    }

    const reached = new Set<string>();
    if (this.isPure(nodeId)) {
      const pending = [nodeId];
      while (pending.length > 0) {
        const current = pending.pop();
        if (current === undefined || reached.has(current)) {
          continue;
        }
        reached.add(current);
        for (const edge of this.incomingDataEdges.get(current) ?? []) {
          if (this.isPure(edge.sourceNodeId)) {
            pending.push(edge.sourceNodeId);
          }
        }
      }
    }
    this.pureAncestors.set(nodeId, reached);
    return reached;
  }

  /** Reports whether a prospective data edge would close a cycle among pure nodes.
   *
   * Pure nodes are evaluated on demand by whoever reads their output, so a cycle between
   * them has no starting point. The new edge closes one when the prospective target
   * already supplies the prospective source.
   */
  private closesPureDataCycle(candidate: ConnectionCandidate): boolean {
    return this.pureDataAncestorsOf(candidate.sourceNodeId).has(
      candidate.targetNodeId,
    );
  }

  /** Returns the parallel nodes reached for a second time on an execution path. */
  private multipleParallelViolationNodes(
    edges: readonly EdgeV1[],
  ): ReadonlySet<string> {
    const executionAdjacency = new Map<string, string[]>();
    for (const edge of edges) {
      if (!this.isValidExecutionEdge(edge)) {
        continue;
      }
      const targets = executionAdjacency.get(edge.sourceNodeId);
      if (targets) {
        targets.push(edge.targetNodeId);
      } else {
        executionAdjacency.set(edge.sourceNodeId, [edge.targetNodeId]);
      }
    }

    const entryNodes = [...this.nodesById.values()].filter(
      (node) => this.definition(node)?.definition.runtimeKind === "entry",
    );
    const pending: (readonly [string, boolean])[] = entryNodes.map(
      (node): readonly [string, boolean] => [node.nodeId, false],
    );
    const visited = new Set<string>();
    const violations = new Set<string>();
    let cursor = 0;
    while (cursor < pending.length) {
      const state = pending[cursor];
      cursor += 1;
      if (!state) {
        continue;
      }
      const [nodeId, hasSeenParallel] = state;
      const stateKey = `${nodeId}:${hasSeenParallel ? "1" : "0"}`;
      if (visited.has(stateKey)) {
        continue;
      }
      visited.add(stateKey);

      const node = this.nodesById.get(nodeId);
      if (!node) {
        continue;
      }
      const isParallel = node.typeKey === "core.flow.parallel";
      if (isParallel && hasSeenParallel) {
        violations.add(nodeId);
      }
      const nextHasSeenParallel = hasSeenParallel || isParallel;
      for (const targetNodeId of executionAdjacency.get(nodeId) ?? []) {
        pending.push([targetNodeId, nextHasSeenParallel]);
      }
    }
    return violations;
  }

  private isValidExecutionEdge(edge: EdgeV1): boolean {
    if (
      edge.edgeKind !== "execution" ||
      edge.sourceNodeId === edge.targetNodeId
    ) {
      return false;
    }
    const sourceNode = this.nodesById.get(edge.sourceNodeId);
    const targetNode = this.nodesById.get(edge.targetNodeId);
    if (!sourceNode || !targetNode) {
      return false;
    }
    const sourcePort = this.definition(sourceNode)?.ports.get(
      edge.sourcePortId,
    );
    const targetPort = this.definition(targetNode)?.ports.get(
      edge.targetPortId,
    );
    if (!sourcePort || !targetPort) {
      return false;
    }
    return (
      sourcePort.direction === "output" &&
      targetPort.direction === "input" &&
      sourcePort.portKind === "execution" &&
      targetPort.portKind === "execution" &&
      isAssignable(sourcePort.type, targetPort.type)
    );
  }

  private wouldCreateMultipleParallelOnPath(
    candidate: ConnectionCandidate,
    replaces: readonly string[],
  ): boolean {
    const existingViolations = this.multipleParallelViolationNodes(
      this.graph.edges,
    );
    const prospectiveEdges = this.graph.edges.filter(
      (edge) => !replaces.includes(edge.edgeId),
    );
    prospectiveEdges.push({
      edgeId: "__connection_candidate__",
      edgeKind: "execution",
      sourceNodeId: candidate.sourceNodeId,
      sourcePortId: candidate.sourcePortId,
      targetNodeId: candidate.targetNodeId,
      targetPortId: candidate.targetPortId,
    });
    const prospectiveViolations =
      this.multipleParallelViolationNodes(prospectiveEdges);
    for (const nodeId of prospectiveViolations) {
      if (!existingViolations.has(nodeId)) {
        return true;
      }
    }
    return false;
  }

  /** Decides whether a connection may be created, and what it displaces if so. */
  evaluate(candidate: ConnectionCandidate): ConnectionEvaluation {
    if (candidate.sourceNodeId === candidate.targetNodeId) {
      return rejected("selfConnection");
    }

    const sourceNode = this.nodesById.get(candidate.sourceNodeId);
    const targetNode = this.nodesById.get(candidate.targetNodeId);
    if (!sourceNode || !targetNode) {
      return rejected("nodeMissing");
    }

    const sourcePort = this.definition(sourceNode)?.ports.get(
      candidate.sourcePortId,
    );
    const targetPort = this.definition(targetNode)?.ports.get(
      candidate.targetPortId,
    );
    if (!sourcePort || !targetPort) {
      return rejected("portMissing");
    }

    if (sourcePort.direction !== "output" || targetPort.direction !== "input") {
      return rejected("portDirectionMismatch");
    }

    if (sourcePort.portKind !== targetPort.portKind) {
      return rejected("portKindMismatch");
    }

    if (!isAssignable(sourcePort.type, targetPort.type)) {
      return rejected("typeIncompatible");
    }

    const duplicate = this.graph.edges.some(
      (edge) =>
        edge.sourceNodeId === candidate.sourceNodeId &&
        edge.sourcePortId === candidate.sourcePortId &&
        edge.targetNodeId === candidate.targetNodeId &&
        edge.targetPortId === candidate.targetPortId,
    );
    if (duplicate) {
      return rejected("duplicateConnection");
    }

    const edgeKind: EdgeV1["edgeKind"] = isExecutionType(sourcePort.type)
      ? "execution"
      : "data";

    if (edgeKind === "data" && this.closesPureDataCycle(candidate)) {
      return rejected("wouldCreateDataCycle");
    }

    const replaces: string[] = [];
    const sourceLimit = maximumConnections(sourcePort);
    if (Number.isFinite(sourceLimit)) {
      const occupying = this.graph.edges.filter(
        (edge) =>
          edge.sourceNodeId === candidate.sourceNodeId &&
          edge.sourcePortId === candidate.sourcePortId,
      );
      replaces.push(
        ...occupying
          .slice(0, Math.max(0, occupying.length - sourceLimit + 1))
          .map((edge) => edge.edgeId),
      );
    }
    const targetLimit = maximumConnections(targetPort);
    if (Number.isFinite(targetLimit)) {
      const occupying = this.graph.edges.filter(
        (edge) =>
          edge.targetNodeId === candidate.targetNodeId &&
          edge.targetPortId === candidate.targetPortId,
      );
      for (const edge of occupying.slice(
        0,
        Math.max(0, occupying.length - targetLimit + 1),
      )) {
        if (!replaces.includes(edge.edgeId)) {
          replaces.push(edge.edgeId);
        }
      }
    }

    if (
      edgeKind === "execution" &&
      this.wouldCreateMultipleParallelOnPath(candidate, replaces)
    ) {
      return rejected("wouldCreateMultipleParallelOnPath");
    }

    return { accepted: true, edgeKind, replaces };
  }
}

/** Decides whether a single connection may be created, and what it displaces if so.
 *
 * The editor asks this before accepting a drag so an invalid edge never enters the
 * document. It answers with the same rules the graph validator applies, so a connection
 * the canvas accepts cannot produce a validation error the moment it lands.
 */
export function evaluateConnection(
  graph: GraphV1,
  registry: RinoNodeRegistrySnapshotV1 | NodeRegistryIndex,
  candidate: ConnectionCandidate,
  document?: RinoProjectDocumentV1,
): ConnectionEvaluation {
  return new GraphConnectionIndex(graph, registry, document).evaluate(
    candidate,
  );
}

type NodeRegistryDefinition = IndexedNodeDefinition | ResolvedNodeDefinition;
