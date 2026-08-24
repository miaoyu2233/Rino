import type {
  EdgeV1,
  GraphDiagnosticV1,
  GraphV1,
  NodeV1,
  PortDefinitionV1,
  RinoNodeRegistrySnapshotV1,
  RinoProjectDocumentV1,
} from "@rino/contracts";

import {
  assetLocation,
  buildDiagnostic,
  documentLocation,
  edgeLocation,
  graphLocation,
  nodeLocation,
  portLocation,
} from "./graph-diagnostics";
import {
  NodeRegistryIndex,
  maximumConnections,
  type IndexedNodeDefinition,
} from "./node-registry-index";
import { describeType, isAssignable } from "./type-compatibility";
import {
  FUNCTION_CALL_NODE_TYPE,
  FUNCTION_INPUT_NODE_TYPE,
  FUNCTION_RETURN_NODE_TYPE,
  resolveFunctionNodeDefinition,
  type ResolvedNodeDefinition,
} from "./function-node-semantics";
import {
  normalizeVariableName,
  variableValueKindForNodeTypeKey,
} from "./variables/variable-authoring";

const MAXIMUM_GRAPH_DIAGNOSTICS = 2000;

export interface ValidationOptions {
  /** Capabilities the active backend advertises. Absent means capabilities are unknown
   * and are not checked, which is the state before a runtime connects. */
  availableCapabilities?: readonly string[];
}

export interface ValidationReport {
  diagnostics: GraphDiagnosticV1[];
  /** A document with no error-severity diagnostic may be executed. */
  executable: boolean;
}

function requiredClickPointInputPorts(inputMode: unknown): readonly string[] {
  switch (inputMode) {
    case "coordinates":
      return ["image", "x", "y", "referenceWidth", "referenceHeight"];
    case "randomPoints":
    case "sequentialPoints":
      return ["points"];
    case "rectCenter":
    case "rectRandom":
      return ["rect"];
    case "point":
    default:
      return ["point"];
  }
}

/** Normalizes an asset display name the way the persistence layer does, so the editor
 * rejects the same collisions a save would. */
export function normalizeAssetName(displayName: string): string {
  return displayName.normalize("NFKC").trim().toLocaleLowerCase();
}

/** Validates the parts of a document independently.
 *
 * Document structure and each graph are separate passes because a graph's diagnostics
 * depend only on that graph and on the registry. Splitting them is what lets the editor
 * revalidate a single edited graph instead of the whole project after every edit.
 */
export interface DocumentValidator {
  validateStructure(document: RinoProjectDocumentV1): GraphDiagnosticV1[];
  validateGraph(
    graph: GraphV1,
    document?: RinoProjectDocumentV1,
  ): GraphDiagnosticV1[];
}

type EffectiveNodeDefinition = IndexedNodeDefinition | ResolvedNodeDefinition;

interface FunctionCallReference {
  readonly graphId: string;
  readonly nodeId: string;
  readonly targetGraphId: string;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

class GraphValidator implements DocumentValidator {
  private diagnostics: GraphDiagnosticV1[] = [];
  private readonly registry: NodeRegistryIndex;
  private readonly availableCapabilities: ReadonlySet<string> | undefined;

  constructor(
    registry: RinoNodeRegistrySnapshotV1,
    options: ValidationOptions = {},
  ) {
    this.registry = new NodeRegistryIndex(registry);
    this.availableCapabilities = options.availableCapabilities
      ? new Set(options.availableCapabilities)
      : undefined;
  }

  validateStructure(document: RinoProjectDocumentV1): GraphDiagnosticV1[] {
    return this.collect(() => {
      this.checkDocumentStructure(document);
    });
  }

  validateGraph(
    graph: GraphV1,
    document?: RinoProjectDocumentV1,
  ): GraphDiagnosticV1[] {
    return this.collect(() => {
      this.checkGraph(graph, document);
    });
  }

  /** Runs one pass and returns only what that pass reported. */
  private collect(pass: () => void): GraphDiagnosticV1[] {
    this.diagnostics = [];
    pass();
    const reported = this.diagnostics;
    this.diagnostics = [];
    return reported;
  }

  private report(diagnostic: GraphDiagnosticV1): void {
    if (this.diagnostics.length >= MAXIMUM_GRAPH_DIAGNOSTICS) {
      return;
    }
    this.diagnostics.push(diagnostic);
  }

