import type { GraphV1, NodeV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import {
  bindVariable,
  createAndBindVariable,
  createProjectVariable,
  deleteProjectVariable,
  insertVariableNode,
  updateVariableDefinition,
} from "./variable-commands";

const GRAPH_ID = "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e";
const NODE_ID = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const NUMBER_ID = "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80";
const STRING_ID = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";
const IMAGE_ID = "6a5c9b8f-a3b4-4fc0-9be3-5d6e7f809102";

function variableNode(): NodeV1 {
  return {
    nodeId: NODE_ID,
    typeKey: "core.variable.getNumber",
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
  };
}

function graph(overrides: Partial<GraphV1> = {}): GraphV1 {
  return {
    graphId: GRAPH_ID,
    name: "主图",
    kind: "entry",
    nodes: [variableNode()],
    edges: [],
    ...overrides,
  };
}

function document(
  sourceGraph: GraphV1 = graph(),
  variables?: RinoProjectDocumentV1["variables"],
): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "6a5c9b8f-a3b4-4fc0-9be3-5d6e7f809102",
    metadata: {
      name: "变量测试",
      createdAt: "2026-08-16T00:00:00Z",
      updatedAt: "2026-08-16T00:00:00Z",
    },
    entryGraphId: GRAPH_ID,
    graphs: [sourceGraph],
    assets: [],
    requiredCapabilities: [],
    ...(variables === undefined ? {} : { variables }),
  };
}

function open(
  sourceGraph?: GraphV1,
  variables?: RinoProjectDocumentV1["variables"],
): void {
  useDocumentStore.getState().openDocument(document(sourceGraph, variables));
  useEditorSessionStore.getState().setActiveGraph(GRAPH_ID);
}

function currentGraph(): GraphV1 {
  const current = useDocumentStore
    .getState()
    .history?.document.graphs.find(
      (candidate) => candidate.graphId === GRAPH_ID,
    );
  if (current === undefined) {
    throw new Error("Expected an active graph.");
  }
  return current;
}

