import type { GraphV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import { applyCommand } from "./graph-commands";
import {
  buildCreateTaskCommand,
  buildDeleteTaskCommand,
  buildDuplicateTaskCommand,
  buildRenameTaskCommand,
  buildSetDefaultTaskCommand,
} from "./task-commands";

const GRAPH_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_GRAPH_ID = "10000000-0000-4000-8000-000000000002";
const NODE_ID = "20000000-0000-4000-8000-000000000001";
const EDGE_ID = "30000000-0000-4000-8000-000000000001";
const COMMENT_ID = "40000000-0000-4000-8000-000000000001";
const GROUP_ID = "50000000-0000-4000-8000-000000000001";
const REPEAT_HINT_ID = "50000000-0000-4000-8000-000000000002";
const DANGLING_HINT_ID = "50000000-0000-4000-8000-000000000003";

function identifiers(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `60000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
  };
}

function graph(graphId: string, name: string, withStructure = false): GraphV1 {
  return {
    graphId,
    name,
    kind: "entry",
    nodes: withStructure
      ? [
          {
            nodeId: NODE_ID,
            typeKey: "core.flow.start",
            typeVersion: 1,
            position: { x: 12, y: 24 },
            properties: { assetId: "asset-shared" },
            inputValues: { literal: "value" },
            dynamicPortState: { selected: "case-a" },
            displayAlias: "入口",
            disabled: true,
            breakpoint: true,
          },
        ]
      : [],
    edges: withStructure
      ? [
          {
            edgeId: EDGE_ID,
            edgeKind: "execution",
            sourceNodeId: NODE_ID,
            sourcePortId: "next",
            targetNodeId: NODE_ID,
            targetPortId: "run",
          },
        ]
      : [],
    ...(withStructure
      ? {
          editorMetadata: {
            comments: [
              {
                commentId: COMMENT_ID,
                text: "说明",
                position: { x: 4, y: 8 },
                size: { width: 240, height: 120 },
              },
            ],
            workflowGroups: [
              {
                groupId: GROUP_ID,
                kind: "textRecognition",
                members: [{ role: "entry", nodeId: NODE_ID }],
                exposedPorts: [
                  {
                    proxyPortId: "run",
                    nodeId: NODE_ID,
                    portId: "run",
                    labelKey: "workflowGroup.textRecognition.port.run",
                  },
                ],
                collapsed: true,
              },
            ],
            repeatHints: [
              {
                hintId: REPEAT_HINT_ID,
                edgeId: EDGE_ID,
                position: { x: 80, y: 96 },
              },
              {
                hintId: DANGLING_HINT_ID,
                edgeId: "50000000-0000-4000-8000-000000000099",
                position: { x: 200, y: 240 },
              },
            ],
          },
        }
      : {}),
  };
}

function documentWith(
  graphs: GraphV1[],
  entryGraphId = graphs[0]?.graphId ?? GRAPH_ID,
): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "00000000-0000-4000-8000-000000000001",
    metadata: {
      name: "测试项目",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    },
    entryGraphId,
    graphs,
    assets: [],
    requiredCapabilities: [],
  };
}

function applyOrThrow(
  document: RinoProjectDocumentV1,
  command: Parameters<typeof applyCommand>[1],
): RinoProjectDocumentV1 {
  const outcome = applyCommand(document, command);
  if (!outcome.ok) {
    throw new Error(`Expected command to apply: ${outcome.reason}`);
  }
  return outcome.document;
}

describe("task command builders", () => {
  it("creates an empty appended task", () => {
    const document = documentWith([graph(GRAPH_ID, "主图")]);
    const outcome = buildCreateTaskCommand(
      document,
      "  刷金币  ",
      identifiers(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const next = applyOrThrow(document, outcome.value.command);
    expect(next.graphs).toHaveLength(2);
    expect(next.graphs[1]).toMatchObject({
      graphId: outcome.value.taskId,
      name: "刷金币",
      kind: "entry",
      nodes: [],
      edges: [],
    });
  });

  it("duplicates all explicit structure with fresh IDs and shared values", () => {
    const source = graph(GRAPH_ID, "主图", true);
    const assetReference = source.nodes[0]?.properties["assetId"];
    const document = documentWith([source]);
    const outcome = buildDuplicateTaskCommand(
      document,
      GRAPH_ID,
      "刷钻石",
      identifiers(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const next = applyOrThrow(document, outcome.value.command);
    const duplicate = next.graphs[1];
    if (!duplicate) throw new Error("Expected a duplicate task.");
    expect(duplicate.name).toBe("刷钻石");
    expect(duplicate.graphId).not.toBe(GRAPH_ID);
    expect(duplicate.nodes[0]?.nodeId).not.toBe(NODE_ID);
    expect(duplicate.edges[0]?.edgeId).not.toBe(EDGE_ID);
    expect(duplicate.edges[0]?.sourceNodeId).toBe(duplicate.nodes[0]?.nodeId);
    expect(duplicate.edges[0]?.targetNodeId).toBe(duplicate.nodes[0]?.nodeId);
    expect(duplicate.editorMetadata?.comments?.[0]?.commentId).not.toBe(
      COMMENT_ID,
    );
    expect(duplicate.editorMetadata?.comments?.[0]?.size).toEqual({
      width: 240,
      height: 120,
    });
    expect(duplicate.editorMetadata?.workflowGroups?.[0]?.groupId).not.toBe(
      GROUP_ID,
    );
    expect(
      duplicate.editorMetadata?.workflowGroups?.[0]?.members[0]?.nodeId,
    ).toBe(duplicate.nodes[0]?.nodeId);
    expect(duplicate.nodes[0]?.properties["assetId"]).toBe(assetReference);
    expect(duplicate.nodes[0]?.position).toEqual({ x: 44, y: 56 });
    expect(duplicate.editorMetadata?.comments?.[0]?.position).toEqual({
      x: 36,
      y: 40,
    });
    expect(duplicate.editorMetadata?.repeatHints).toHaveLength(1);
    expect(duplicate.editorMetadata?.repeatHints?.[0]?.hintId).not.toBe(
      REPEAT_HINT_ID,
    );
    expect(duplicate.editorMetadata?.repeatHints?.[0]?.edgeId).toBe(
      duplicate.edges[0]?.edgeId,
    );
    expect(duplicate.editorMetadata?.repeatHints?.[0]?.position).toEqual({
      x: 112,
      y: 128,
    });
    expect(duplicate.nodes[0]).not.toBe(source.nodes[0]);
    expect(duplicate.editorMetadata).not.toBe(source.editorMetadata);
    expect(document).toStrictEqual(documentWith([source]));
  });

  it("deletes the default task by changing the default first in one composite", () => {
    const document = documentWith(
      [graph(GRAPH_ID, "主图"), graph(SECOND_GRAPH_ID, "刷金币")],
      GRAPH_ID,
    );
    const outcome = buildDeleteTaskCommand(document, GRAPH_ID);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackTaskId).toBe(SECOND_GRAPH_ID);
    expect(outcome.value.command).toMatchObject({
      kind: "composite",
      commands: [
        { kind: "setEntryGraph", graphId: SECOND_GRAPH_ID },
        { kind: "removeGraph", graphId: GRAPH_ID },
      ],
    });
    const next = applyOrThrow(document, outcome.value.command);
    expect(next.entryGraphId).toBe(SECOND_GRAPH_ID);
    expect(next.graphs.map((candidate) => candidate.graphId)).toEqual([
      SECOND_GRAPH_ID,
    ]);
  });

  it("chooses the previous task when deleting the last task", () => {
    const document = documentWith([
      graph(GRAPH_ID, "主图"),
      graph(SECOND_GRAPH_ID, "刷金币"),
    ]);
    const outcome = buildDeleteTaskCommand(document, SECOND_GRAPH_ID);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackTaskId).toBe(GRAPH_ID);
    const next = applyOrThrow(document, outcome.value.command);
    expect(next.graphs.map((candidate) => candidate.graphId)).toEqual([
      GRAPH_ID,
    ]);
  });

  it("rejects invalid names, unknown tasks, and deleting the only task", () => {
    const document = documentWith([graph(GRAPH_ID, "主图")]);
    expect(buildCreateTaskCommand(document, "   ", identifiers())).toEqual({
      ok: false,
      reason: "taskNameInvalid",
    });
    expect(buildRenameTaskCommand(document, "missing", "新名称")).toEqual({
      ok: false,
      reason: "taskMissing",
    });
    expect(buildSetDefaultTaskCommand(document, "missing")).toEqual({
      ok: false,
      reason: "taskMissing",
    });
    expect(buildDeleteTaskCommand(document, GRAPH_ID)).toEqual({
      ok: false,
      reason: "cannotDeleteOnlyTask",
    });
  });
});
