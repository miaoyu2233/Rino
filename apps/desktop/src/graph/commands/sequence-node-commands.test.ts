import { describe, expect, it } from "vitest";
import type { GraphV1, NodeV1, RinoProjectDocumentV1 } from "@rino/contracts";

import {
  buildAddSequenceStepCommand,
  buildMoveSequenceStepCommand,
  moveSequenceStep,
} from "./sequence-node-commands";
import { useDocumentStore } from "../store/document-store";

const SEQUENCE_ID = "10000000-0000-4000-8000-000000000001";

function node(
  typeKey: string,
  dynamicPortState?: NodeV1["dynamicPortState"],
): NodeV1 {
  return {
    nodeId: SEQUENCE_ID,
    typeKey,
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
    ...(dynamicPortState === undefined ? {} : { dynamicPortState }),
  };
}

function graph(sequence: NodeV1): GraphV1 {
  return {
    graphId: "20000000-0000-4000-8000-000000000001",
    name: "Test",
    kind: "entry",
    nodes: [
      sequence,
      {
        ...node("core.flow.stop"),
        nodeId: "10000000-0000-4000-8000-000000000002",
      },
      {
        ...node("core.flow.stop"),
        nodeId: "10000000-0000-4000-8000-000000000003",
      },
    ],
    edges: [
      {
        edgeId: "30000000-0000-4000-8000-000000000001",
        edgeKind: "execution",
        sourceNodeId: SEQUENCE_ID,
        sourcePortId: "steps",
        targetNodeId: "10000000-0000-4000-8000-000000000002",
        targetPortId: "run",
      },
      {
        edgeId: "30000000-0000-4000-8000-000000000002",
        edgeKind: "execution",
        sourceNodeId: SEQUENCE_ID,
        sourcePortId: "steps",
        targetNodeId: "10000000-0000-4000-8000-000000000003",
        targetPortId: "run",
      },
    ],
  };
}