  private checkDocumentStructure(document: RinoProjectDocumentV1): void {
    const graphIds = new Set<string>();
    for (const graph of document.graphs) {
      if (graphIds.has(graph.graphId)) {
        this.report(
          buildDiagnostic(
            "GRAPH_DUPLICATE_GRAPH_ID",
            graphLocation(graph.graphId),
          ),
        );
      }
      graphIds.add(graph.graphId);
    }

    if (!graphIds.has(document.entryGraphId)) {
      this.report(
        buildDiagnostic("GRAPH_ENTRY_GRAPH_MISSING", documentLocation(), {
          entryGraphId: document.entryGraphId,
        }),
      );
    }

    for (const graph of document.graphs) {
      this.validateFunctionSemantics(document, graph);
    }
    this.validateFunctionNodeSemantics(document);
    this.validateProjectVariables(document);

    const assetIds = new Set<string>();
    const normalizedNames = new Set<string>();
    for (const asset of document.assets) {
      if (assetIds.has(asset.assetId)) {
        this.report(
          buildDiagnostic(
            "DOCUMENT_DUPLICATE_ASSET_ID",
            assetLocation(asset.assetId),
          ),
        );
      }
      assetIds.add(asset.assetId);

      const normalized = normalizeAssetName(asset.displayName);
      if (normalizedNames.has(normalized)) {
        this.report(
          buildDiagnostic(
            "DOCUMENT_DUPLICATE_ASSET_NAME",
            assetLocation(asset.assetId),
          ),
        );
      }
      normalizedNames.add(normalized);
    }
  }

  private validateProjectVariables(document: RinoProjectDocumentV1): void {
    const identifiers = new Set<string>();
    const names = new Set<string>();
    for (const variable of document.variables ?? []) {
      if (identifiers.has(variable.variableId)) {
        this.report(
          buildDiagnostic("GRAPH_DUPLICATE_VARIABLE_ID", documentLocation(), {
            variableId: variable.variableId,
          }),
        );
      }
      identifiers.add(variable.variableId);

      const normalizedName = normalizeVariableName(variable.name);
      if (names.has(normalizedName)) {
        this.report(
          buildDiagnostic("GRAPH_DUPLICATE_VARIABLE_NAME", documentLocation(), {
            name: variable.name,
          }),
        );
      }
      names.add(normalizedName);

      if (variable.valueKind === "imageRef" && variable.persistent) {
        this.report(
          buildDiagnostic(
            "GRAPH_VARIABLE_PERSISTENCE_UNSUPPORTED",
            documentLocation(),
            {
              variableId: variable.variableId,
              name: variable.name,
              valueKind: variable.valueKind,
            },
          ),
        );
      }
    }
  }

  private variableDefinitionsForGraph(
    graph: GraphV1,
    document?: RinoProjectDocumentV1,
  ): readonly NonNullable<RinoProjectDocumentV1["variables"]>[number][] {
    return document?.variables ?? graph.variables ?? [];
  }

