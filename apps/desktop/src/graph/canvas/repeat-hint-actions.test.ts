import type {
  EdgeV1,
  GraphV1,
  NodeV1,
  RinoNodeRegistrySnapshotV1,
  RinoProjectDocumentV1,
} from "@rino/contracts";
import { describe, expect, it } from "vitest";

import coreDefinitions from "../../../../../contracts/fixtures/registry/valid/core-definitions.json";
import { applyCommand } from "../commands/graph-commands";
import {
  buildRepeatHintCommand,
  isRepeatHintFailurePort,
  recommendRepeatHintTarget,
  type RepeatHintQuickAddAction,
} from "./repeat-hint-actions";
import { GraphProjection } from "./graph-view-model";

const registry = coreDefinitions as unknown as RinoNodeRegistrySnapshotV1;
const GRAPH_ID = "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e";
const OCR_A = "10000000-0000-4000-8000-000000000001";
const OCR_B = "10000000-0000-4000-8000-000000000002";
const SOURCE = "10000000-0000-4000-8000-000000000003";
const START = "10000000-0000-4000-8000-000000000004";
const GROUP_DELAY = "10000000-0000-4000-8000-000000000005";
const GROUP_OCR = "10000000-0000-4000-8000-000000000006";

function node(nodeId: string, typeKey: string, x: number, y: number): NodeV1 {
  return {
    nodeId,
    typeKey,
    typeVersion: 1,
    position: { x, y },
    properties: {},
    inputValues: {},
  };
}

function edge(
  edgeId: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): EdgeV1 {
  return {
    edgeId,
    edgeKind: "execution",
    sourceNodeId,
    sourcePortId,
    targetNodeId,
    targetPortId,
  };
}

function recognitionGraph(): GraphV1 {
  return {
    graphId: GRAPH_ID,
    name: "主图",
    kind: "entry",
    nodes: [
      node(OCR_A, "vision.ocr", 0, 0),
      node(OCR_B, "vision.templateMatch", 0, 200),
      node(SOURCE, "core.logic.branch", 360, 200),
      node(START, "core.flow.start", -240, 0),
    ],
    edges: [
      edge("edge-a-b", OCR_A, "next", OCR_B, "run"),
      edge("edge-b-source", OCR_B, "next", SOURCE, "run"),
      edge("edge-start-a", START, "next", OCR_A, "run"),
    ],
  };
}

function documentFor(graph: GraphV1): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "20000000-0000-4000-8000-000000000001",
    metadata: {
      name: "Repeat",
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
    entryGraphId: graph.graphId,
    graphs: [graph],
    assets: [],
    requiredCapabilities: [],
  };
}

function groupedRecognitionGraph(): GraphV1 {
  return {
    graphId: GRAPH_ID,
    name: "主图",
    kind: "entry",
    nodes: [
      node(GROUP_DELAY, "core.time.delay", 0, 0),
      node(GROUP_OCR, "vision.ocr", 240, 0),
      node(SOURCE, "core.logic.branch", 480, 0),
    ],
    edges: [
      edge("group-delay-ocr", GROUP_DELAY, "next", GROUP_OCR, "run"),
      edge("group-ocr-source", GROUP_OCR, "next", SOURCE, "run"),
    ],
    editorMetadata: {
      workflowGroups: [
        {
          groupId: "recognition-group",
          kind: "textRecognition",
          collapsed: true,
          members: [
            { role: "delay", nodeId: GROUP_DELAY },
            { role: "recognizer", nodeId: GROUP_OCR },
          ],
          exposedPorts: [
            {
              proxyPortId: "run",
              nodeId: GROUP_DELAY,
              portId: "run",
              labelKey: "workflowGroup.textRecognition.port.run",
            },
            {
              proxyPortId: "next",
              nodeId: GROUP_OCR,
              portId: "next",
              labelKey: "workflowGroup.textRecognition.port.next",
            },
          ],
        },
      ],
    },
  };
}

describe("repeat hint recommendations and composition", () => {
  it("recognizes unmatched task choices without treating a false judgment as a failure", () => {
    expect(isRepeatHintFailurePort("unmatched", "unmatched")).toBe(true);
    expect(
      isRepeatHintFailurePort("workflow-group:unmatched", "whenFalse"),
    ).toBe(true);
    expect(isRepeatHintFailurePort("whenFalse", "whenFalse")).toBe(false);
  });

  it("chooses the nearest visible upstream recognition node and breaks ties by stable id", () => {
    const graph = recognitionGraph();
    const visibleNodes = new GraphProjection().projectNodes(graph, registry);
    const target = recommendRepeatHintTarget(
      graph,
      registry,
      { nodeId: SOURCE, portId: "whenFalse" },
      { x: 110, y: 116 },
      visibleNodes,
    );

    expect(target?.stableId).toBe(OCR_A);
    expect(target?.target).toEqual({ nodeId: OCR_A, portId: "run" });
  });

  it("creates an execution edge and editor hint in one ordered composite", () => {
    const graph = recognitionGraph();
    const visibleNodes = new GraphProjection().projectNodes(graph, registry);
    const target = recommendRepeatHintTarget(
      graph,
      registry,
      { nodeId: SOURCE, portId: "whenFalse" },
      { x: 110, y: 116 },
      visibleNodes,
    );
    if (target === undefined) {
      throw new Error("Expected an upstream recognition target.");
    }
    const action: RepeatHintQuickAddAction = {
      graphId: GRAPH_ID,
      source: { nodeId: SOURCE, portId: "whenFalse" },
      position: { x: 110, y: 116 },
      target,
    };
    const result = buildRepeatHintCommand(graph, registry, action, () => {
      return resultIds.shift() ?? "30000000-0000-4000-8000-000000000099";
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.commands.map((command) => command.kind)).toEqual([
      "addEdge",
      "addRepeatHint",
    ]);
    const applied = applyCommand(documentFor(graph), result.command);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const updated = applied.document.graphs[0];
    expect(
      updated?.edges.some((candidate) => candidate.edgeId === result.edgeId),
    ).toBe(true);
    expect(updated?.editorMetadata?.repeatHints).toEqual([
      {
        hintId: result.hintId,
        edgeId: result.edgeId,
        position: { x: 110, y: 116 },
      },
    ]);
  });

  it("resolves a visible collapsed recognition group to its public run endpoint", () => {
    const graph = groupedRecognitionGraph();
    const visibleNodes = new GraphProjection().projectNodes(graph, registry);
    const target = recommendRepeatHintTarget(
      graph,
      registry,
      { nodeId: SOURCE, portId: "whenFalse" },
      { x: 140, y: 80 },
      visibleNodes,
    );

    expect(target?.visualNodeId).toBe("workflow-group:recognition-group");
    expect(target?.target).toEqual({ nodeId: GROUP_DELAY, portId: "run" });
  });

  it("rejects a non-execution target without creating a partial command", () => {
    const graph = recognitionGraph();
    const result = buildRepeatHintCommand(
      graph,
      registry,
      {
        graphId: GRAPH_ID,
        source: { nodeId: SOURCE, portId: "whenFalse" },
        position: { x: 0, y: 0 },
        target: {
          visualNodeId: OCR_A,
          stableId: OCR_A,
          titleKey: "node.vision.ocr.title",
          target: { nodeId: OCR_A, portId: "image" },
        },
      },
      () => "40000000-0000-4000-8000-000000000001",
    );

    expect(result).toMatchObject({ ok: false, reason: "connectionRejected" });
  });
});

const resultIds = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
];
