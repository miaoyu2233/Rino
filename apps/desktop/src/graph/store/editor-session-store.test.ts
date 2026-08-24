import { beforeEach, describe, expect, it } from "vitest";

import { useEditorSessionStore } from "./editor-session-store";

beforeEach(() => {
  useEditorSessionStore.getState().resetSession();
});

describe("active task session", () => {
  it("clears node and edge selection while preserving the clipboard", () => {
    const clipboard = {
      nodes: [],
      edges: [],
      workflowGroups: [],
    };
    const session = useEditorSessionStore.getState();
    session.setClipboard(clipboard);
    session.setSelection(["node-1"], ["edge-1"]);

    useEditorSessionStore.getState().setActiveGraph("task-2");

    expect(useEditorSessionStore.getState()).toMatchObject({
      activeGraphId: "task-2",
      selectedNodeIds: [],
      selectedEdgeIds: [],
      clipboard,
    });
  });

  it("does not put active-task changes into document session state", () => {
    useEditorSessionStore.getState().setActiveGraph("task-1");
    useEditorSessionStore.getState().setActiveGraph("task-2");

    expect(useEditorSessionStore.getState().activeGraphId).toBe("task-2");
    expect(useEditorSessionStore.getState().graphNavigationStack).toEqual([]);
  });

  it("enters nested function graphs and returns one level at a time", () => {
    const session = useEditorSessionStore.getState();
    session.setActiveGraph("graph-a");
    session.enterGraph("graph-b");
    session.setSelection(["node-b"], ["edge-b"]);
    session.enterGraph("graph-c");

    expect(useEditorSessionStore.getState()).toMatchObject({
      activeGraphId: "graph-c",
      graphNavigationStack: ["graph-a", "graph-b"],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });

    useEditorSessionStore.getState().leaveGraph("entry");
    expect(useEditorSessionStore.getState()).toMatchObject({
      activeGraphId: "graph-b",
      graphNavigationStack: ["graph-a"],
    });

    useEditorSessionStore.getState().leaveGraph("entry");
    expect(useEditorSessionStore.getState()).toMatchObject({
      activeGraphId: "graph-a",
      graphNavigationStack: [],
    });

    useEditorSessionStore.getState().leaveGraph("entry");
    expect(useEditorSessionStore.getState()).toMatchObject({
      activeGraphId: "entry",
      graphNavigationStack: [],
    });
  });

  it("resets the navigation stack when the active graph is set directly", () => {
    const session = useEditorSessionStore.getState();
    session.setActiveGraph("graph-a");
    session.enterGraph("graph-b");
    session.setActiveGraph("task-2");

    expect(useEditorSessionStore.getState()).toMatchObject({
      activeGraphId: "task-2",
      graphNavigationStack: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
  });
});