describe("buildAddSequenceStepCommand", () => {
  it("migrates legacy fan-out edges to ordered ports and adds one empty step", () => {
    const result = buildAddSequenceStepCommand(
      graph(node("core.flow.sequence")),
      SEQUENCE_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stepCount).toBe(3);
    const addedEdges = result.command.commands.filter(
      (command) => command.kind === "addEdge",
    );
    expect(addedEdges.map((command) => command.edge.sourcePortId)).toEqual([
      "step1",
      "step2",
    ]);
  });

  it("rejects a non-sequence node", () => {
    expect(
      buildAddSequenceStepCommand(graph(node("core.flow.stop")), SEQUENCE_ID),
    ).toEqual({ ok: false, reason: "nodeTypeMismatch" });
  });

  it("preserves an authored reorder while appending a new step", () => {
    const result = buildAddSequenceStepCommand(
      graph(
        node("core.flow.sequence", {
          sequenceStepCount: 2,
          sequenceOrder: ["step2", "step1"],
        }),
      ),
      SEQUENCE_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const replacement = result.command.commands.find(
      (command) => command.kind === "replaceNode",
    );
    expect(
      replacement?.kind === "replaceNode" && replacement.node.dynamicPortState,
    ).toEqual({
      sequenceStepCount: 3,
      sequenceOrder: ["step2", "step1", "step3"],
    });
  });

  it("preserves an execution-order node reorder while appending", () => {
    const result = buildAddSequenceStepCommand(
      graph(
        node("core.flow.sequenceOrder", {
          sequenceStepCount: 2,
          sequenceOrder: ["step2", "step1"],
        }),
      ),
      SEQUENCE_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const replacement = result.command.commands.find(
      (command) => command.kind === "replaceNode",
    );
    expect(
      replacement?.kind === "replaceNode" && replacement.node.dynamicPortState,
    ).toEqual({
      sequenceStepCount: 3,
      sequenceOrder: ["step2", "step1", "step3"],
    });
  });
});

describe("buildMoveSequenceStepCommand", () => {
  it("moves an adjacent step in one undoable command", () => {
    const result = buildMoveSequenceStepCommand(
      graph(
        node("core.flow.sequence", {
          sequenceStepCount: 3,
          sequenceOrder: ["step3", "step1", "step2"],
        }),
      ),
      SEQUENCE_ID,
      "step1",
      "up",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order).toEqual(["step1", "step3", "step2"]);
    expect(result.command.commands).toHaveLength(1);
  });

  it("returns an explicit boundary no-op without a history command", () => {
    const result = buildMoveSequenceStepCommand(
      graph(
        node("core.flow.sequenceOrder", {
          sequenceStepCount: 2,
          sequenceOrder: ["step1", "step2"],
        }),
      ),
      SEQUENCE_ID,
      "step1",
      "up",
    );

    expect(result).toEqual({ ok: false, reason: "boundary" });
  });

  it("does not expose a move command without legacy edges", () => {
    const legacyFreeGraph = graph(node("core.flow.sequence"));
    legacyFreeGraph.edges = [];
    const result = buildMoveSequenceStepCommand(
      legacyFreeGraph,
      SEQUENCE_ID,
      "step1",
      "down",
    );

    expect(result).toEqual({ ok: false, reason: "stepMissing" });
  });

  it("migrates legacy fan-out edges while moving their stable steps", () => {
    const result = buildMoveSequenceStepCommand(
      graph(node("core.flow.sequence")),
      SEQUENCE_ID,
      "step1",
      "down",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order).toEqual(["step2", "step1"]);
    const replacement = result.command.commands.find(
      (command) => command.kind === "replaceNode",
    );
    expect(
      replacement?.kind === "replaceNode" && replacement.node.dynamicPortState,
    ).toEqual({
      sequenceStepCount: 2,
      sequenceOrder: ["step2", "step1"],
    });
    expect(
      result.command.commands
        .filter((command) => command.kind === "addEdge")
        .map((command) => command.edge.sourcePortId),
    ).toEqual(["step1", "step2"]);
    expect(
      result.command.commands
        .filter((command) => command.kind === "addEdge")
        .map((command) => command.index),
    ).toEqual([0, 1]);
  });

  it("records an adjacent move as one undoable and redoable change", () => {
    const sourceGraph = graph(
      node("core.flow.sequence", {
        sequenceStepCount: 3,
        sequenceOrder: ["step3", "step1", "step2"],
      }),
    );
    const document: RinoProjectDocumentV1 = {
      schemaVersion: 1,
      documentId: "40000000-0000-4000-8000-000000000001",
      metadata: {
        name: "Sequence command",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      entryGraphId: sourceGraph.graphId,
      graphs: [sourceGraph],
      assets: [],
      requiredCapabilities: [],
    };
    useDocumentStore.getState().openDocument(document);

    expect(
      moveSequenceStep(sourceGraph.graphId, SEQUENCE_ID, "step1", "up"),
    ).toBe(true);
    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0]
        ?.dynamicPortState,
    ).toEqual({
      sequenceStepCount: 3,
      sequenceOrder: ["step1", "step3", "step2"],
    });

    useDocumentStore.getState().undoChange();
    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0]
        ?.dynamicPortState,
    ).toEqual({
      sequenceStepCount: 3,
      sequenceOrder: ["step3", "step1", "step2"],
    });

    useDocumentStore.getState().redoChange();
    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0]
        ?.dynamicPortState,
    ).toEqual({
      sequenceStepCount: 3,
      sequenceOrder: ["step1", "step3", "step2"],
    });
  });

  it("undoes and redoes the legacy edge migration with the move", () => {
    const sourceGraph = graph(node("core.flow.sequence"));
    const document: RinoProjectDocumentV1 = {
      schemaVersion: 1,
      documentId: "40000000-0000-4000-8000-000000000002",
      metadata: {
        name: "Legacy sequence command",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      entryGraphId: sourceGraph.graphId,
      graphs: [sourceGraph],
      assets: [],
      requiredCapabilities: [],
    };
    useDocumentStore.getState().openDocument(document);

    expect(
      moveSequenceStep(sourceGraph.graphId, SEQUENCE_ID, "step1", "down"),
    ).toBe(true);
    const migrated = useDocumentStore.getState().history?.document.graphs[0];
    expect(migrated?.nodes[0]?.dynamicPortState).toEqual({
      sequenceStepCount: 2,
      sequenceOrder: ["step2", "step1"],
    });
    expect(migrated?.edges.map((edge) => edge.sourcePortId)).toEqual([
      "step1",
      "step2",
    ]);

    useDocumentStore.getState().undoChange();
    const restored = useDocumentStore.getState().history?.document.graphs[0];
    expect(restored?.nodes[0]?.dynamicPortState).toBeUndefined();
    expect(restored?.edges.map((edge) => edge.sourcePortId)).toEqual([
      "steps",
      "steps",
    ]);

    useDocumentStore.getState().redoChange();
    const redone = useDocumentStore.getState().history?.document.graphs[0];
    expect(redone?.nodes[0]?.dynamicPortState).toEqual({
      sequenceStepCount: 2,
      sequenceOrder: ["step2", "step1"],
    });
    expect(redone?.edges.map((edge) => edge.sourcePortId)).toEqual([
      "step1",
      "step2",
    ]);
  });
});
