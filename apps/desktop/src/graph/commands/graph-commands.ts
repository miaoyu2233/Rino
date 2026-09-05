import type {
  EdgeV1,
  EditorPositionV1,
  FunctionParameterV1,
  FunctionSignatureV1,
  GraphCommentV1,
  GraphV1,
  ImageAssetV1,
  NodeV1,
  RepeatHintV1,
  RinoProjectDocumentV1,
  WorkflowGroupV1,
} from "@rino/contracts";

import {
  createAvailableQualifiedAssetDisplayName,
  isAssetDisplayNameAvailable,
  parseQualifiedAssetDisplayName,
  replaceQualifiedAssetVisibleName,
  validateAssetDisplayName,
  validateAssetVisibleName,
} from "../project/asset-names";
import {
  DEFAULT_PROJECT_LICENSE,
  normalizeProjectLicense,
} from "../project-license";
import { normalizeVariableName } from "../variables/variable-authoring";
import type { VariableDefinition } from "../variables/variable-authoring";

/** A value a node property or literal input can hold. */
export type EditableValue = NodeV1["properties"][string];

/** One reversible change to a project document.
 *
 * Commands are data rather than closures so history can be inspected, logged, and later
 * replayed, and so every command has an inverse that is itself an ordinary command.
 */
export type GraphCommand =
  | {
      kind: "addGraph";
      graph: GraphV1;
      /** Where to insert. Absent appends. An inverse records the original index. */
      index?: number;
    }
  | { kind: "removeGraph"; graphId: string }
  | { kind: "renameGraph"; graphId: string; name: string }
  | { kind: "setEntryGraph"; graphId: string }
  | { kind: "setProjectLicense"; licenseIdentifier: string }
  | {
      kind: "setGraphVariables";
      graphId: string;
      /** Omit the field to restore a graph that did not have a variables property. */
      variables?: import("../variables/variable-authoring").VariableDefinition[];
    }
  | {
      kind: "setProjectVariables";
      /** Omit the field to restore a document that did not have a variables property. */
      variables?: import("../variables/variable-authoring").VariableDefinition[];
    }
  | {
      kind: "setFunctionSignature";
      graphId: string;
      signature: FunctionSignatureV1;
    }
  | {
      kind: "addNode";
      graphId: string;
      node: NodeV1;
      /** Where to insert. Absent appends. An inverse records the original index so undo
       * restores the document exactly, and a save after undo produces an identical file
       * rather than a reordered one. */
      index?: number;
    }
  | { kind: "removeNode"; graphId: string; nodeId: string }
  | { kind: "replaceNode"; graphId: string; node: NodeV1 }
  | {
      kind: "moveNode";
      graphId: string;
      nodeId: string;
      position: EditorPositionV1;
    }
  | {
      kind: "addComment";
      graphId: string;
      comment: GraphCommentV1;
      index?: number;
    }
  | { kind: "removeComment"; graphId: string; commentId: string }
  | {
      kind: "replaceComment";
      graphId: string;
      comment: GraphCommentV1;
    }
  | {
      kind: "addRepeatHint";
      graphId: string;
      hint: RepeatHintV1;
      index?: number;
    }
  | {
      kind: "moveRepeatHint";
      graphId: string;
      hintId: string;
      position: EditorPositionV1;
    }
  | { kind: "removeRepeatHint"; graphId: string; hintId: string }
  | { kind: "addEdge"; graphId: string; edge: EdgeV1; index?: number }
  | { kind: "removeEdge"; graphId: string; edgeId: string }
  | {
      kind: "setNodeProperty";
      graphId: string;
      nodeId: string;
      propertyKey: string;
      value?: EditableValue;
    }
  | {
      kind: "setInputValue";
      graphId: string;
      nodeId: string;
      portId: string;
      value?: EditableValue;
    }
  | {
      kind: "setDisplayAlias";
      graphId: string;
      nodeId: string;
      displayAlias?: string;
    }
  | {
      kind: "addWorkflowGroup";
      graphId: string;
      group: WorkflowGroupV1;
      index?: number;
    }
  | { kind: "removeWorkflowGroup"; graphId: string; groupId: string }
  | {
      kind: "replaceWorkflowGroup";
      graphId: string;
      group: WorkflowGroupV1;
    }
  | {
      kind: "setWorkflowGroupCollapsed";
      graphId: string;
      groupId: string;
      collapsed: boolean;
    }
  | {
      kind: "addAsset";
      asset: ImageAssetV1;
      /** Where to insert. Absent appends. An inverse records the original index so undo
       * restores the manifest exactly. */
      index?: number;
    }
  | { kind: "removeAsset"; assetId: string }
  | {
      kind: "setAssetDisplayName";
      assetId: string;
      displayName: string;
      internalName?: boolean;
    }
  | { kind: "composite"; label: string; commands: GraphCommand[] };

/** One user-visible edit expressed as several primitive commands. Named separately so a
 * builder can declare that it always produces a single undo step. */
export type CompositeCommand = Extract<GraphCommand, { kind: "composite" }>;

