import type {
  EditorPositionV1,
  GraphV1,
  NodeV1,
  RinoProjectDocumentV1,
} from "@rino/contracts";

import { createIdentifier } from "../../platform/identifiers";
import type { GraphCommand } from "../commands/graph-commands";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import {
  createVariableDefinition,
  variableValueKindForNodeTypeKey,
} from "./variable-authoring";
import type {
  VariableDefinition,
  VariableValueKind,
} from "./variable-authoring";

type VariablePatch = Partial<
  Pick<VariableDefinition, "name" | "persistent" | "valueKind">
>;

interface ActiveGraphContext {
  document: RinoProjectDocumentV1;
  graph: GraphV1;
  node: NodeV1 | undefined;
}

export type VariableNodeInsertRole = "getter" | "setter";

const VARIABLE_NODE_SUFFIXES: Readonly<Record<VariableValueKind, string>> = {
  bool: "Bool",
  number: "Number",
  string: "String",
  point: "Point",
  rect: "Rect",
  imageRef: "ImageRef",
};

const VARIABLE_NODE_ROLE_PREFIXES: Readonly<
  Record<VariableNodeInsertRole, string>
> = {
  getter: "get",
  setter: "set",
};

function activeGraph(nodeId?: string): ActiveGraphContext | undefined {
  const graphId = useEditorSessionStore.getState().activeGraphId;
  if (graphId === undefined) {
    return undefined;
  }
  const document = useDocumentStore.getState().history?.document;
  const graph = document?.graphs.find(
    (candidate) => candidate.graphId === graphId,
  );
  if (document === undefined || graph === undefined) {
    return undefined;
  }
  return {
    document,
    graph,
    node:
      nodeId === undefined
        ? undefined
        : graph.nodes.find((candidate) => candidate.nodeId === nodeId),
  };
}

function runCommand(
  command: GraphCommand,
  label = "graph.history.setVariable",
): boolean {
  return useDocumentStore.getState().runCommand(label, command).ok;
}

function variablesOf(context: ActiveGraphContext): VariableDefinition[] {
  // Graph variables remain a read-only fallback for documents created before project
  // scope existed. New and migrated documents always use document.variables.
  return [...(context.document.variables ?? context.graph.variables ?? [])];
}

function variableCommand(
  context: ActiveGraphContext,
  variables: VariableDefinition[],
): GraphCommand {
  if (
    context.document.variables === undefined &&
    context.graph.variables !== undefined
  ) {
    return {
      kind: "setGraphVariables",
      graphId: context.graph.graphId,
      variables,
    };
  }
  return { kind: "setProjectVariables", variables };
}

function hasVariableReference(
  document: RinoProjectDocumentV1,
  variableId: string,
): boolean {
  return document.graphs.some((graph) =>
    graph.nodes.some((node) => node.properties["variableId"] === variableId),
  );
}

/** Binds a typed variable node to an existing project variable of the same kind. */
export function bindVariable(nodeId: string, variableId: string): boolean {
  const context = activeGraph(nodeId);
  if (context?.node === undefined) {
    return false;
  }
  const valueKind = variableValueKindForNodeTypeKey(context.node.typeKey);
  if (valueKind === undefined) {
    return false;
  }
  const variable = variablesOf(context).find(
    (candidate) => candidate.variableId === variableId,
  );
  if (variable?.valueKind !== valueKind) {
    return false;
  }
  return runCommand({
    kind: "setNodeProperty",
    graphId: context.graph.graphId,
    nodeId,
    propertyKey: "variableId",
    value: variableId,
  });
}

/** Creates one project variable and returns its stable identifier on success. */
export function createProjectVariable(
  valueKind: VariableValueKind,
  name?: string,
): string | undefined {
  const context = activeGraph();
  if (context === undefined) {
    return undefined;
  }
  const variable = createVariableDefinition(
    valueKind,
    variablesOf(context),
    createIdentifier,
  );
  const next = name === undefined ? variable : { ...variable, name };
  return runCommand(variableCommand(context, [...variablesOf(context), next]))
    ? next.variableId
    : undefined;
}

/** Updates project variable metadata; a type change is blocked while any node references it. */
export function updateVariableDefinition(
  variableId: string,
  patch: VariablePatch,
): boolean {
  const context = activeGraph();
  if (context === undefined) {
    return false;
  }
  const variables = variablesOf(context);
  const index = variables.findIndex(
    (candidate) => candidate.variableId === variableId,
  );
  const current = variables[index];
  if (current === undefined) {
    return false;
  }
  if (
    patch.valueKind !== undefined &&
    patch.valueKind !== current.valueKind &&
    hasVariableReference(context.document, variableId)
  ) {
    return false;
  }
  const next: VariableDefinition = {
    ...current,
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.persistent === undefined ? {} : { persistent: patch.persistent }),
    ...(patch.valueKind === undefined ? {} : { valueKind: patch.valueKind }),
  };
  if (next.valueKind === "imageRef" && next.persistent) {
    return false;
  }
  variables[index] = next;
  return runCommand(variableCommand(context, variables));
}

/** Removes an unreferenced project variable in one undoable step. */
export function deleteProjectVariable(variableId: string): boolean {
  const context = activeGraph();
  if (
    context === undefined ||
    !variablesOf(context).some(
      (variable) => variable.variableId === variableId,
    ) ||
    hasVariableReference(context.document, variableId)
  ) {
    return false;
  }
  return runCommand(
    variableCommand(
      context,
      variablesOf(context).filter(
        (variable) => variable.variableId !== variableId,
      ),
    ),
  );
}

/** Inserts a getter or setter bound to a project variable at the requested graph position. */
export function insertVariableNode(
  variableId: string,
  role: VariableNodeInsertRole,
  position: EditorPositionV1,
): string | undefined {
  const context = activeGraph();
  const variable = context
    ? variablesOf(context).find(
        (candidate) => candidate.variableId === variableId,
      )
    : undefined;
  if (context === undefined || variable === undefined) {
    return undefined;
  }
  const nodeId = createIdentifier();
  const suffix = VARIABLE_NODE_SUFFIXES[variable.valueKind];
  const rolePrefix = VARIABLE_NODE_ROLE_PREFIXES[role];
  const node: NodeV1 = {
    nodeId,
    typeKey: `core.variable.${rolePrefix}${suffix}`,
    typeVersion: 1,
    position,
    properties: { variableId },
    inputValues: {},
  };
  return runCommand(
    { kind: "addNode", graphId: context.graph.graphId, node },
    "graph.history.insertVariableNode",
  )
    ? nodeId
    : undefined;
}

/** Creates a same-kind project variable and binds it to a typed variable node atomically. */
export function createAndBindVariable(
  nodeId: string,
  valueKind: VariableValueKind,
): boolean {
  const context = activeGraph(nodeId);
  if (context?.node === undefined) {
    return false;
  }
  if (variableValueKindForNodeTypeKey(context.node.typeKey) !== valueKind) {
    return false;
  }
  const variables = variablesOf(context);
  const variable = createVariableDefinition(
    valueKind,
    variables,
    createIdentifier,
  );
  return runCommand(
    {
      kind: "composite",
      label: "createAndBindVariable",
      commands: [
        variableCommand(context, [...variables, variable]),
        {
          kind: "setNodeProperty",
          graphId: context.graph.graphId,
          nodeId,
          propertyKey: "variableId",
          value: variable.variableId,
        },
      ],
    },
    "graph.history.createAndBindVariable",
  );
}