  private validateFunctionSemantics(
    document: RinoProjectDocumentV1,
    graph: GraphV1,
  ): void {
    const isEntryGraph = graph.graphId === document.entryGraphId;
    if (isEntryGraph) {
      if (graph.kind !== "entry") {
        this.report(
          buildDiagnostic(
            "GRAPH_ENTRY_KIND_INVALID",
            graphLocation(graph.graphId),
          ),
        );
      }
    } else if (graph.kind !== "function") {
      this.report(
        buildDiagnostic(
          "GRAPH_NON_ENTRY_KIND_INVALID",
          graphLocation(graph.graphId),
        ),
      );
    }

    if (graph.kind === "function" && graph.functionSignature !== undefined) {
      const parameters = [
        ...graph.functionSignature.inputs,
        ...graph.functionSignature.outputs,
      ];

      const parameterIds = new Set<string>();
      for (const parameter of parameters) {
        if (parameterIds.has(parameter.parameterId)) {
          this.report(
            buildDiagnostic(
              "FUNCTION_DUPLICATE_PARAMETER_ID",
              graphLocation(graph.graphId),
              { parameterId: parameter.parameterId },
            ),
          );
        }
        parameterIds.add(parameter.parameterId);
      }

      const portIds = new Set<string>();
      for (const parameter of parameters) {
        if (portIds.has(parameter.portId)) {
          this.report(
            buildDiagnostic(
              "FUNCTION_DUPLICATE_PORT_ID",
              graphLocation(graph.graphId),
              { portId: parameter.portId },
            ),
          );
        }
        portIds.add(parameter.portId);
      }

      for (const [direction, directionParameters] of [
        ["input", graph.functionSignature.inputs],
        ["output", graph.functionSignature.outputs],
      ] as const) {
        const names = new Set<string>();
        for (const parameter of directionParameters) {
          const normalizedName = normalizeAssetName(parameter.name);
          if (names.has(normalizedName)) {
            this.report(
              buildDiagnostic(
                "FUNCTION_DUPLICATE_PARAMETER_NAME",
                graphLocation(graph.graphId),
                { name: parameter.name, direction },
              ),
            );
          }
          names.add(normalizedName);
        }
      }

      for (const parameter of parameters) {
        if (parameter.portId === "run" || parameter.portId === "next") {
          this.report(
            buildDiagnostic(
              "FUNCTION_PARAMETER_PORT_RESERVED",
              graphLocation(graph.graphId),
              { portId: parameter.portId },
            ),
          );
        }
      }
    }

    if (graph.kind === "function") {
      for (const node of graph.nodes) {
        if (node.typeKey === "core.flow.parallel") {
          this.report(
            buildDiagnostic(
              "FUNCTION_PARALLEL_FORBIDDEN",
              nodeLocation(graph.graphId, node.nodeId),
              { typeKey: node.typeKey },
            ),
          );
        }
      }
    }
  }

  private validateFunctionNodeSemantics(document: RinoProjectDocumentV1): void {
    const graphsById = new Map(
      document.graphs.map((graph) => [graph.graphId, graph] as const),
    );
    const callsByGraph = new Map<string, FunctionCallReference[]>();

    for (const graph of document.graphs) {
      const inputNodes = graph.nodes.filter(
        (node) => node.typeKey === FUNCTION_INPUT_NODE_TYPE,
      );
      const returnNodes = graph.nodes.filter(
        (node) => node.typeKey === FUNCTION_RETURN_NODE_TYPE,
      );
      if (graph.kind === "function") {
        if (inputNodes.length === 0) {
          this.report(
            buildDiagnostic(
              "FUNCTION_ENTRY_NODE_MISSING",
              graphLocation(graph.graphId),
            ),
          );
        } else if (inputNodes.length > 1) {
          this.report(
            buildDiagnostic(
              "FUNCTION_MULTIPLE_ENTRY_NODES",
              graphLocation(graph.graphId),
            ),
          );
        }
        if (returnNodes.length === 0) {
          this.report(
            buildDiagnostic(
              "FUNCTION_RETURN_NODE_MISSING",
              graphLocation(graph.graphId),
            ),
          );
        }
      } else {
        for (const node of [...inputNodes, ...returnNodes]) {
          this.report(
            buildDiagnostic(
              "FUNCTION_NODE_OUTSIDE_FUNCTION",
              nodeLocation(graph.graphId, node.nodeId),
              { typeKey: node.typeKey },
            ),
          );
        }
      }

      for (const node of graph.nodes) {
        if (node.typeKey !== FUNCTION_CALL_NODE_TYPE) {
          continue;
        }
        const target = node.properties["functionGraphId"];
        if (!isUuid(target)) {
          this.report(
            buildDiagnostic(
              "FUNCTION_CALL_TARGET_MISSING",
              nodeLocation(graph.graphId, node.nodeId),
            ),
          );
          continue;
        }
        const targetGraph = graphsById.get(target);
        if (!targetGraph) {
          this.report(
            buildDiagnostic(
              "FUNCTION_CALL_TARGET_MISSING",
              nodeLocation(graph.graphId, node.nodeId),
            ),
          );
          continue;
        }
        if (targetGraph.kind !== "function") {
          this.report(
            buildDiagnostic(
              "FUNCTION_CALL_TARGET_NOT_FUNCTION",
              nodeLocation(graph.graphId, node.nodeId),
            ),
          );
          continue;
        }
        const calls = callsByGraph.get(graph.graphId) ?? [];
        calls.push({
          graphId: graph.graphId,
          nodeId: node.nodeId,
          targetGraphId: target,
        });
        callsByGraph.set(graph.graphId, calls);
      }
    }

    const canReach = (
      startGraphId: string,
      targetGraphId: string,
      visited: Set<string>,
    ): boolean => {
      if (startGraphId === targetGraphId) {
        return true;
      }
      if (visited.has(startGraphId)) {
        return false;
      }
      visited.add(startGraphId);
      return (callsByGraph.get(startGraphId) ?? []).some((call) =>
        canReach(call.targetGraphId, targetGraphId, visited),
      );
    };

    const recursiveCalls = new Set<string>();
    for (const graph of document.graphs) {
      for (const call of callsByGraph.get(graph.graphId) ?? []) {
        if (canReach(call.targetGraphId, call.graphId, new Set())) {
          recursiveCalls.add(`${call.graphId}:${call.nodeId}`);
          this.report(
            buildDiagnostic(
              "FUNCTION_RECURSION_FORBIDDEN",
              nodeLocation(call.graphId, call.nodeId),
            ),
          );
        }
      }
    }

    const entryGraph = graphsById.get(document.entryGraphId);
    if (!entryGraph) {
      return;
    }
    const visitedDepthStates = new Set<string>();
    const reportedDepthCalls = new Set<string>();
    const visitDepth = (graphId: string, functionDepth: number): void => {
      const state = `${graphId}:${String(functionDepth)}`;
      if (visitedDepthStates.has(state)) {
        return;
      }
      visitedDepthStates.add(state);
      for (const call of callsByGraph.get(graphId) ?? []) {
        const callKey = `${call.graphId}:${call.nodeId}`;
        if (recursiveCalls.has(callKey)) {
          continue;
        }
        const nextDepth = functionDepth + 1;
        if (nextDepth > 16) {
          if (!reportedDepthCalls.has(callKey)) {
            reportedDepthCalls.add(callKey);
            this.report(
              buildDiagnostic(
                "FUNCTION_CALL_DEPTH_EXCEEDED",
                nodeLocation(call.graphId, call.nodeId),
              ),
            );
          }
          continue;
        }
        visitDepth(call.targetGraphId, nextDepth);
      }
    };
    visitDepth(entryGraph.graphId, 0);
  }