export type CommandFailureReason =
  | "graphMissing"
  | "graphAlreadyPresent"
  | "graphLimitReached"
  | "graphNameInvalid"
  | "variableLimitReached"
  | "variableIdInvalid"
  | "projectLicenseInvalid"
  | "variableIdDuplicate"
  | "variableNameInvalid"
  | "variableNameDuplicate"
  | "variableKindInvalid"
  | "variablePersistentImageUnsupported"
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
  | "cannotRemoveOnlyGraph"
  | "cannotRemoveEntryGraph"
  | "nodeMissing"
  | "edgeMissing"
  | "nodeAlreadyPresent"
  | "commentMissing"
  | "commentAlreadyPresent"
  | "repeatHintMissing"
  | "repeatHintAlreadyPresent"
  | "repeatHintIdInvalid"
  | "repeatHintPositionInvalid"
  | "repeatHintEdgeMissing"
  | "repeatHintEdgeNotExecution"
  | "repeatHintEdgeAlreadyPresent"
  | "repeatHintLimitReached"
  | "workflowGroupMissing"
  | "workflowGroupAlreadyPresent"
  | "workflowGroupNodeMissing"
  | "nodeAlreadyGrouped"
  | "edgeAlreadyPresent"
  | "assetMissing"
  | "assetAlreadyPresent"
  | "assetNameTaken";

export interface CommandSuccess {
  ok: true;
  document: RinoProjectDocumentV1;
  /** The command that returns the document to its previous state. */
  inverse: GraphCommand;
}

export interface CommandFailure {
  ok: false;
  reason: CommandFailureReason;
}

export type CommandResult = CommandSuccess | CommandFailure;

function failure(reason: CommandFailureReason): CommandFailure {
  return { ok: false, reason };
}

function findGraph(
  document: RinoProjectDocumentV1,
  graphId: string,
): GraphV1 | undefined {
  return document.graphs.find((graph) => graph.graphId === graphId);
}

function replaceGraph(
  document: RinoProjectDocumentV1,
  graph: GraphV1,
): RinoProjectDocumentV1 {
  return {
    ...document,
    graphs: document.graphs.map((candidate) =>
      candidate.graphId === graph.graphId ? graph : candidate,
    ),
  };
}

/** Inserts at an index, or appends when the index is absent or beyond the end. */
function insertAt<T>(
  items: readonly T[],
  item: T,
  index: number | undefined,
): T[] {
  if (index === undefined || index >= items.length) {
    return [...items, item];
  }
  const next = [...items];
  next.splice(Math.max(0, index), 0, item);
  return next;
}

function replaceNode(graph: GraphV1, node: NodeV1): GraphV1 {
  return {
    ...graph,
    nodes: graph.nodes.map((candidate) =>
      candidate.nodeId === node.nodeId ? node : candidate,
    ),
  };
}

function workflowGroups(graph: GraphV1): readonly WorkflowGroupV1[] {
  return graph.editorMetadata?.workflowGroups ?? [];
}

function comments(graph: GraphV1): readonly GraphCommentV1[] {
  return graph.editorMetadata?.comments ?? [];
}

function repeatHints(graph: GraphV1): readonly RepeatHintV1[] {
  return graph.editorMetadata?.repeatHints ?? [];
}

function withComments(
  graph: GraphV1,
  nextComments: readonly GraphCommentV1[],
): GraphV1 {
  const groups = graph.editorMetadata?.workflowGroups;
  const hints = graph.editorMetadata?.repeatHints;
  if (
    nextComments.length === 0 &&
    groups === undefined &&
    hints === undefined
  ) {
    const withoutMetadata = { ...graph };
    delete withoutMetadata.editorMetadata;
    return withoutMetadata;
  }
  return {
    ...graph,
    editorMetadata: {
      ...(nextComments.length === 0 ? {} : { comments: [...nextComments] }),
      ...(groups === undefined ? {} : { workflowGroups: groups }),
      ...(hints === undefined ? {} : { repeatHints: hints }),
    },
  };
}

function withWorkflowGroups(
  graph: GraphV1,
  groups: readonly WorkflowGroupV1[],
): GraphV1 {
  const comments = graph.editorMetadata?.comments;
  const hints = graph.editorMetadata?.repeatHints;
  if (groups.length === 0 && comments === undefined && hints === undefined) {
    const withoutMetadata = { ...graph };
    delete withoutMetadata.editorMetadata;
    return withoutMetadata;
  }
  return {
    ...graph,
    editorMetadata: {
      ...(comments === undefined ? {} : { comments }),
      ...(groups.length === 0 ? {} : { workflowGroups: [...groups] }),
      ...(hints === undefined ? {} : { repeatHints: hints }),
    },
  };
}

function withRepeatHints(
  graph: GraphV1,
  hints: readonly RepeatHintV1[],
): GraphV1 {
  const comments = graph.editorMetadata?.comments;
  const groups = graph.editorMetadata?.workflowGroups;
  if (hints.length === 0 && comments === undefined && groups === undefined) {
    const withoutMetadata = { ...graph };
    delete withoutMetadata.editorMetadata;
    return withoutMetadata;
  }
  return {
    ...graph,
    editorMetadata: {
      ...(comments === undefined ? {} : { comments }),
      ...(groups === undefined ? {} : { workflowGroups: groups }),
      ...(hints.length === 0 ? {} : { repeatHints: [...hints] }),
    },
  };
}

const MAXIMUM_GRAPHS = 64;
const MAXIMUM_GRAPH_NAME_LENGTH = 200;
const MAXIMUM_VARIABLES = 128;
const MAXIMUM_VARIABLE_NAME_CODE_POINTS = 80;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const EDITOR_POSITION_MINIMUM = -1_000_000;
const EDITOR_POSITION_MAXIMUM = 1_000_000;
const MAXIMUM_REPEAT_HINTS = 500;
const VARIABLE_VALUE_KINDS = new Set<VariableDefinition["valueKind"]>([
  "bool",
  "number",
  "string",
  "point",
  "rect",
  "imageRef",
]);

