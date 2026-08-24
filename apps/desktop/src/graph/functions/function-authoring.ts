import type {
  EdgeV1,
  EditorPositionV1,
  FunctionParameterV1,
  FunctionSignatureV1,
  GraphV1,
  NodeV1,
  RinoProjectDocumentV1,
} from "@rino/contracts";

import type {
  CommandFailureReason,
  GraphCommand,
} from "../commands/graph-commands";

export type FunctionParameterDirection = "input" | "output";
export type FunctionParameterKind = FunctionParameterV1["valueKind"];
export type FunctionIdentifierFactory = () => string;

export type FunctionAuthoringFailureReason =
  | Extract<
      CommandFailureReason,
      | "graphMissing"
      | "graphLimitReached"
      | "graphNotFunction"
      | "functionSignatureMissing"
      | "functionParameterLimitReached"
      | "functionParameterIdInvalid"
      | "functionParameterIdDuplicate"
      | "functionParameterPortIdInvalid"
      | "functionParameterPortIdReserved"
      | "functionParameterPortIdDuplicate"
      | "functionParameterNameInvalid"
      | "functionParameterNameDuplicate"
      | "functionParameterKindInvalid"
    >
  | "nameInvalid"
  | "notFunction"
  | "parameterMissing"
  | "directionInvalid"
  | "identifierInvalid"
  | "identifierDuplicate"
  | "targetGraphMissing"
  | "targetNotFunction"
  | "selfCall"
  | "recursion"
  | "depthLimit";

export type FunctionAuthoringResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: FunctionAuthoringFailureReason };

export interface BuiltFunctionGraphCommand {
  command: Extract<GraphCommand, { kind: "addGraph" }>;
  functionGraphId: string;
}

export interface BuiltFunctionCallCommand {
  command: Extract<GraphCommand, { kind: "addNode" }>;
  nodeId: string;
}

export interface BuiltFunctionParameterCommand {
  command: GraphCommand;
  parameter: FunctionParameterV1;
  parameterId: string;
  portId: string;
}

export interface BuiltFunctionParameterEditCommand {
  command: GraphCommand;
  parameterId: string;
}

const MAXIMUM_FUNCTION_GRAPHS = 64;
const MAXIMUM_FUNCTION_PARAMETERS = 16;
const MAXIMUM_FUNCTION_NAME_CODE_POINTS = 200;
const MAXIMUM_PARAMETER_NAME_CODE_POINTS = 80;
const MAXIMUM_STATIC_FUNCTION_DEPTH = 16;
const MAXIMUM_PORT_IDENTIFIER_ATTEMPTS = 64;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PARAMETER_KINDS = new Set<FunctionParameterKind>([
  "bool",
  "number",
  "string",
  "point",
  "rect",
  "imageRef",
]);

function failure<T>(
  reason: FunctionAuthoringFailureReason,
): FunctionAuthoringResult<T> {
  return { ok: false, reason };
}

function normalizeGraphName(name: string): string | undefined {
  const normalized = name.normalize("NFKC").trim();
  return normalized.length === 0 ||
    Array.from(normalized).length > MAXIMUM_FUNCTION_NAME_CODE_POINTS
    ? undefined
    : normalized;
}

function normalizeParameterName(name: string): string | undefined {
  const normalized = name.normalize("NFKC").trim();
  return normalized.length === 0 ||
    Array.from(normalized).length > MAXIMUM_PARAMETER_NAME_CODE_POINTS
    ? undefined
    : normalized;
}