  private checkGraph(graph: GraphV1, document?: RinoProjectDocumentV1): void {
    this.validateVariablePersistence(graph, document);
    const nodesById = new Map<string, NodeV1>();
    for (const node of graph.nodes) {
      if (nodesById.has(node.nodeId)) {
        this.report(
          buildDiagnostic(
            "GRAPH_DUPLICATE_NODE_ID",
            nodeLocation(graph.graphId, node.nodeId),
          ),
        );
      }
      nodesById.set(node.nodeId, node);
    }

    const edgeIds = new Set<string>();
    for (const edge of graph.edges) {
      if (edgeIds.has(edge.edgeId)) {
        this.report(
          buildDiagnostic(
            "GRAPH_DUPLICATE_EDGE_ID",
            edgeLocation(graph.graphId, edge.edgeId),
          ),
        );
      }
      edgeIds.add(edge.edgeId);
    }

    for (const node of graph.nodes) {
      this.validateNode(graph, node, document);
    }

    const connectionCounts = new Map<string, number>();
    for (const edge of graph.edges) {
      this.validateEdge(graph, edge, nodesById, connectionCounts, document);
    }

    this.detectMultipleParallelOnPath(graph, nodesById, document);
    this.validateEntryNodes(graph, nodesById);
    this.validateRequiredInputs(graph, nodesById, document);
    this.detectPureDataCycles(graph, nodesById);
  }

  private validateVariablePersistence(
    graph: GraphV1,
    document?: RinoProjectDocumentV1,
  ): void {
    for (const variable of this.variableDefinitionsForGraph(graph, document)) {
      if (
        document?.variables === undefined &&
        variable.valueKind === "imageRef" &&
        variable.persistent
      ) {
        this.report(
          buildDiagnostic(
            "GRAPH_VARIABLE_PERSISTENCE_UNSUPPORTED",
            graphLocation(graph.graphId),
            {
              variableId: variable.variableId,
              name: variable.name,
              valueKind: variable.valueKind,
            },
          ),
        );
      }
      if (
        document?.variables === undefined &&
        graph.kind === "function" &&
        variable.persistent
      ) {
        this.report(
          buildDiagnostic(
            "FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN",
            graphLocation(graph.graphId),
            {
              variableId: variable.variableId,
              name: variable.name,
            },
          ),
        );
      }
    }
  }