function normalizeGraphName(name: string): string | undefined {
  const normalized = name.trim();
  return normalized.length === 0 ||
    normalized.length > MAXIMUM_GRAPH_NAME_LENGTH
    ? undefined
    : normalized;
}

function hasValidEditorPosition(position: EditorPositionV1): boolean {
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    position.x >= EDITOR_POSITION_MINIMUM &&
    position.x <= EDITOR_POSITION_MAXIMUM &&
    position.y >= EDITOR_POSITION_MINIMUM &&
    position.y <= EDITOR_POSITION_MAXIMUM
  );
}

function validateVariableDefinitions(
  variables: readonly VariableDefinition[],
): CommandFailureReason | undefined {
  if (variables.length > MAXIMUM_VARIABLES) {
    return "variableLimitReached";
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  for (const variable of variables) {
    if (!UUID_PATTERN.test(variable.variableId)) {
      return "variableIdInvalid";
    }
    if (ids.has(variable.variableId)) {
      return "variableIdDuplicate";
    }
    ids.add(variable.variableId);

    const trimmedName = variable.name.trim();
    if (
      trimmedName.length === 0 ||
      !/\S/u.test(trimmedName) ||
      Array.from(variable.name).length > MAXIMUM_VARIABLE_NAME_CODE_POINTS
    ) {
      return "variableNameInvalid";
    }
    const normalizedName = normalizeVariableName(variable.name);
    if (names.has(normalizedName)) {
      return "variableNameDuplicate";
    }
    names.add(normalizedName);

    if (!VARIABLE_VALUE_KINDS.has(variable.valueKind)) {
      return "variableKindInvalid";
    }
    if (variable.valueKind === "imageRef" && variable.persistent) {
      return "variablePersistentImageUnsupported";
    }
  }
  return undefined;
}

const FUNCTION_PARAMETER_VALUE_KINDS = new Set<
  FunctionParameterV1["valueKind"]
>(["bool", "number", "string", "point", "rect", "imageRef"]);
const FUNCTION_PARAMETER_PORT_PATTERN = /^[a-z][a-zA-Z0-9]*$/u;
const MAXIMUM_FUNCTION_PARAMETERS = 16;
const MAXIMUM_FUNCTION_PARAMETER_NAME_CODE_POINTS = 80;

function normalizeFunctionParameterName(name: string): string {
  return name.normalize("NFKC").trim();
}

function normalizeFunctionParameterKey(name: string): string {
  return normalizeFunctionParameterName(name).toLocaleLowerCase("en-US");
}

function cloneFunctionParameter(
  parameter: FunctionParameterV1,
): FunctionParameterV1 {
  return { ...parameter };
}

function cloneFunctionSignature(
  signature: FunctionSignatureV1,
): FunctionSignatureV1 {
  return {
    inputs: signature.inputs.map(
      cloneFunctionParameter,
    ) as FunctionSignatureV1["inputs"],
    outputs: signature.outputs.map(
      cloneFunctionParameter,
    ) as FunctionSignatureV1["outputs"],
  };
}

function validateFunctionSignature(
  signature: FunctionSignatureV1,
): CommandFailureReason | undefined {
  const directions = [signature.inputs, signature.outputs];
  const parameterIds = new Set<string>();
  const portIds = new Set<string>();
  const names = new Set<string>();

  for (const parameters of directions) {
    if (parameters.length > MAXIMUM_FUNCTION_PARAMETERS) {
      return "functionParameterLimitReached";
    }
    for (const parameter of parameters) {
      if (!UUID_PATTERN.test(parameter.parameterId)) {
        return "functionParameterIdInvalid";
      }
      if (parameterIds.has(parameter.parameterId)) {
        return "functionParameterIdDuplicate";
      }
      parameterIds.add(parameter.parameterId);

      if (
        !FUNCTION_PARAMETER_PORT_PATTERN.test(parameter.portId) ||
        parameter.portId.length > 64
      ) {
        return "functionParameterPortIdInvalid";
      }
      if (parameter.portId === "run" || parameter.portId === "next") {
        return "functionParameterPortIdReserved";
      }
      if (portIds.has(parameter.portId)) {
        return "functionParameterPortIdDuplicate";
      }
      portIds.add(parameter.portId);

      const normalizedName = normalizeFunctionParameterName(parameter.name);
      if (
        normalizedName.length === 0 ||
        Array.from(normalizedName).length >
          MAXIMUM_FUNCTION_PARAMETER_NAME_CODE_POINTS
      ) {
        return "functionParameterNameInvalid";
      }
      const nameKey = normalizeFunctionParameterKey(parameter.name);
      if (names.has(nameKey)) {
        return "functionParameterNameDuplicate";
      }
      names.add(nameKey);

      if (!FUNCTION_PARAMETER_VALUE_KINDS.has(parameter.valueKind)) {
        return "functionParameterKindInvalid";
      }
    }
  }
  return undefined;
}

function applySetFunctionSignature(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "setFunctionSignature" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  if (graph.kind !== "function") {
    return failure("graphNotFunction");
  }
  if (graph.functionSignature === undefined) {
    return failure("functionSignatureMissing");
  }
  const invalid = validateFunctionSignature(command.signature);
  if (invalid !== undefined) {
    return failure(invalid);
  }
  return {
    ok: true,
    document: replaceGraph(document, {
      ...graph,
      functionSignature: cloneFunctionSignature(command.signature),
    }),
    inverse: {
      kind: "setFunctionSignature",
      graphId: command.graphId,
      signature: cloneFunctionSignature(graph.functionSignature),
    },
  };
}

function applyAddGraph(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "addGraph" }>,
): CommandResult {
  if (
    document.graphs.some((graph) => graph.graphId === command.graph.graphId)
  ) {
    return failure("graphAlreadyPresent");
  }
  if (document.graphs.length >= MAXIMUM_GRAPHS) {
    return failure("graphLimitReached");
  }
  const name = normalizeGraphName(command.graph.name);
  if (name === undefined) {
    return failure("graphNameInvalid");
  }
  const graph =
    name === command.graph.name ? command.graph : { ...command.graph, name };
  const index =
    command.index === undefined
      ? document.graphs.length
      : Math.min(Math.max(0, command.index), document.graphs.length);
  return {
    ok: true,
    document: {
      ...document,
      graphs: insertAt(document.graphs, graph, index),
    },
    inverse: { kind: "removeGraph", graphId: graph.graphId },
  };
}

