import type { NodeV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import {
  MAXIMUM_HISTORY_ENTRIES,
  applyToHistory,
  canRedo,
  canUndo,
  createHistory,
  isDirty,
  markSaved,
  pendingLabels,
  redo,
  undo,
  type GraphHistory,
} from "./command-history";
import type { GraphCommand } from "./graph-commands";

const GRAPH_ID = "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e";
const NODE_START = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";

function node(nodeId: string): NodeV1 {
  return {
    nodeId,
    typeKey: "core.flow.start",
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
  };
}

function baseDocument(): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "1b0d4c3a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    metadata: {
      name: "测试项目",
      createdAt: "2026-07-26T10:00:00Z",
      updatedAt: "2026-07-26T10:00:00Z",
    },
    entryGraphId: GRAPH_ID,
    graphs: [
      {
        graphId: GRAPH_ID,
        name: "主图",
        kind: "entry",
        nodes: [node(NODE_START)],
        edges: [],
      },
    ],
    assets: [],
    requiredCapabilities: [],
  };
}

function moveTo(x: number): GraphCommand {
  return {
    kind: "moveNode",
    graphId: GRAPH_ID,
    nodeId: NODE_START,
    position: { x, y: 0 },
  };
}

function expectApplied(
  history: GraphHistory,
  label: string,
  command: GraphCommand,
): GraphHistory {
  const outcome = applyToHistory(history, label, command);
  if (!outcome.ok) {
    throw new Error(`The command should have applied: ${outcome.reason}`);
  }
  return outcome.history;
}

function expectUndone(history: GraphHistory): GraphHistory {
  const outcome = undo(history);
  if (!outcome.ok) {
    throw new Error(`Undo should have applied: ${outcome.reason}`);
  }
  return outcome.history;
}

function expectRedone(history: GraphHistory): GraphHistory {
  const outcome = redo(history);
  if (!outcome.ok) {
    throw new Error(`Redo should have applied: ${outcome.reason}`);
  }
  return outcome.history;
}

function positionX(history: GraphHistory): number | undefined {
  return history.document.graphs[0]?.nodes[0]?.position.x;
}

describe("undo and redo", () => {
  it("starts with nothing to undo or redo", () => {
    const history = createHistory(baseDocument());

    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(isDirty(history)).toBe(false);
  });

  it("returns the document to its earlier state and forward again", () => {
    const original = baseDocument();
    let history = createHistory(original);
    history = expectApplied(history, "move", moveTo(100));
    history = expectApplied(history, "move", moveTo(200));

    expect(positionX(history)).toBe(200);

    history = expectUndone(history);
    expect(positionX(history)).toBe(100);

    history = expectUndone(history);
    expect(history.document).toEqual(original);
    expect(canUndo(history)).toBe(false);

    history = expectRedone(history);
    expect(positionX(history)).toBe(100);
    history = expectRedone(history);
    expect(positionX(history)).toBe(200);
  });

  it("discards the redo branch when a new change follows an undo", () => {
    let history = createHistory(baseDocument());
    history = expectApplied(history, "move", moveTo(100));
    history = expectUndone(history);
    expect(canRedo(history)).toBe(true);

    history = expectApplied(history, "move", moveTo(300));

    expect(canRedo(history)).toBe(false);
    expect(positionX(history)).toBe(300);
  });

  it("does nothing when there is nothing to undo or redo", () => {
    const history = createHistory(baseDocument());

    expect(expectUndone(history)).toBe(history);
    expect(expectRedone(history)).toBe(history);
  });

  it("reports the labels of the pending changes", () => {
    let history = createHistory(baseDocument());
    history = expectApplied(history, "移动节点", moveTo(100));

    expect(pendingLabels(history)).toEqual({
      undo: "移动节点",
      redo: undefined,
    });

    history = expectUndone(history);
    expect(pendingLabels(history)).toEqual({
      undo: undefined,
      redo: "移动节点",
    });
  });

  it("survives a long sequence of changes and reversals", () => {
    const original = baseDocument();
    let history = createHistory(original);
    for (let step = 1; step <= 20; step += 1) {
      history = expectApplied(history, "move", moveTo(step * 10));
    }
    expect(positionX(history)).toBe(200);

    for (let step = 0; step < 20; step += 1) {
      history = expectUndone(history);
    }

    expect(history.document).toEqual(original);
  });
});

describe("dirty checkpoint", () => {
  it("becomes dirty on a change and clean again when marked saved", () => {
    let history = createHistory(baseDocument());
    history = expectApplied(history, "move", moveTo(100));
    expect(isDirty(history)).toBe(true);

    history = markSaved(history);
    expect(isDirty(history)).toBe(false);
  });

  it("keeps undo history available past a save", () => {
    let history = createHistory(baseDocument());
    history = expectApplied(history, "move", moveTo(100));
    history = markSaved(history);

    expect(canUndo(history)).toBe(true);

    history = expectUndone(history);
    expect(isDirty(history)).toBe(true);
  });

  it("becomes clean again when the document is returned to the saved state", () => {
    let history = createHistory(baseDocument());
    history = expectApplied(history, "move", moveTo(100));
    history = markSaved(history);
    history = expectApplied(history, "move", moveTo(200));
    expect(isDirty(history)).toBe(true);

    history = expectUndone(history);

    expect(positionX(history)).toBe(100);
    expect(isDirty(history)).toBe(false);
  });

  it("stays dirty when a saved state was discarded by a new branch", () => {
    let history = createHistory(baseDocument());
    history = expectApplied(history, "move", moveTo(100));
    history = markSaved(history);
    history = expectUndone(history);
    // The saved state now lives only in the redo branch, which the next change discards.
    history = expectApplied(history, "move", moveTo(300));

    expect(isDirty(history)).toBe(true);
  });
});

describe("bounded history", () => {
  it("drops the oldest entries and records that it did", () => {
    let history = createHistory(baseDocument());
    for (let step = 0; step < MAXIMUM_HISTORY_ENTRIES + 5; step += 1) {
      history = expectApplied(history, "move", moveTo(step));
    }

    expect(history.undoable).toHaveLength(MAXIMUM_HISTORY_ENTRIES);
    expect(history.truncated).toBe(true);
  });
});

describe("failures", () => {
  it("leaves the history untouched when a command cannot apply", () => {
    const history = createHistory(baseDocument());

    const outcome = applyToHistory(history, "move", {
      kind: "moveNode",
      graphId: GRAPH_ID,
      nodeId: "00000000-0000-4000-8000-000000000000",
      position: { x: 1, y: 1 },
    });

    expect(outcome).toEqual({ ok: false, reason: "nodeMissing" });
    expect(canUndo(history)).toBe(false);
  });
});