  private resolveNodeDefinition(
    graph: GraphV1,
    node: NodeV1,
    document?: RinoProjectDocumentV1,
  ): EffectiveNodeDefinition | undefined {
    return (
      resolveFunctionNodeDefinition(node, graph, document) ??
      this.registry.find(node.typeKey)
    );
  }

  private validateNode(
    graph: GraphV1,
    node: NodeV1,
    document?: RinoProjectDocumentV1,
  ): void {
    const functionDefinition = resolveFunctionNodeDefinition(
      node,
      graph,
      document,
    );
    const indexed = functionDefinition ?? this.registry.find(node.typeKey);
    if (!indexed) {
      this.report(
        buildDiagnostic(
          "NODE_TYPE_UNKNOWN",
          nodeLocation(graph.graphId, node.nodeId),
          { typeKey: node.typeKey },
        ),
      );
      return;
    }

    if (node.typeVersion > indexed.definition.typeVersion) {
      this.report(
        buildDiagnostic(
          "NODE_TYPE_VERSION_UNSUPPORTED",
          nodeLocation(graph.graphId, node.nodeId),
          {
            typeKey: node.typeKey,
            documentVersion: node.typeVersion,
            registryVersion: indexed.definition.typeVersion,
          },
        ),
      );
    }

    if (indexed.definition.deprecation) {
      this.report(
        buildDiagnostic(
          "NODE_TYPE_DEPRECATED",
          nodeLocation(graph.graphId, node.nodeId),
          { typeKey: node.typeKey },
        ),
      );
    }

    this.validateCapabilities(graph, node, indexed);
    this.validateInputValues(graph, node, indexed);
    this.validateVariableReference(graph, node, document);
  }

  private validateVariableReference(
    graph: GraphV1,
    node: NodeV1,
    document?: RinoProjectDocumentV1,
  ): void {
    const expectedKind = variableValueKindForNodeTypeKey(node.typeKey);
    if (expectedKind === undefined) {
      return;
    }
    const rawVariableId = node.properties["variableId"];
    if (typeof rawVariableId !== "string" || !isUuid(rawVariableId)) {
      return;
    }
    const variable = this.variableDefinitionsForGraph(graph, document).find(
      (candidate) => candidate.variableId === rawVariableId,
    );
    if (variable === undefined) {
      this.report(
        buildDiagnostic(
          "NODE_VARIABLE_UNKNOWN",
          nodeLocation(graph.graphId, node.nodeId),
          { variableId: rawVariableId },
        ),
      );
      return;
    }
    if (variable.valueKind !== expectedKind) {
      this.report(
        buildDiagnostic(
          "NODE_VARIABLE_TYPE_MISMATCH",
          nodeLocation(graph.graphId, node.nodeId),
          {
            variableId: rawVariableId,
            name: variable.name,
            valueKind: variable.valueKind,
          },
        ),
      );
    }
  }

  private validateCapabilities(
    graph: GraphV1,
    node: NodeV1,
    indexed: EffectiveNodeDefinition,
  ): void {
    const available = this.availableCapabilities;
    if (!available) {
      return;
    }
    for (const capability of indexed.definition.requiredCapabilities ?? []) {
      if (!available.has(capability)) {
        this.report(
          buildDiagnostic(
            "NODE_CAPABILITY_UNAVAILABLE",
            nodeLocation(graph.graphId, node.nodeId),
            { typeKey: node.typeKey, capability },
          ),
        );
      }
    }
  }

  private validateInputValues(
    graph: GraphV1,
    node: NodeV1,
    indexed: EffectiveNodeDefinition,
  ): void {
    for (const portId of Object.keys(node.inputValues)) {
      const port = indexed.ports.get(portId);
      if (!port) {
        this.report(
          buildDiagnostic(
            "NODE_INPUT_VALUE_UNKNOWN_PORT",
            portLocation(graph.graphId, node.nodeId, portId),
            { typeKey: node.typeKey },
          ),
        );
        continue;
      }
      // A literal is opt-in per port. Most data types are runtime handles or structured
      // values that have no meaningful inline form, so a definition states where an
      // inline value is allowed rather than every port accepting one by default.
      const acceptsLiteral =
        port.direction === "input" &&
        port.portKind === "data" &&
        port.acceptsLiteral === true;
      if (!acceptsLiteral) {
        this.report(
          buildDiagnostic(
            "NODE_INPUT_VALUE_NOT_ACCEPTED",
            portLocation(graph.graphId, node.nodeId, portId),
            { typeKey: node.typeKey },
          ),
        );
      }
    }
  }