function applyRemoveGraph(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "removeGraph" }>,
): CommandResult {
  const graphIndex = document.graphs.findIndex(
    (graph) => graph.graphId === command.graphId,
  );
  const graph = document.graphs[graphIndex];
  if (!graph) {
    return failure("graphMissing");
  }
  if (document.graphs.length === 1) {
    return failure("cannotRemoveOnlyGraph");
  }
  if (document.entryGraphId === command.graphId) {
    return failure("cannotRemoveEntryGraph");
  }
  return {
    ok: true,
    document: {
      ...document,
      graphs: document.graphs.filter(
        (candidate) => candidate.graphId !== command.graphId,
      ),
    },
    inverse: { kind: "addGraph", graph, index: graphIndex },
  };
}

function applyRenameGraph(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "renameGraph" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const name = normalizeGraphName(command.name);
  if (name === undefined) {
    return failure("graphNameInvalid");
  }
  return {
    ok: true,
    document: replaceGraph(document, { ...graph, name }),
    inverse: {
      kind: "renameGraph",
      graphId: command.graphId,
      name: graph.name,
    },
  };
}

function applySetEntryGraph(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "setEntryGraph" }>,
): CommandResult {
  if (!findGraph(document, command.graphId)) {
    return failure("graphMissing");
  }
  return {
    ok: true,
    document: { ...document, entryGraphId: command.graphId },
    inverse: { kind: "setEntryGraph", graphId: document.entryGraphId },
  };
}

function applySetProjectLicense(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "setProjectLicense" }>,
): CommandResult {
  const licenseIdentifier = normalizeProjectLicense(command.licenseIdentifier);
  if (licenseIdentifier === undefined) {
    return failure("projectLicenseInvalid");
  }

  return {
    ok: true,
    document: {
      ...document,
      metadata: { ...document.metadata, licenseIdentifier },
    },
    inverse: {
      kind: "setProjectLicense",
      licenseIdentifier:
        document.metadata.licenseIdentifier ?? DEFAULT_PROJECT_LICENSE,
    },
  };
}

function applySetProjectVariables(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "setProjectVariables" }>,
): CommandResult {
  if (command.variables !== undefined) {
    const invalid = validateVariableDefinitions(command.variables);
    if (invalid !== undefined) {
      return failure(invalid);
    }
  }

  const previousHasVariables = Object.hasOwn(document, "variables");
  const nextDocument = { ...document };
  if (command.variables === undefined) {
    delete nextDocument.variables;
  } else {
    nextDocument.variables = command.variables.map((variable) => ({
      ...variable,
    }));
  }

  const inverse: GraphCommand =
    previousHasVariables && document.variables !== undefined
      ? {
          kind: "setProjectVariables",
          variables: document.variables.map((variable) => ({ ...variable })),
        }
      : { kind: "setProjectVariables" };

  return { ok: true, document: nextDocument, inverse };
}

function applySetGraphVariables(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "setGraphVariables" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }

  if (command.variables !== undefined) {
    const invalid = validateVariableDefinitions(command.variables);
    if (invalid !== undefined) {
      return failure(invalid);
    }
  }

  const previousHasVariables = Object.hasOwn(graph, "variables");
  const nextGraph = { ...graph };
  if (command.variables === undefined) {
    delete nextGraph.variables;
  } else {
    nextGraph.variables = command.variables.map((variable) => ({
      ...variable,
    }));
  }

  const inverse: GraphCommand =
    previousHasVariables && graph.variables !== undefined
      ? {
          kind: "setGraphVariables",
          graphId: command.graphId,
          variables: graph.variables.map((variable) => ({ ...variable })),
        }
      : { kind: "setGraphVariables", graphId: command.graphId };

  return {
    ok: true,
    document: replaceGraph(document, nextGraph),
    inverse,
  };
}

function groupCanBeStored(
  graph: GraphV1,
  group: WorkflowGroupV1,
  replacingGroupId?: string,
): CommandFailureReason | undefined {
  const nodeIds = new Set(graph.nodes.map((node) => node.nodeId));
  if (group.members.some((member) => !nodeIds.has(member.nodeId))) {
    return "workflowGroupNodeMissing";
  }
  const claimed = new Set(
    workflowGroups(graph)
      .filter((candidate) => candidate.groupId !== replacingGroupId)
      .flatMap((candidate) => candidate.members.map((member) => member.nodeId)),
  );
  if (group.members.some((member) => claimed.has(member.nodeId))) {
    return "nodeAlreadyGrouped";
  }
  return undefined;
}

/** Assigns an optional field, omitting it entirely when the value is absent.
 *
 * The document type distinguishes an absent optional field from one present with an
 * undefined value, and only the absent form round-trips through the canonical schema.
 */