function parameterNameKey(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function findGraph(
  document: RinoProjectDocumentV1,
  graphId: string,
): GraphV1 | undefined {
  return document.graphs.find((graph) => graph.graphId === graphId);
}

function cloneParameter(parameter: FunctionParameterV1): FunctionParameterV1 {
  return { ...parameter };
}

function cloneSignature(signature: FunctionSignatureV1): FunctionSignatureV1 {
  return {
    inputs: signature.inputs.map(
      cloneParameter,
    ) as FunctionSignatureV1["inputs"],
    outputs: signature.outputs.map(
      cloneParameter,
    ) as FunctionSignatureV1["outputs"],
  };
}

function signatureWith(
  signature: FunctionSignatureV1,
  direction: FunctionParameterDirection,
  parameters: readonly FunctionParameterV1[],
): FunctionSignatureV1 {
  return {
    inputs: (direction === "input"
      ? parameters
      : signature.inputs.map(cloneParameter)) as FunctionSignatureV1["inputs"],
    outputs: (direction === "output"
      ? parameters
      : signature.outputs.map(
          cloneParameter,
        )) as FunctionSignatureV1["outputs"],
  };
}

function signatureParameters(
  signature: FunctionSignatureV1,
): readonly FunctionParameterV1[] {
  return [...signature.inputs, ...signature.outputs];
}

function parameterAt(
  signature: FunctionSignatureV1,
  parameterId: string,
  direction?: FunctionParameterDirection,
):
  | {
      direction: FunctionParameterDirection;
      index: number;
      parameter: FunctionParameterV1;
    }
  | undefined {
  const directions: readonly FunctionParameterDirection[] = direction
    ? [direction]
    : ["input", "output"];
  for (const candidateDirection of directions) {
    const parameters =
      candidateDirection === "input" ? signature.inputs : signature.outputs;
    const index = parameters.findIndex(
      (parameter) => parameter.parameterId === parameterId,
    );
    const parameter = parameters[index];
    if (parameter !== undefined) {
      return { direction: candidateDirection, index, parameter };
    }
  }
  return undefined;
}

function context(
  document: RinoProjectDocumentV1,
  graphId: string,
):
  | { ok: true; graph: GraphV1; signature: FunctionSignatureV1 }
  | { ok: false; reason: FunctionAuthoringFailureReason } {
  const graph = findGraph(document, graphId);
  if (graph === undefined) {
    return { ok: false, reason: "graphMissing" };
  }
  if (graph.kind !== "function") {
    return { ok: false, reason: "notFunction" };
  }
  if (graph.functionSignature === undefined) {
    return { ok: false, reason: "functionSignatureMissing" };
  }
  return {
    ok: true,
    graph,
    signature: cloneSignature(graph.functionSignature),
  };
}

function collectIdentifiers(document: RinoProjectDocumentV1): Set<string> {
  const identifiers = new Set<string>([document.documentId]);
  for (const graph of document.graphs) {
    identifiers.add(graph.graphId);
    for (const node of graph.nodes) identifiers.add(node.nodeId);
    for (const edge of graph.edges) identifiers.add(edge.edgeId);
    for (const variable of graph.variables ?? [])
      identifiers.add(variable.variableId);
    for (const parameter of signatureParameters(
      graph.functionSignature ?? { inputs: [], outputs: [] },
    )) {
      identifiers.add(parameter.parameterId);
      identifiers.add(parameter.portId);
    }
    for (const comment of graph.editorMetadata?.comments ?? [])
      identifiers.add(comment.commentId);
    for (const group of graph.editorMetadata?.workflowGroups ?? [])
      identifiers.add(group.groupId);
    for (const hint of graph.editorMetadata?.repeatHints ?? [])
      identifiers.add(hint.hintId);
  }
  for (const asset of document.assets) identifiers.add(asset.assetId);
  return identifiers;
}

function allocateIdentifier(
  createIdentifier: FunctionIdentifierFactory,
  used: Set<string>,
):
  | { ok: true; value: string }
  | { ok: false; reason: "identifierInvalid" | "identifierDuplicate" } {
  const identifier = createIdentifier();
  if (!UUID_PATTERN.test(identifier))
    return { ok: false, reason: "identifierInvalid" };
  if (used.has(identifier)) return { ok: false, reason: "identifierDuplicate" };
  used.add(identifier);
  return { ok: true, value: identifier };
}

function portIdentifierFromEntropy(identifier: string): string {
  return `p${identifier.replace(/-/gu, "").toLowerCase()}`;
}

function allocatePortIdentifier(
  createIdentifier: FunctionIdentifierFactory,
  used: Set<string>,
):
  | { ok: true; value: string }
  | { ok: false; reason: "identifierInvalid" | "identifierDuplicate" } {
  for (
    let attempt = 0;
    attempt < MAXIMUM_PORT_IDENTIFIER_ATTEMPTS;
    attempt += 1
  ) {
    const entropy = createIdentifier();
    if (!UUID_PATTERN.test(entropy))
      return { ok: false, reason: "identifierInvalid" };
    const portId = portIdentifierFromEntropy(entropy);
    if (used.has(portId)) continue;
    used.add(portId);
    return { ok: true, value: portId };
  }
  return { ok: false, reason: "identifierDuplicate" };
}

function addSignatureCommand(
  graphId: string,
  signature: FunctionSignatureV1,
): Extract<GraphCommand, { kind: "setFunctionSignature" }> {
  return { kind: "setFunctionSignature", graphId, signature };
}

function functionCallTarget(node: NodeV1): string | undefined {
  if (node.typeKey !== "core.function.call") return undefined;
  const target = node.properties["functionGraphId"];
  return typeof target === "string" ? target : undefined;
}

function functionCallEdges(
  document: RinoProjectDocumentV1,
  targetGraphId: string,
  direction: FunctionParameterDirection,
  portId: string,
): { graphId: string; edge: EdgeV1 }[] {
  const calls = new Map<string, Set<string>>();
  for (const graph of document.graphs) {
    for (const node of graph.nodes) {
      if (functionCallTarget(node) === targetGraphId) {
        const graphCalls = calls.get(graph.graphId) ?? new Set<string>();
        graphCalls.add(node.nodeId);
        calls.set(graph.graphId, graphCalls);
      }
    }
  }
  return document.graphs.flatMap((graph) => {
    const callIds = calls.get(graph.graphId);
    if (callIds === undefined) return [];
    return graph.edges
      .filter(
        (edge) =>
          edge.edgeKind === "data" &&
          ((direction === "input" &&
            callIds.has(edge.targetNodeId) &&
            edge.targetPortId === portId) ||
            (direction === "output" &&
              callIds.has(edge.sourceNodeId) &&
              edge.sourcePortId === portId)),
      )
      .map((edge) => ({ graphId: graph.graphId, edge }));
  });
}

function boundaryEdges(
  graph: GraphV1,
  direction: FunctionParameterDirection,
  portId: string,
): EdgeV1[] {
  const boundaryType =
    direction === "input" ? "core.function.input" : "core.function.return";
  const boundaryIds = new Set(
    graph.nodes
      .filter((node) => node.typeKey === boundaryType)
      .map((node) => node.nodeId),
  );
  return graph.edges.filter(
    (edge) =>
      edge.edgeKind === "data" &&
      ((direction === "input" &&
        boundaryIds.has(edge.sourceNodeId) &&
        edge.sourcePortId === portId) ||
        (direction === "output" &&
          boundaryIds.has(edge.targetNodeId) &&
          edge.targetPortId === portId)),
  );
}

function cleanupParameterCommands(
  document: RinoProjectDocumentV1,
  functionGraph: GraphV1,
  direction: FunctionParameterDirection,
  portId: string,
): GraphCommand[] {
  const edgesToRemove = new Map<string, { graphId: string; edge: EdgeV1 }>();
  for (const edge of boundaryEdges(functionGraph, direction, portId)) {
    edgesToRemove.set(`${functionGraph.graphId}:${edge.edgeId}`, {
      graphId: functionGraph.graphId,
      edge,
    });
  }
  for (const detached of functionCallEdges(
    document,
    functionGraph.graphId,
    direction,
    portId,
  )) {
    edgesToRemove.set(`${detached.graphId}:${detached.edge.edgeId}`, detached);
  }

  const commands: GraphCommand[] = [...edgesToRemove.values()].map(
    ({ graphId, edge }) => ({
      kind: "removeEdge",
      graphId,
      edgeId: edge.edgeId,
    }),
  );

  const affectedNodes = new Map<string, { graphId: string; node: NodeV1 }>();
  const boundaryType =
    direction === "input" ? "core.function.input" : "core.function.return";
  for (const node of functionGraph.nodes) {
    if (node.typeKey === boundaryType) {
      affectedNodes.set(`${functionGraph.graphId}:${node.nodeId}`, {
        graphId: functionGraph.graphId,
        node,
      });
    }
  }
  for (const graph of document.graphs) {
    for (const node of graph.nodes) {
      if (functionCallTarget(node) === functionGraph.graphId) {
        affectedNodes.set(`${graph.graphId}:${node.nodeId}`, {
          graphId: graph.graphId,
          node,
        });
      }
    }
  }
  for (const { graphId, node } of affectedNodes.values()) {
    if (Object.hasOwn(node.inputValues, portId)) {
      commands.push({
        kind: "setInputValue",
        graphId,
        nodeId: node.nodeId,
        portId,
      });
    }
  }
  return commands;
}

function callGraphAdjacency(
  document: RinoProjectDocumentV1,
  extra?: { ownerGraphId: string; targetGraphId: string },
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const graph of document.graphs) {
    if (graph.kind !== "function" && graph.graphId !== document.entryGraphId)
      continue;
    adjacency.set(graph.graphId, []);
    for (const node of graph.nodes) {
      const target = functionCallTarget(node);
      if (
        target !== undefined &&
        findGraph(document, target)?.kind === "function"
      ) {
        adjacency.get(graph.graphId)?.push(target);
      }
    }
  }
  if (extra !== undefined) {
    const targets = adjacency.get(extra.ownerGraphId) ?? [];
    adjacency.set(extra.ownerGraphId, [...targets, extra.targetGraphId]);
  }
  return adjacency;
}