  private validateEdge(
    graph: GraphV1,
    edge: EdgeV1,
    nodesById: ReadonlyMap<string, NodeV1>,
    connectionCounts: Map<string, number>,
    document?: RinoProjectDocumentV1,
  ): void {
    if (edge.sourceNodeId === edge.targetNodeId) {
      this.report(
        buildDiagnostic(
          "EDGE_SELF_CONNECTION",
          edgeLocation(graph.graphId, edge.edgeId),
        ),
      );
      return;
    }

    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    if (!sourceNode) {
      this.report(
        buildDiagnostic(
          "EDGE_SOURCE_NODE_MISSING",
          edgeLocation(graph.graphId, edge.edgeId),
          { nodeId: edge.sourceNodeId },
        ),
      );
    }
    if (!targetNode) {
      this.report(
        buildDiagnostic(
          "EDGE_TARGET_NODE_MISSING",
          edgeLocation(graph.graphId, edge.edgeId),
          { nodeId: edge.targetNodeId },
        ),
      );
    }
    if (!sourceNode || !targetNode) {
      return;
    }

    const sourcePort = this.resolveNodeDefinition(
      graph,
      sourceNode,
      document,
    )?.ports.get(edge.sourcePortId);
    const targetPort = this.resolveNodeDefinition(
      graph,
      targetNode,
      document,
    )?.ports.get(edge.targetPortId);

    if (!sourcePort) {
      this.report(
        buildDiagnostic(
          "EDGE_SOURCE_PORT_MISSING",
          edgeLocation(graph.graphId, edge.edgeId),
          { typeKey: sourceNode.typeKey, portId: edge.sourcePortId },
        ),
      );
    }
    if (!targetPort) {
      this.report(
        buildDiagnostic(
          "EDGE_TARGET_PORT_MISSING",
          edgeLocation(graph.graphId, edge.edgeId),
          { typeKey: targetNode.typeKey, portId: edge.targetPortId },
        ),
      );
    }
    if (!sourcePort || !targetPort) {
      return;
    }

    if (sourcePort.direction !== "output" || targetPort.direction !== "input") {
      this.report(
        buildDiagnostic(
          "EDGE_DIRECTION_INVALID",
          edgeLocation(graph.graphId, edge.edgeId),
        ),
      );
      return;
    }

    if (
      sourcePort.portKind !== targetPort.portKind ||
      sourcePort.portKind !== edge.edgeKind
    ) {
      this.report(
        buildDiagnostic(
          "EDGE_KIND_MISMATCH",
          edgeLocation(graph.graphId, edge.edgeId),
          { edgeKind: edge.edgeKind },
        ),
      );
      return;
    }

    if (!isAssignable(sourcePort.type, targetPort.type)) {
      this.report(
        buildDiagnostic(
          "EDGE_TYPE_INCOMPATIBLE",
          edgeLocation(graph.graphId, edge.edgeId),
          {
            sourceType: describeType(sourcePort.type),
            targetType: describeType(targetPort.type),
          },
        ),
      );
      return;
    }

    this.countConnection(
      graph,
      edge,
      connectionCounts,
      `${edge.sourceNodeId}:${edge.sourcePortId}`,
      sourcePort,
    );
    this.countConnection(
      graph,
      edge,
      connectionCounts,
      `${edge.targetNodeId}:${edge.targetPortId}`,
      targetPort,
    );
  }

  private countConnection(
    graph: GraphV1,
    edge: EdgeV1,
    connectionCounts: Map<string, number>,
    key: string,
    port: PortDefinitionV1,
  ): void {
    const used = (connectionCounts.get(key) ?? 0) + 1;
    connectionCounts.set(key, used);
    if (used > maximumConnections(port)) {
      this.report(
        buildDiagnostic(
          "EDGE_CARDINALITY_EXCEEDED",
          edgeLocation(graph.graphId, edge.edgeId),
          { portId: port.portId, maximum: maximumConnections(port) },
        ),
      );
    }
  }