function withOptional<T extends object>(
  base: T,
  key: string,
  value: EditableValue | string | undefined,
): T {
  if (value === undefined) {
    return Object.fromEntries(
      Object.entries(base).filter(([candidate]) => candidate !== key),
    ) as T;
  }
  return { ...base, [key]: value };
}

function applyAddNode(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "addNode" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  if (graph.nodes.some((node) => node.nodeId === command.node.nodeId)) {
    return failure("nodeAlreadyPresent");
  }
  return {
    ok: true,
    document: replaceGraph(document, {
      ...graph,
      nodes: insertAt(graph.nodes, command.node, command.index),
    }),
    inverse: {
      kind: "removeNode",
      graphId: command.graphId,
      nodeId: command.node.nodeId,
    },
  };
}

function applyRemoveNode(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "removeNode" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const nodeIndex = graph.nodes.findIndex(
    (candidate) => candidate.nodeId === command.nodeId,
  );
  const node = graph.nodes[nodeIndex];
  if (!node) {
    return failure("nodeMissing");
  }

  // Removing a node also removes the connections that would otherwise dangle, so the
  // inverse restores the node together with every edge that was attached to it. The
  // detached edges are restored in ascending original index, which reproduces their
  // original arrangement exactly.
  const detached = graph.edges
    .map((edge, index) => ({ edge, index }))
    .filter(
      ({ edge }) =>
        edge.sourceNodeId === command.nodeId ||
        edge.targetNodeId === command.nodeId,
    );
  const detachedEdgeIds = new Set(detached.map(({ edge }) => edge.edgeId));
  const hintsBefore = repeatHints(graph);
  const detachedHints = hintsBefore
    .map((hint, index) => ({ hint, index }))
    .filter(({ hint }) => detachedEdgeIds.has(hint.edgeId));
  const hintsAfter = hintsBefore.filter(
    (hint) => !detachedEdgeIds.has(hint.edgeId),
  );

  const groupsBefore = workflowGroups(graph);
  const affectedGroups = groupsBefore
    .map((group, index) => ({ group, index }))
    .filter(({ group }) =>
      group.members.some((member) => member.nodeId === command.nodeId),
    );
  const groupsAfter = groupsBefore.flatMap((group) => {
    const members = group.members.filter(
      (member) => member.nodeId !== command.nodeId,
    );
    if (members.length === 0) {
      return [];
    }
    return [
      {
        ...group,
        members: members as WorkflowGroupV1["members"],
        exposedPorts: group.exposedPorts.filter(
          (port) => port.nodeId !== command.nodeId,
        ),
      },
    ];
  });

  const graphWithoutNode = withRepeatHints(
    withWorkflowGroups(
      {
        ...graph,
        nodes: graph.nodes.filter(
          (candidate) => candidate.nodeId !== command.nodeId,
        ),
        edges: graph.edges.filter(
          (edge) =>
            edge.sourceNodeId !== command.nodeId &&
            edge.targetNodeId !== command.nodeId,
        ),
      },
      groupsAfter,
    ),
    hintsAfter,
  );

  return {
    ok: true,
    document: replaceGraph(document, graphWithoutNode),
    inverse: {
      kind: "composite",
      label: "restoreNode",
      commands: [
        { kind: "addNode", graphId: command.graphId, node, index: nodeIndex },
        ...detached.map(({ edge, index }): GraphCommand => ({
          kind: "addEdge",
          graphId: command.graphId,
          edge,
          index,
        })),
        ...detachedHints.map(({ hint, index }): GraphCommand => ({
          kind: "addRepeatHint",
          graphId: command.graphId,
          hint,
          index,
        })),
        ...affectedGroups.map(({ group, index }): GraphCommand =>
          groupsAfter.some((candidate) => candidate.groupId === group.groupId)
            ? { kind: "replaceWorkflowGroup", graphId: graph.graphId, group }
            : {
                kind: "addWorkflowGroup",
                graphId: graph.graphId,
                group,
                index,
              },
        ),
      ],
    },
  };
}

function applyReplaceNode(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "replaceNode" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const previous = graph.nodes.find(
    (candidate) => candidate.nodeId === command.node.nodeId,
  );
  if (!previous) {
    return failure("nodeMissing");
  }
  return {
    ok: true,
    document: replaceGraph(document, replaceNode(graph, command.node)),
    inverse: { kind: "replaceNode", graphId: command.graphId, node: previous },
  };
}

function applyMoveNode(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "moveNode" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const node = graph.nodes.find(
    (candidate) => candidate.nodeId === command.nodeId,
  );
  if (!node) {
    return failure("nodeMissing");
  }
  return {
    ok: true,
    document: replaceGraph(
      document,
      replaceNode(graph, { ...node, position: command.position }),
    ),
    inverse: {
      kind: "moveNode",
      graphId: command.graphId,
      nodeId: command.nodeId,
      position: node.position,
    },
  };
}

function applyAddComment(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "addComment" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const existing = comments(graph);
  if (
    existing.some((comment) => comment.commentId === command.comment.commentId)
  ) {
    return failure("commentAlreadyPresent");
  }
  return {
    ok: true,
    document: replaceGraph(
      document,
      withComments(graph, insertAt(existing, command.comment, command.index)),
    ),
    inverse: {
      kind: "removeComment",
      graphId: command.graphId,
      commentId: command.comment.commentId,
    },
  };
}

