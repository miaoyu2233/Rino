import { isValidProjectDocument } from "@rino/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { createEmptyProject } from "../project-factory";
import { readHistoryStatus, useDocumentStore } from "./document-store";
import { useEditorSessionStore } from "./editor-session-store";
import { closeProjectDocument, openProjectDocument } from "./project-lifecycle";

const NODE_ID = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";

function identifierFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `feed0000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
  };
}

function newProject() {
  return createEmptyProject({
    name: "测试项目",
    entryGraphName: "主图",
    createdAt: "2026-07-26T10:00:00Z",
    createIdentifier: identifierFactory(),
  });
}

beforeEach(() => {
  closeProjectDocument();
});

describe("project lifecycle", () => {
  it("creates a document the schema accepts", () => {
    expect(isValidProjectDocument(newProject())).toBe(true);
  });

  it("points the session at the entry graph when a project opens", () => {
    const project = newProject();

    openProjectDocument(project);

    expect(useEditorSessionStore.getState().activeGraphId).toBe(
      project.entryGraphId,
    );
  });

  it("clears both the document and the session when a project closes", () => {
    openProjectDocument(newProject());
    useEditorSessionStore.getState().setSelection([NODE_ID], []);

    closeProjectDocument();

    expect(useDocumentStore.getState().history).toBeUndefined();
    expect(useEditorSessionStore.getState().activeGraphId).toBeUndefined();
    expect(useEditorSessionStore.getState().selectedNodeIds).toEqual([]);
  });
});

describe("commands through the store", () => {
  it("refuses a command while no document is open", () => {
    const outcome = useDocumentStore
      .getState()
      .runCommand("graph.history.moveNode", {
        kind: "moveNode",
        graphId: "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e",
        nodeId: NODE_ID,
        position: { x: 0, y: 0 },
      });

    expect(outcome).toEqual({ ok: false, reason: "noDocument" });
  });

  it("records an applied command and reverses it", () => {
    const project = newProject();
    openProjectDocument(project);
    const store = useDocumentStore.getState();

    const outcome = store.runCommand("graph.history.insertNode", {
      kind: "addNode",
      graphId: project.entryGraphId,
      node: {
        nodeId: NODE_ID,
        typeKey: "core.flow.start",
        typeVersion: 1,
        position: { x: 8, y: 8 },
        properties: {},
        inputValues: {},
      },
    });

    expect(outcome).toEqual({ ok: true });
    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes,
    ).toHaveLength(1);
    expect(
      readHistoryStatus(useDocumentStore.getState().history),
    ).toMatchObject({ canUndo: true, canRedo: false, dirty: true });

    useDocumentStore.getState().undoChange();

    expect(useDocumentStore.getState().history?.document).toEqual(project);
    expect(
      readHistoryStatus(useDocumentStore.getState().history),
    ).toMatchObject({ canUndo: false, canRedo: true, dirty: false });
  });

  it("leaves the document untouched when a command cannot apply", () => {
    const project = newProject();
    openProjectDocument(project);

    const outcome = useDocumentStore
      .getState()
      .runCommand("graph.history.moveNode", {
        kind: "moveNode",
        graphId: project.entryGraphId,
        nodeId: NODE_ID,
        position: { x: 0, y: 0 },
      });

    expect(outcome).toEqual({ ok: false, reason: "nodeMissing" });
    expect(useDocumentStore.getState().history?.document).toBe(project);
  });

  it("blocks commands, undo, and redo while execution owns the graph", () => {
    const project = newProject();
    openProjectDocument(project);
    const store = useDocumentStore.getState();
    expect(
      store.runCommand("graph.history.insertNode", {
        kind: "addNode",
        graphId: project.entryGraphId,
        node: {
          nodeId: NODE_ID,
          typeKey: "core.flow.start",
          typeVersion: 1,
          position: { x: 8, y: 8 },
          properties: {},
          inputValues: {},
        },
      }),
    ).toEqual({ ok: true });
    store.setExecutionLocked(true);
    const lockedDocument = useDocumentStore.getState().history?.document;

    expect(
      useDocumentStore.getState().runCommand("graph.history.moveNode", {
        kind: "moveNode",
        graphId: project.entryGraphId,
        nodeId: NODE_ID,
        position: { x: 16, y: 16 },
      }),
    ).toEqual({ ok: false, reason: "executionLocked" });
    useDocumentStore.getState().undoChange();
    useDocumentStore.getState().redoChange();

    expect(useDocumentStore.getState().history?.document).toBe(lockedDocument);
  });
});

describe("selection reporting", () => {
  it("ignores a repeated report of the same selection", () => {
    openProjectDocument(newProject());
    const session = useEditorSessionStore.getState();
    session.setSelection([NODE_ID], []);
    const afterFirst = useEditorSessionStore.getState().selectedNodeIds;

    useEditorSessionStore.getState().setSelection([NODE_ID], []);

    expect(useEditorSessionStore.getState().selectedNodeIds).toBe(afterFirst);
  });
});