  /** Reports a second reachable parallel on one execution path.
   *
   * Only edges that resolve to compatible execution ports participate. This keeps
   * malformed and data edges from creating a second, unrelated validation error.
   * The two-state traversal is finite even when an execution graph contains a loop.
   */
  private detectMultipleParallelOnPath(
    graph: GraphV1,
    nodesById: ReadonlyMap<string, NodeV1>,
    document?: RinoProjectDocumentV1,
  ): void {
    const executionAdjacency = new Map<string, string[]>();
    for (const edge of graph.edges) {
      if (!this.isValidExecutionEdge(edge, nodesById, graph, document)) {
        continue;
      }
      const targets = executionAdjacency.get(edge.sourceNodeId);
      if (targets) {
        targets.push(edge.targetNodeId);
      } else {
        executionAdjacency.set(edge.sourceNodeId, [edge.targetNodeId]);
      }
    }

    const entryNodes = [...nodesById.values()].filter(
      (node) =>
        this.resolveNodeDefinition(graph, node, document)?.definition
          .runtimeKind === "entry",
    );
    const pending: (readonly [string, boolean])[] = entryNodes.map((node) => [
      node.nodeId,
      false,
    ]);
    const visited = new Set<string>();
    const reported = new Set<string>();
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

      const node = nodesById.get(nodeId);
      if (!node) {
        continue;
      }
      const isParallel = node.typeKey === "core.flow.parallel";
      if (isParallel && hasSeenParallel && !reported.has(nodeId)) {
        reported.add(nodeId);
        this.report(
          buildDiagnostic(
            "GRAPH_MULTIPLE_PARALLEL_ON_PATH",
            nodeLocation(graph.graphId, nodeId),
            { typeKey: node.typeKey },
          ),
        );
      }

      const nextHasSeenParallel = hasSeenParallel || isParallel;
      for (const targetNodeId of executionAdjacency.get(nodeId) ?? []) {
        pending.push([targetNodeId, nextHasSeenParallel]);
      }
    }
  }