function applyRemoveComment(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "removeComment" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const existing = comments(graph);
  const index = existing.findIndex(
    (comment) => comment.commentId === command.commentId,
  );
  const comment = existing[index];
  if (!comment) {
    return failure("commentMissing");
  }
  return {
    ok: true,
    document: replaceGraph(
      document,
      withComments(
        graph,
        existing.filter(
          (candidate) => candidate.commentId !== command.commentId,
        ),
      ),
    ),
    inverse: {
      kind: "addComment",
      graphId: command.graphId,
      comment,
      index,
    },
  };
}

function applyReplaceComment(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "replaceComment" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const existing = comments(graph);
  const previous = existing.find(
    (comment) => comment.commentId === command.comment.commentId,
  );
  if (!previous) {
    return failure("commentMissing");
  }
  return {
    ok: true,
    document: replaceGraph(
      document,
      withComments(
        graph,
        existing.map((comment) =>
          comment.commentId === command.comment.commentId
            ? command.comment
            : comment,
        ),
      ),
    ),
    inverse: {
      kind: "replaceComment",
      graphId: command.graphId,
      comment: previous,
    },
  };
}

function applyAddRepeatHint(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "addRepeatHint" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  if (!UUID_PATTERN.test(command.hint.hintId)) {
    return failure("repeatHintIdInvalid");
  }
  if (!hasValidEditorPosition(command.hint.position)) {
    return failure("repeatHintPositionInvalid");
  }
  const hints = repeatHints(graph);
  if (hints.length >= MAXIMUM_REPEAT_HINTS) {
    return failure("repeatHintLimitReached");
  }
  if (hints.some((hint) => hint.hintId === command.hint.hintId)) {
    return failure("repeatHintAlreadyPresent");
  }
  if (hints.some((hint) => hint.edgeId === command.hint.edgeId)) {
    return failure("repeatHintEdgeAlreadyPresent");
  }
  const edge = graph.edges.find(
    (candidate) => candidate.edgeId === command.hint.edgeId,
  );
  if (!edge) {
    return failure("repeatHintEdgeMissing");
  }
  if (edge.edgeKind !== "execution") {
    return failure("repeatHintEdgeNotExecution");
  }
  return {
    ok: true,
    document: replaceGraph(
      document,
      withRepeatHints(graph, insertAt(hints, command.hint, command.index)),
    ),
    inverse: {
      kind: "removeRepeatHint",
      graphId: command.graphId,
      hintId: command.hint.hintId,
    },
  };
}

function applyMoveRepeatHint(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "moveRepeatHint" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  if (!hasValidEditorPosition(command.position)) {
    return failure("repeatHintPositionInvalid");
  }
  const hints = repeatHints(graph);
  const hint = hints.find((candidate) => candidate.hintId === command.hintId);
  if (!hint) {
    return failure("repeatHintMissing");
  }
  return {
    ok: true,
    document: replaceGraph(
      document,
      withRepeatHints(
        graph,
        hints.map((candidate) =>
          candidate.hintId === command.hintId
            ? { ...candidate, position: command.position }
            : candidate,
        ),
      ),
    ),
    inverse: {
      kind: "moveRepeatHint",
      graphId: command.graphId,
      hintId: command.hintId,
      position: hint.position,
    },
  };
}

function applyRemoveRepeatHint(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "removeRepeatHint" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const hints = repeatHints(graph);
  const index = hints.findIndex((hint) => hint.hintId === command.hintId);
  const hint = hints[index];
  if (!hint) {
    return failure("repeatHintMissing");
  }
  return {
    ok: true,
    document: replaceGraph(
      document,
      withRepeatHints(
        graph,
        hints.filter((candidate) => candidate.hintId !== command.hintId),
      ),
    ),
    inverse: {
      kind: "addRepeatHint",
      graphId: command.graphId,
      hint,
      index,
    },
  };
}

function applyAddEdge(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "addEdge" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  if (graph.edges.some((edge) => edge.edgeId === command.edge.edgeId)) {
    return failure("edgeAlreadyPresent");
  }
  return {
    ok: true,
    document: replaceGraph(document, {
      ...graph,
      edges: insertAt(graph.edges, command.edge, command.index),
    }),
    inverse: {
      kind: "removeEdge",
      graphId: command.graphId,
      edgeId: command.edge.edgeId,
    },
  };
}

function applyRemoveEdge(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "removeEdge" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const edgeIndex = graph.edges.findIndex(
    (candidate) => candidate.edgeId === command.edgeId,
  );
  const edge = graph.edges[edgeIndex];
  if (!edge) {
    return failure("edgeMissing");
  }
  const removedHints = repeatHints(graph)
    .map((hint, index) => ({ hint, index }))
    .filter(({ hint }) => hint.edgeId === command.edgeId);
  const graphWithoutEdge = withRepeatHints(
    {
      ...graph,
      edges: graph.edges.filter(
        (candidate) => candidate.edgeId !== command.edgeId,
      ),
    },
    repeatHints(graph).filter((hint) => hint.edgeId !== command.edgeId),
  );
  const inverse: GraphCommand =
    removedHints.length === 0
      ? {
          kind: "addEdge",
          graphId: command.graphId,
          edge,
          index: edgeIndex,
        }
      : {
          kind: "composite",
          label: "restoreEdgeAndRepeatHints",
          commands: [
            {
              kind: "addEdge",
              graphId: command.graphId,
              edge,
              index: edgeIndex,
            },
            ...removedHints.map(({ hint, index }): GraphCommand => ({
              kind: "addRepeatHint",
              graphId: command.graphId,
              hint,
              index,
            })),
          ],
        };
  return {
    ok: true,
    document: replaceGraph(document, graphWithoutEdge),
    inverse,
  };
}