describe("variable authoring commands", () => {
  beforeEach(() => {
    useDocumentStore.getState().closeDocument();
    useEditorSessionStore.getState().resetSession();
  });

  it("binds only an existing variable of the node's fixed kind", () => {
    open(
      graph({
        variables: [
          {
            variableId: NUMBER_ID,
            name: "score",
            valueKind: "number",
            persistent: false,
          },
          {
            variableId: STRING_ID,
            name: "label",
            valueKind: "string",
            persistent: false,
          },
          {
            variableId: IMAGE_ID,
            name: "screen",
            valueKind: "imageRef",
            persistent: false,
          },
        ],
      }),
    );

    expect(bindVariable(NODE_ID, NUMBER_ID)).toBe(true);
    expect(bindVariable(NODE_ID, STRING_ID)).toBe(false);
    expect(currentGraph().nodes[0]?.properties["variableId"]).toBe(NUMBER_ID);
  });

  it("updates a name and persistence, while rejecting invalid directory edits", () => {
    open(
      graph({
        variables: [
          {
            variableId: NUMBER_ID,
            name: "score",
            valueKind: "number",
            persistent: false,
          },
          {
            variableId: STRING_ID,
            name: "label",
            valueKind: "string",
            persistent: false,
          },
        ],
      }),
    );

    expect(updateVariableDefinition(NUMBER_ID, { name: "total" })).toBe(true);
    expect(updateVariableDefinition(NUMBER_ID, { persistent: true })).toBe(
      true,
    );
    expect(updateVariableDefinition(NUMBER_ID, { name: "   " })).toBe(false);
    expect(updateVariableDefinition(NUMBER_ID, { name: "label" })).toBe(false);
    expect(updateVariableDefinition("missing-variable", { name: "new" })).toBe(
      false,
    );
    expect(updateVariableDefinition(IMAGE_ID, { persistent: true })).toBe(
      false,
    );
    expect(currentGraph().variables?.[0]).toMatchObject({
      name: "total",
      persistent: true,
    });
  });

  it("creates and binds one variable in one undoable composite", () => {
    open();

    expect(createAndBindVariable(NODE_ID, "number")).toBe(true);
    const created = useDocumentStore.getState().history?.document;
    if (created === undefined) {
      throw new Error("Expected the created document.");
    }
    const createdId = created.variables?.[0]?.variableId;
    expect(createdId).toBeTypeOf("string");
    expect(created.graphs[0]?.nodes[0]?.properties["variableId"]).toBe(
      createdId,
    );

    useDocumentStore.getState().undoChange();
    const undone = currentGraph();
    expect(Object.hasOwn(undone, "variables")).toBe(false);
    expect(Object.hasOwn(undone.nodes[0]?.properties ?? {}, "variableId")).toBe(
      false,
    );

    useDocumentStore.getState().redoChange();
    const redone = useDocumentStore.getState().history?.document;
    if (redone === undefined) {
      throw new Error("Expected the redone document.");
    }
    expect(redone.variables).toHaveLength(1);
    expect(redone.graphs[0]?.nodes[0]?.properties["variableId"]).toBe(
      redone.variables?.[0]?.variableId,
    );
  });

  it("uses one project variable directory for creation, insertion, and reference guards", () => {
    const projectVariable = {
      variableId: NUMBER_ID,
      name: "score",
      valueKind: "number" as const,
      persistent: false,
    };
    open(undefined, [projectVariable]);

    expect(bindVariable(NODE_ID, NUMBER_ID)).toBe(true);
    const createdId = createProjectVariable("string", "label");
    expect(createdId).toBeTypeOf("string");
    expect(currentGraph().variables).toBeUndefined();
    expect(
      insertVariableNode(NUMBER_ID, "getter", { x: 12, y: 24 }),
    ).toBeTypeOf("string");
    expect(currentGraph().nodes).toHaveLength(2);
    expect(updateVariableDefinition(NUMBER_ID, { valueKind: "string" })).toBe(
      false,
    );
    expect(deleteProjectVariable(NUMBER_ID)).toBe(false);
    expect(updateVariableDefinition(NUMBER_ID, { persistent: true })).toBe(
      true,
    );
    expect(useDocumentStore.getState().history?.document.variables).toEqual([
      { ...projectVariable, persistent: true },
      expect.objectContaining({
        variableId: createdId,
        name: "label",
        valueKind: "string",
      }),
    ]);
  });
  it("uses registry getter and setter keys for every variable kind", () => {
    const cases = [
      { valueKind: "bool", suffix: "Bool", id: NUMBER_ID },
      { valueKind: "number", suffix: "Number", id: STRING_ID },
      { valueKind: "string", suffix: "String", id: IMAGE_ID },
      {
        valueKind: "point",
        suffix: "Point",
        id: "7b6dca90-b4c5-4ad1-8e2f-6a7b8c9d0123",
      },
      {
        valueKind: "rect",
        suffix: "Rect",
        id: "8c7edba1-c5d6-4be2-9f30-7b8c9d012345",
      },
      {
        valueKind: "imageRef",
        suffix: "ImageRef",
        id: "9d8fecb2-d6e7-4cf3-a041-8c9d01234567",
      },
    ] as const;

    for (const entry of cases) {
      open(undefined, [
        {
          variableId: entry.id,
          name: `value-${entry.valueKind}`,
          valueKind: entry.valueKind,
          persistent: false,
        },
      ]);
      expect(insertVariableNode(entry.id, "getter", { x: 0, y: 0 })).toBeTypeOf(
        "string",
      );
      expect(
        insertVariableNode(entry.id, "setter", { x: 24, y: 24 }),
      ).toBeTypeOf("string");
      expect(
        currentGraph()
          .nodes.slice(1)
          .map((node) => node.typeKey),
      ).toEqual([
        `core.variable.get${entry.suffix}`,
        `core.variable.set${entry.suffix}`,
      ]);
    }
  });
});