function reaches(
  adjacency: ReadonlyMap<string, readonly string[]>,
  start: string,
  target: string,
): boolean {
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

function exceedsStaticDepth(
  adjacency: ReadonlyMap<string, readonly string[]>,
): boolean {
  const visit = (
    graphId: string,
    depth: number,
    stack: ReadonlySet<string>,
  ): boolean => {
    if (depth > MAXIMUM_STATIC_FUNCTION_DEPTH) return true;
    if (stack.has(graphId)) return false;
    const nextStack = new Set(stack).add(graphId);
    return (adjacency.get(graphId) ?? []).some((target) =>
      visit(target, depth + 1, nextStack),
    );
  };
  return [...adjacency.keys()].some((graphId) => visit(graphId, 0, new Set()));
}

function parseParameterSelection(
  directionOrParameterId: string,
  parameterIdOrValue: string,
  maybeValue: string | undefined,
):
  | {
      direction?: FunctionParameterDirection;
      parameterId: string;
      value: string;
    }
  | { reason: "directionInvalid" } {
  if (maybeValue === undefined) {
    return {
      parameterId: directionOrParameterId,
      value: parameterIdOrValue,
    };
  }
  if (
    directionOrParameterId !== "input" &&
    directionOrParameterId !== "output"
  ) {
    return { reason: "directionInvalid" };
  }
  return {
    direction: directionOrParameterId,
    parameterId: parameterIdOrValue,
    value: maybeValue,
  };
}

export function buildCreateFunctionGraphCommand(
  document: RinoProjectDocumentV1,
  name: string,
  createIdentifier: FunctionIdentifierFactory,
): FunctionAuthoringResult<BuiltFunctionGraphCommand> {
  const normalizedName = normalizeGraphName(name);
  if (normalizedName === undefined) return failure("nameInvalid");
  if (document.graphs.length >= MAXIMUM_FUNCTION_GRAPHS) {
    return failure("graphLimitReached");
  }
  const used = collectIdentifiers(document);
  const graphId = allocateIdentifier(createIdentifier, used);
  if (!graphId.ok) return failure(graphId.reason);
  const inputNodeId = allocateIdentifier(createIdentifier, used);
  if (!inputNodeId.ok) return failure(inputNodeId.reason);
  const returnNodeId = allocateIdentifier(createIdentifier, used);
  if (!returnNodeId.ok) return failure(returnNodeId.reason);
  const graph: GraphV1 = {
    graphId: graphId.value,
    name: normalizedName,
    kind: "function",
    functionSignature: { inputs: [], outputs: [] },
    nodes: [
      {
        nodeId: inputNodeId.value,
        typeKey: "core.function.input",
        typeVersion: 1,
        position: { x: 0, y: 0 },
        properties: {},
        inputValues: {},
      },
      {
        nodeId: returnNodeId.value,
        typeKey: "core.function.return",
        typeVersion: 1,
        position: { x: 360, y: 0 },
        properties: {},
        inputValues: {},
      },
    ],
    edges: [],
  };
  return {
    ok: true,
    value: {
      command: { kind: "addGraph", graph },
      functionGraphId: graphId.value,
    },
  };
}

export function buildInsertFunctionCallCommand(
  document: RinoProjectDocumentV1,
  ownerGraphId: string,
  targetFunctionGraphId: string,
  position: EditorPositionV1,
  createIdentifier: FunctionIdentifierFactory,
): FunctionAuthoringResult<BuiltFunctionCallCommand> {
  const owner = findGraph(document, ownerGraphId);
  if (owner === undefined) return failure("graphMissing");
  const target = findGraph(document, targetFunctionGraphId);
  if (target === undefined) return failure("targetGraphMissing");
  if (target.kind !== "function") return failure("targetNotFunction");
  if (target.functionSignature === undefined)
    return failure("functionSignatureMissing");
  if (ownerGraphId === targetFunctionGraphId) return failure("selfCall");

  const adjacency = callGraphAdjacency(document, {
    ownerGraphId,
    targetGraphId: targetFunctionGraphId,
  });
  if (reaches(adjacency, targetFunctionGraphId, ownerGraphId)) {
    return failure("recursion");
  }
  if (exceedsStaticDepth(adjacency)) return failure("depthLimit");

  const nodeId = allocateIdentifier(
    createIdentifier,
    collectIdentifiers(document),
  );
  if (!nodeId.ok) return failure(nodeId.reason);
  const node: NodeV1 = {
    nodeId: nodeId.value,
    typeKey: "core.function.call",
    typeVersion: 1,
    position: { ...position },
    properties: { functionGraphId: targetFunctionGraphId },
    inputValues: {},
  };
  return {
    ok: true,
    value: {
      command: { kind: "addNode", graphId: ownerGraphId, node },
      nodeId: nodeId.value,
    },
  };
}

export function buildAddFunctionParameterCommand(
  document: RinoProjectDocumentV1,
  graphId: string,
  direction: string,
  name: string,
  valueKind: FunctionParameterKind,
  createIdentifier: FunctionIdentifierFactory,
): FunctionAuthoringResult<BuiltFunctionParameterCommand> {
  const current = context(document, graphId);
  if (!current.ok) return failure(current.reason);
  if (direction !== "input" && direction !== "output")
    return failure("directionInvalid");
  const currentParameters =
    direction === "input"
      ? current.signature.inputs
      : current.signature.outputs;
  if (currentParameters.length >= MAXIMUM_FUNCTION_PARAMETERS) {
    return failure("functionParameterLimitReached");
  }
  const normalizedName = normalizeParameterName(name);
  if (normalizedName === undefined)
    return failure("functionParameterNameInvalid");
  if (!PARAMETER_KINDS.has(valueKind))
    return failure("functionParameterKindInvalid");
  if (
    signatureParameters(current.signature).some(
      (parameter) =>
        parameterNameKey(parameter.name) === parameterNameKey(normalizedName),
    )
  ) {
    return failure("functionParameterNameDuplicate");
  }
  const used = collectIdentifiers(document);
  const parameterId = allocateIdentifier(createIdentifier, used);
  if (!parameterId.ok) return failure(parameterId.reason);
  const portId = allocatePortIdentifier(createIdentifier, used);
  if (!portId.ok) return failure(portId.reason);
  const parameter: FunctionParameterV1 = {
    parameterId: parameterId.value,
    portId: portId.value,
    name: normalizedName,
    valueKind,
  };
  const nextParameters = [...currentParameters, parameter];
  return {
    ok: true,
    value: {
      command: addSignatureCommand(
        graphId,
        signatureWith(current.signature, direction, nextParameters),
      ),
      parameter,
      parameterId: parameter.parameterId,
      portId: parameter.portId,
    },
  };
}

export function buildRenameFunctionParameterCommand(
  document: RinoProjectDocumentV1,
  graphId: string,
  parameterId: string,
  name: string,
): FunctionAuthoringResult<BuiltFunctionParameterEditCommand>;
export function buildRenameFunctionParameterCommand(
  document: RinoProjectDocumentV1,
  graphId: string,
  direction: FunctionParameterDirection,
  parameterId: string,
  name: string,
): FunctionAuthoringResult<BuiltFunctionParameterEditCommand>;
export function buildRenameFunctionParameterCommand(
  document: RinoProjectDocumentV1,
  graphId: string,
  directionOrParameterId: string,
  parameterIdOrName: string,
  maybeName?: string,
): FunctionAuthoringResult<BuiltFunctionParameterEditCommand> {
  const parsed = parseParameterSelection(
    directionOrParameterId,
    parameterIdOrName,
    maybeName,
  );
  if ("reason" in parsed) return failure(parsed.reason);
  const current = context(document, graphId);
  if (!current.ok) return failure(current.reason);
  const selected = parameterAt(
    current.signature,
    parsed.parameterId,
    parsed.direction,
  );
  if (selected === undefined) return failure("parameterMissing");
  const normalizedName = normalizeParameterName(parsed.value);
  if (normalizedName === undefined)
    return failure("functionParameterNameInvalid");
  if (
    signatureParameters(current.signature).some(
      (parameter) =>
        parameter.parameterId !== selected.parameter.parameterId &&
        parameterNameKey(parameter.name) === parameterNameKey(normalizedName),
    )
  ) {
    return failure("functionParameterNameDuplicate");
  }
  const parameters = [
    ...(selected.direction === "input"
      ? current.signature.inputs
      : current.signature.outputs),
  ];
  parameters[selected.index] = { ...selected.parameter, name: normalizedName };
  return {
    ok: true,
    value: {
      command: addSignatureCommand(
        graphId,
        signatureWith(current.signature, selected.direction, parameters),
      ),
      parameterId: selected.parameter.parameterId,
    },
  };
}

export function buildChangeFunctionParameterKindCommand(
  document: RinoProjectDocumentV1,
  graphId: string,
  parameterId: string,
  valueKind: FunctionParameterKind,
): FunctionAuthoringResult<BuiltFunctionParameterEditCommand>;
export function buildChangeFunctionParameterKindCommand(
  document: RinoProjectDocumentV1,
  graphId: string,
  direction: FunctionParameterDirection,
  parameterId: string,
  valueKind: FunctionParameterKind,
): FunctionAuthoringResult<BuiltFunctionParameterEditCommand>;
export function buildChangeFunctionParameterKindCommand(
  document: RinoProjectDocumentV1,
  graphId: string,
  directionOrParameterId: string,
  parameterIdOrKind: string,
  maybeKind?: FunctionParameterKind,
): FunctionAuthoringResult<BuiltFunctionParameterEditCommand> {
  const parsed = parseParameterSelection(
    directionOrParameterId,
    parameterIdOrKind,
    maybeKind,
  );
  if ("reason" in parsed) return failure(parsed.reason);
  const current = context(document, graphId);
  if (!current.ok) return failure(current.reason);
  const selected = parameterAt(
    current.signature,
    parsed.parameterId,
    parsed.direction,
  );
  if (selected === undefined) return failure("parameterMissing");
  if (!PARAMETER_KINDS.has(parsed.value as FunctionParameterKind)) {
    return failure("functionParameterKindInvalid");
  }
  const nextKind = parsed.value as FunctionParameterKind;
  const parameters = [
    ...(selected.direction === "input"
      ? current.signature.inputs
      : current.signature.outputs),
  ];
  parameters[selected.index] = { ...selected.parameter, valueKind: nextKind };
  const nextSignature = signatureWith(
    current.signature,
    selected.direction,
    parameters,
  );
  const commands =
    selected.parameter.valueKind === nextKind
      ? [addSignatureCommand(graphId, nextSignature)]
      : [
          ...cleanupParameterCommands(
            document,
            current.graph,
            selected.direction,
            selected.parameter.portId,
          ),
          addSignatureCommand(graphId, nextSignature),
        ];
  return {
    ok: true,
    value: {
      command: {
        kind: "composite",
        label: "changeFunctionParameter",
        commands,
      },
      parameterId: selected.parameter.parameterId,
    },
  };
}

export function buildRemoveFunctionParameterCommand(
  document: RinoProjectDocumentV1,
  graphId: string,
  parameterId: string,
): FunctionAuthoringResult<BuiltFunctionParameterEditCommand>;
export function buildRemoveFunctionParameterCommand(
  document: RinoProjectDocumentV1,
  graphId: string,
  direction: FunctionParameterDirection,
  parameterId: string,
): FunctionAuthoringResult<BuiltFunctionParameterEditCommand>;
export function buildRemoveFunctionParameterCommand(
  document: RinoProjectDocumentV1,
  graphId: string,
  directionOrParameterId: string,
  maybeParameterId?: string,
): FunctionAuthoringResult<BuiltFunctionParameterEditCommand> {
  const direction =
    maybeParameterId === undefined ? undefined : directionOrParameterId;
  if (
    direction !== undefined &&
    direction !== "input" &&
    direction !== "output"
  ) {
    return failure("directionInvalid");
  }
  const parameterId = maybeParameterId ?? directionOrParameterId;
  const current = context(document, graphId);
  if (!current.ok) return failure(current.reason);
  const selected = parameterAt(current.signature, parameterId, direction);
  if (selected === undefined) return failure("parameterMissing");
  const currentParameters =
    selected.direction === "input"
      ? current.signature.inputs
      : current.signature.outputs;
  const nextParameters = currentParameters.filter(
    (parameter) => parameter.parameterId !== selected.parameter.parameterId,
  );
  const nextSignature = signatureWith(
    current.signature,
    selected.direction,
    nextParameters,
  );
  const commands = [
    ...cleanupParameterCommands(
      document,
      current.graph,
      selected.direction,
      selected.parameter.portId,
    ),
    addSignatureCommand(graphId, nextSignature),
  ];
  return {
    ok: true,
    value: {
      command: {
        kind: "composite",
        label: "removeFunctionParameter",
        commands,
      },
      parameterId: selected.parameter.parameterId,
    },
  };
}