function applySetNodeProperty(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "setNodeProperty" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const node = graph.nodes.find(
    (candidate) => candidate.nodeId === command.nodeId,
  );
  if (!node) {
    return failure("nodeMissing");
  }

  const previous = Object.hasOwn(node.properties, command.propertyKey)
    ? node.properties[command.propertyKey]
    : undefined;
  const properties = withOptional(
    node.properties,
    command.propertyKey,
    command.value,
  );

  return {
    ok: true,
    document: replaceGraph(
      document,
      replaceNode(graph, { ...node, properties }),
    ),
    inverse: withOptional(
      {
        kind: "setNodeProperty" as const,
        graphId: command.graphId,
        nodeId: command.nodeId,
        propertyKey: command.propertyKey,
      },
      "value",
      previous,
    ),
  };
}

function applySetInputValue(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "setInputValue" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const node = graph.nodes.find(
    (candidate) => candidate.nodeId === command.nodeId,
  );
  if (!node) {
    return failure("nodeMissing");
  }

  const previous = Object.hasOwn(node.inputValues, command.portId)
    ? node.inputValues[command.portId]
    : undefined;
  const inputValues = withOptional(
    node.inputValues,
    command.portId,
    command.value,
  );

  return {
    ok: true,
    document: replaceGraph(
      document,
      replaceNode(graph, { ...node, inputValues }),
    ),
    inverse: withOptional(
      {
        kind: "setInputValue" as const,
        graphId: command.graphId,
        nodeId: command.nodeId,
        portId: command.portId,
      },
      "value",
      previous,
    ),
  };
}

function applySetDisplayAlias(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "setDisplayAlias" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const node = graph.nodes.find(
    (candidate) => candidate.nodeId === command.nodeId,
  );
  if (!node) {
    return failure("nodeMissing");
  }

  // The alias is presentation metadata: the type key, ports, and identity are untouched,
  // so renaming a node can never change what the graph executes.
  const updated = withOptional(node, "displayAlias", command.displayAlias);

  return {
    ok: true,
    document: replaceGraph(document, replaceNode(graph, updated)),
    inverse: withOptional(
      {
        kind: "setDisplayAlias" as const,
        graphId: command.graphId,
        nodeId: command.nodeId,
      },
      "displayAlias",
      node.displayAlias,
    ),
  };
}

function applyAddWorkflowGroup(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "addWorkflowGroup" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const groups = workflowGroups(graph);
  if (groups.some((group) => group.groupId === command.group.groupId)) {
    return failure("workflowGroupAlreadyPresent");
  }
  const invalid = groupCanBeStored(graph, command.group);
  if (invalid !== undefined) {
    return failure(invalid);
  }
  return {
    ok: true,
    document: replaceGraph(
      document,
      withWorkflowGroups(graph, insertAt(groups, command.group, command.index)),
    ),
    inverse: {
      kind: "removeWorkflowGroup",
      graphId: command.graphId,
      groupId: command.group.groupId,
    },
  };
}

function applyRemoveWorkflowGroup(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "removeWorkflowGroup" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const groups = workflowGroups(graph);
  const index = groups.findIndex((group) => group.groupId === command.groupId);
  const group = groups[index];
  if (!group) {
    return failure("workflowGroupMissing");
  }
  return {
    ok: true,
    document: replaceGraph(
      document,
      withWorkflowGroups(
        graph,
        groups.filter((candidate) => candidate.groupId !== command.groupId),
      ),
    ),
    inverse: {
      kind: "addWorkflowGroup",
      graphId: command.graphId,
      group,
      index,
    },
  };
}

function applyReplaceWorkflowGroup(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "replaceWorkflowGroup" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const groups = workflowGroups(graph);
  const previous = groups.find(
    (group) => group.groupId === command.group.groupId,
  );
  if (!previous) {
    return failure("workflowGroupMissing");
  }
  const invalid = groupCanBeStored(graph, command.group, command.group.groupId);
  if (invalid !== undefined) {
    return failure(invalid);
  }
  return {
    ok: true,
    document: replaceGraph(
      document,
      withWorkflowGroups(
        graph,
        groups.map((group) =>
          group.groupId === command.group.groupId ? command.group : group,
        ),
      ),
    ),
    inverse: {
      kind: "replaceWorkflowGroup",
      graphId: command.graphId,
      group: previous,
    },
  };
}

function applySetWorkflowGroupCollapsed(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "setWorkflowGroupCollapsed" }>,
): CommandResult {
  const graph = findGraph(document, command.graphId);
  if (!graph) {
    return failure("graphMissing");
  }
  const group = workflowGroups(graph).find(
    (candidate) => candidate.groupId === command.groupId,
  );
  if (!group) {
    return failure("workflowGroupMissing");
  }
  return applyReplaceWorkflowGroup(document, {
    kind: "replaceWorkflowGroup",
    graphId: command.graphId,
    group: { ...group, collapsed: command.collapsed },
  });
}

function applyAddAsset(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "addAsset" }>,
): CommandResult {
  if (
    document.assets.some((asset) => asset.assetId === command.asset.assetId)
  ) {
    return failure("assetAlreadyPresent");
  }
  // Uniqueness is decided on the normalized name, so an image cannot be added under a
  // name the user could not tell apart from one already in the project.
  if (
    !isAssetDisplayNameAvailable(command.asset.displayName, document.assets)
  ) {
    return failure("assetNameTaken");
  }
  return {
    ok: true,
    document: {
      ...document,
      assets: insertAt(document.assets, command.asset, command.index),
    },
    inverse: { kind: "removeAsset", assetId: command.asset.assetId },
  };
}

