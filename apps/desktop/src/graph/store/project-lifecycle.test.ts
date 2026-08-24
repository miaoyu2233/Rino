import type { RinoProjectDocumentV1 } from "@rino/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { closeProjectDocument, openProjectDocument } from "./project-lifecycle";
import { useDocumentStore } from "./document-store";
import { useEditorSessionStore } from "./editor-session-store";

const FIRST_GRAPH_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_GRAPH_ID = "10000000-0000-4000-8000-000000000002";

function multiTaskDocument(): RinoProjectDocumentV1 {
  const graph = (graphId: string, name: string) => ({
    graphId,
    name,
    kind: "entry" as const,
    nodes: [],
    edges: [],
  });
  return {
    schemaVersion: 1,
    documentId: "00000000-0000-4000-8000-000000000001",
    metadata: {
      name: "多任务项目",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    },
    entryGraphId: SECOND_GRAPH_ID,
    graphs: [graph(FIRST_GRAPH_ID, "主图"), graph(SECOND_GRAPH_ID, "刷金币")],
    assets: [],
    requiredCapabilities: [],
  };
}

beforeEach(() => {
  closeProjectDocument();
});

describe("multi-task project lifecycle", () => {
  it("selects the persisted default task even when it is not first", () => {
    const document = multiTaskDocument();

    openProjectDocument(document);

    expect(useEditorSessionStore.getState().activeGraphId).toBe(
      SECOND_GRAPH_ID,
    );
  });

  it("clears the active task and selection on close", () => {
    openProjectDocument(multiTaskDocument());
    useEditorSessionStore.getState().setSelection(["node"], ["edge"]);

    closeProjectDocument();

    expect(useDocumentStore.getState().history).toBeUndefined();
    expect(useEditorSessionStore.getState()).toMatchObject({
      activeGraphId: undefined,
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
  });
});