  private isValidExecutionEdge(
    edge: EdgeV1,
    nodesById: ReadonlyMap<string, NodeV1>,
    graph: GraphV1,
    document?: RinoProjectDocumentV1,
  ): boolean {
    if (
      edge.edgeKind !== "execution" ||
      edge.sourceNodeId === edge.targetNodeId
    ) {
      return false;
    }
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    if (!sourceNode || !targetNode) {
      return false;
    }
    const sourcePort = this.resolveNodeDefinition(
      graph,
      sourceNode,
      document,
    )?.ports.get(edge.sourcePortId);
    const targetPort = this.resolveNodeDefinition(
      graph,
      targetNode,
      document,
    )?.ports.get(edge.targetPortId);
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

  private validateEntryNodes(
    graph: GraphV1,
    nodesById: ReadonlyMap<string, NodeV1>,
  ): void {
    if (graph.kind === "function") {
      return;
    }
    if (nodesById.size === 0) {
      return;
    }
    const entryNodes = [...nodesById.values()].filter(
      (node) =>
        this.registry.find(node.typeKey)?.definition.runtimeKind === "entry",
    );

    if (entryNodes.length === 0) {
      this.report(
        buildDiagnostic(
          "GRAPH_ENTRY_NODE_MISSING",
          graphLocation(graph.graphId),
        ),
      );
      return;
    }
    if (entryNodes.length > 1) {
      for (const node of entryNodes.slice(1)) {
        this.report(
          buildDiagnostic(
            "GRAPH_MULTIPLE_ENTRY_NODES",
            nodeLocation(graph.graphId, node.nodeId),
          ),
        );
      }
    }
  }

  private validateRequiredInputs(
    graph: GraphV1,
    nodesById: ReadonlyMap<string, NodeV1>,
    document?: RinoProjectDocumentV1,
  ): void {
    const satisfiedByEdge = new Set<string>();
    for (const edge of graph.edges) {
      satisfiedByEdge.add(`${edge.targetNodeId}:${edge.targetPortId}`);
    }

    for (const node of nodesById.values()) {
      const indexed = this.resolveNodeDefinition(graph, node, document);
      if (!indexed) {
        continue;
      }
      const requiredPortIds = new Set(
        [...indexed.ports.values()]
          .filter(
            (port) =>
              port.direction === "input" &&
              port.portKind === "data" &&
              port.required === true,
          )
          .map((port) => port.portId),
      );
      if (node.typeKey === "automation.clickPoint") {
        for (const portId of requiredClickPointInputPorts(
          node.properties["inputMode"],
        )) {
          requiredPortIds.add(portId);
        }
      }
      if (node.typeKey === "core.diagnostic.log") {
        const segmentKindsValue = node.properties["segmentKinds"];
        const segmentKinds =
          Array.isArray(segmentKindsValue) &&
          segmentKindsValue.length > 0 &&
          segmentKindsValue.every(
            (kind): kind is "text" | "number" =>
              kind === "text" || kind === "number",
          )
            ? segmentKindsValue
            : undefined;
        if (segmentKinds === undefined) {
          requiredPortIds.add("message");
        } else {
          segmentKinds.forEach((kind, index) => {
            requiredPortIds.add(`${kind}Part${(index + 1).toString()}`);
          });
        }
      }
      for (const port of indexed.ports.values()) {
        if (
          port.direction !== "input" ||
          port.portKind !== "data" ||
          !requiredPortIds.has(port.portId)
        ) {
          continue;
        }
        const hasEdge = satisfiedByEdge.has(`${node.nodeId}:${port.portId}`);
        const hasLiteral = Object.hasOwn(node.inputValues, port.portId);
        if (!hasEdge && !hasLiteral) {
          this.report(
            buildDiagnostic(
              "NODE_REQUIRED_INPUT_MISSING",
              portLocation(graph.graphId, node.nodeId, port.portId),
              { typeKey: node.typeKey },
            ),
          );
        }
      }
    }
  }

  /** Reports a cycle among pure nodes reached through data edges.
   *
   * A pure node is evaluated on demand by whoever needs its output, so a cycle between
   * pure nodes has no starting point and would not terminate. Cycles that pass through an
   * execution node are a separate concern handled by the loop constructs.
   */
  private detectPureDataCycles(
    graph: GraphV1,
    nodesById: ReadonlyMap<string, NodeV1>,
  ): void {
    const dependencies = new Map<string, string[]>();
    for (const edge of graph.edges) {
      if (edge.edgeKind !== "data") {
        continue;
      }
      const source = nodesById.get(edge.sourceNodeId);
      if (
        !source ||
        this.registry.find(source.typeKey)?.definition.runtimeKind !== "pure"
      ) {
        continue;
      }
      const existing = dependencies.get(edge.targetNodeId) ?? [];
      existing.push(edge.sourceNodeId);
      dependencies.set(edge.targetNodeId, existing);
    }

    const visiting = new Set<string>();
    const settled = new Set<string>();
    const reported = new Set<string>();

    const visit = (nodeId: string): void => {
      if (settled.has(nodeId)) {
        return;
      }
      if (visiting.has(nodeId)) {
        if (!reported.has(nodeId)) {
          reported.add(nodeId);
          this.report(
            buildDiagnostic(
              "GRAPH_PURE_DATA_CYCLE",
              nodeLocation(graph.graphId, nodeId),
            ),
          );
        }
        return;
      }
      visiting.add(nodeId);
      for (const dependency of dependencies.get(nodeId) ?? []) {
        visit(dependency);
      }
      visiting.delete(nodeId);
      settled.add(nodeId);
    };

    for (const nodeId of nodesById.keys()) {
      visit(nodeId);
    }
  }
}

export function createDocumentValidator(
  registry: RinoNodeRegistrySnapshotV1,
  options: ValidationOptions = {},
): DocumentValidator {
  return new GraphValidator(registry, options);
}

/** Assembles a report from separately produced diagnostics.
 *
 * Reported in one order — document structure first, then graphs in document order — so a
 * full pass and an incremental pass over the same document are indistinguishable.
 */
export function assembleValidationReport(
  diagnostics: GraphDiagnosticV1[],
): ValidationReport {
  const boundedDiagnostics = diagnostics.slice(0, MAXIMUM_GRAPH_DIAGNOSTICS);
  return {
    diagnostics: boundedDiagnostics,
    executable: !boundedDiagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    ),
  };
}

/** Validates a project document against a registry snapshot.
 *
 * This is the editor's preview of validation. The runtime performs the authoritative
 * check before a run; both produce the same codes so a problem shown while editing is
 * the one that blocks execution.
 */
export function validateProjectDocument(
  document: RinoProjectDocumentV1,
  registry: RinoNodeRegistrySnapshotV1,
  options: ValidationOptions = {},
): ValidationReport {
  const validator = createDocumentValidator(registry, options);
  return assembleValidationReport([
    ...validator.validateStructure(document),
    ...document.graphs.flatMap((graph) =>
      validator.validateGraph(graph, document),
    ),
  ]);
}