function applyRemoveAsset(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "removeAsset" }>,
): CommandResult {
  const assetIndex = document.assets.findIndex(
    (candidate) => candidate.assetId === command.assetId,
  );
  const asset = document.assets[assetIndex];
  if (!asset) {
    return failure("assetMissing");
  }
  return {
    ok: true,
    document: {
      ...document,
      assets: document.assets.filter(
        (candidate) => candidate.assetId !== command.assetId,
      ),
    },
    inverse: { kind: "addAsset", asset, index: assetIndex },
  };
}

function applySetAssetDisplayName(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "setAssetDisplayName" }>,
): CommandResult {
  const asset = document.assets.find(
    (candidate) => candidate.assetId === command.assetId,
  );
  if (!asset) {
    return failure("assetMissing");
  }
  const validation = command.internalName
    ? validateAssetDisplayName(command.displayName)
    : validateAssetVisibleName(command.displayName);
  if (!validation.ok) {
    return failure("assetNameTaken");
  }
  const currentQualifiedName = parseQualifiedAssetDisplayName(
    asset.displayName,
  );
  const preferredDisplayName = command.internalName
    ? validation.displayName
    : replaceQualifiedAssetVisibleName(
        asset.displayName,
        validation.displayName,
      );
  const storedDisplayName =
    !command.internalName &&
    currentQualifiedName !== undefined &&
    !isAssetDisplayNameAvailable(
      preferredDisplayName,
      document.assets,
      command.assetId,
    )
      ? createAvailableQualifiedAssetDisplayName(
          currentQualifiedName.installationCode,
          validation.displayName,
          document.assets.filter(
            (candidate) => candidate.assetId !== command.assetId,
          ),
        )
      : preferredDisplayName;
  if (
    !isAssetDisplayNameAvailable(
      storedDisplayName,
      document.assets,
      command.assetId,
    )
  ) {
    return failure("assetNameTaken");
  }
  // Nodes reference an asset by its identifier, so a rename never breaks a graph.
  return {
    ok: true,
    document: {
      ...document,
      assets: document.assets.map((candidate) =>
        candidate.assetId === command.assetId
          ? { ...candidate, displayName: storedDisplayName }
          : candidate,
      ),
    },
    inverse: {
      kind: "setAssetDisplayName",
      assetId: command.assetId,
      displayName: asset.displayName,
      internalName: true,
    },
  };
}

function applyComposite(
  document: RinoProjectDocumentV1,
  command: Extract<GraphCommand, { kind: "composite" }>,
): CommandResult {
  let current = document;
  const inverses: GraphCommand[] = [];

  for (const step of command.commands) {
    const outcome = applyCommand(current, step);
    if (!outcome.ok) {
      // A composite is all or nothing: a partially applied group would leave the graph in
      // a state the user never asked for and could not undo as one action.
      return outcome;
    }
    current = outcome.document;
    inverses.unshift(outcome.inverse);
  }

  return {
    ok: true,
    document: current,
    inverse: { kind: "composite", label: command.label, commands: inverses },
  };
}

/** Applies one command, returning the new document and the command that undoes it. */
export function applyCommand(
  document: RinoProjectDocumentV1,
  command: GraphCommand,
): CommandResult {
  switch (command.kind) {
    case "addGraph":
      return applyAddGraph(document, command);
    case "removeGraph":
      return applyRemoveGraph(document, command);
    case "renameGraph":
      return applyRenameGraph(document, command);
    case "setProjectLicense":
      return applySetProjectLicense(document, command);
    case "setEntryGraph":
      return applySetEntryGraph(document, command);
    case "setProjectVariables":
      return applySetProjectVariables(document, command);
    case "setGraphVariables":
      return applySetGraphVariables(document, command);
    case "setFunctionSignature":
      return applySetFunctionSignature(document, command);
    case "addNode":
      return applyAddNode(document, command);
    case "removeNode":
      return applyRemoveNode(document, command);
    case "replaceNode":
      return applyReplaceNode(document, command);
    case "moveNode":
      return applyMoveNode(document, command);
    case "addComment":
      return applyAddComment(document, command);
    case "removeComment":
      return applyRemoveComment(document, command);
    case "replaceComment":
      return applyReplaceComment(document, command);
    case "addRepeatHint":
      return applyAddRepeatHint(document, command);
    case "moveRepeatHint":
      return applyMoveRepeatHint(document, command);
    case "removeRepeatHint":
      return applyRemoveRepeatHint(document, command);
    case "addEdge":
      return applyAddEdge(document, command);
    case "removeEdge":
      return applyRemoveEdge(document, command);
    case "setNodeProperty":
      return applySetNodeProperty(document, command);
    case "setInputValue":
      return applySetInputValue(document, command);
    case "setDisplayAlias":
      return applySetDisplayAlias(document, command);
    case "addWorkflowGroup":
      return applyAddWorkflowGroup(document, command);
    case "removeWorkflowGroup":
      return applyRemoveWorkflowGroup(document, command);
    case "replaceWorkflowGroup":
      return applyReplaceWorkflowGroup(document, command);
    case "setWorkflowGroupCollapsed":
      return applySetWorkflowGroupCollapsed(document, command);
    case "addAsset":
      return applyAddAsset(document, command);
    case "removeAsset":
      return applyRemoveAsset(document, command);
    case "setAssetDisplayName":
      return applySetAssetDisplayName(document, command);
    case "composite":
      return applyComposite(document, command);
    default: {
      const unhandled: never = command;
      return unhandled;
    }
  }
}
