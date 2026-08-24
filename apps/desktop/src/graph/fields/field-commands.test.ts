import type { NodeV1 } from "@rino/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { createEmptyProject } from "../project-factory";
import { useDocumentStore } from "../store/document-store";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../store/project-lifecycle";
import {
  commitDisplayAlias,
  commitInputLiteral,
  commitNodeProperty,
} from "./field-commands";

const NODE = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";

function compareNode(): NodeV1 {
  return {
    nodeId: NODE,
    typeKey: "core.logic.numberCompare",
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: { operator: "greaterThan" },
    inputValues: { right: 100 },
  };
}

function openProjectWithNode(): void {
  const project = createEmptyProject({
    name: "test",
    entryGraphName: "main",
    createdAt: "2026-07-26T00:00:00.000Z",
  });
  openProjectDocument(project);
  useDocumentStore.getState().runCommand("graph.history.insertNode", {
    kind: "addNode",
    graphId: project.entryGraphId,
    node: compareNode(),
  });
}

function storedNode(): NodeV1 {
  const node = useDocumentStore
    .getState()
    .history?.document.graphs[0]?.nodes.find(
      (candidate) => candidate.nodeId === NODE,
    );
  if (!node) {
    throw new Error("The graph should contain the node.");
  }
  return node;
}

describe("field commands", () => {
  beforeEach(() => {
    closeProjectDocument();
  });

  it("writes and removes a property", () => {
    openProjectWithNode();

    expect(commitNodeProperty(NODE, "operator", "lessThan")).toBe(true);
    expect(storedNode().properties["operator"]).toBe("lessThan");

    expect(commitNodeProperty(NODE, "operator", undefined)).toBe(true);
    expect(Object.hasOwn(storedNode().properties, "operator")).toBe(false);
  });

  it("writes and clears an inline literal under distinct history labels", () => {
    openProjectWithNode();

    commitInputLiteral(NODE, "right", 42);
    expect(storedNode().inputValues["right"]).toBe(42);
    expect(useDocumentStore.getState().history?.undoable.at(-1)?.label).toBe(
      "graph.history.setInputValue",
    );

    commitInputLiteral(NODE, "right", undefined);
    expect(Object.hasOwn(storedNode().inputValues, "right")).toBe(false);
    expect(useDocumentStore.getState().history?.undoable.at(-1)?.label).toBe(
      "graph.history.clearInputValue",
    );
  });

  it("trims an alias and removes it when only spaces remain", () => {
    openProjectWithNode();

    commitDisplayAlias(NODE, "  血量判断  ");
    expect(storedNode().displayAlias).toBe("血量判断");

    commitDisplayAlias(NODE, "   ");
    expect(storedNode().displayAlias).toBeUndefined();
  });

  it("refuses an edit while no graph is active", () => {
    expect(commitNodeProperty(NODE, "operator", "lessThan")).toBe(false);
    expect(commitInputLiteral(NODE, "right", 1)).toBe(false);
    expect(commitDisplayAlias(NODE, "name")).toBe(false);
  });

  it("reports a refused command rather than reporting success", () => {
    openProjectWithNode();

    expect(commitNodeProperty("missing-node", "operator", "lessThan")).toBe(
      false,
    );
  });
});
