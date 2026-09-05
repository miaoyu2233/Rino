import {
  isValidProjectDocument,
  type EdgeV1,
  type NodeV1,
  type RinoProjectDocumentV1,
} from "@rino/contracts";
import { describe, expect, it } from "vitest";

import {
  applyCommand,
  type CommandSuccess,
  type CommandFailureReason,
  type GraphCommand,
} from "./graph-commands";
import type { VariableDefinition } from "../variables/variable-authoring";

const GRAPH_ID = "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e";
const NODE_START = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const NODE_BRANCH = "6a5c9b8f-a3b4-4fc0-9be3-5d6e7f809102";
const NODE_NEW = "9d8fceb2-d6e7-42f3-8e16-80910213245f";
const EDGE_ID = "7b6dac90-b4c5-40d1-8cf4-6e7f80910213";
const EDGE_NEW = "8c7ebda1-c5d6-41e2-9d05-7f8091021324";
const REPEAT_HINT_ID = "9d8fceb2-d6e7-42f3-8e16-80910213245a";

function node(nodeId: string, overrides: Partial<NodeV1> = {}): NodeV1 {
  return {
    nodeId,
    typeKey: "core.flow.start",
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
    ...overrides,
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
        nodes: [
          node(NODE_START),
          node(NODE_BRANCH, {
            typeKey: "core.logic.branch",
            position: { x: 200, y: 40 },
            properties: { operator: "greaterThan" },
            inputValues: { left: 1 },
          }),
        ],
        edges: [
          {
            edgeId: EDGE_ID,
            edgeKind: "execution",
            sourceNodeId: NODE_START,
            sourcePortId: "next",
            targetNodeId: NODE_BRANCH,
            targetPortId: "run",
          },
        ],
      },
    ],
    assets: [],
    requiredCapabilities: [],
  };
}

function documentWithRepeatHint(): RinoProjectDocumentV1 {
  const document = baseDocument();
  const graph = graphOf(document);
  return {
    ...document,
    graphs: [
      {
        ...graph,
        editorMetadata: {
          repeatHints: [
            {
              hintId: REPEAT_HINT_ID,
              edgeId: EDGE_ID,
              position: { x: 120, y: 180 },
            },
          ],
        },
      },
    ],
  };
}

function expectSuccess(
  document: RinoProjectDocumentV1,
  command: GraphCommand,
): CommandSuccess {
  const outcome = applyCommand(document, command);
  if (!outcome.ok) {
    throw new Error(`The command should have applied: ${outcome.reason}`);
  }
  return outcome;
}

/** Applies a command, then its inverse, and asserts the document returned unchanged.
 *
 * This is the property that makes undo trustworthy, so every command is held to it
 * rather than only to a hand-written expectation about its forward effect.
 */
function expectRoundTrip(command: GraphCommand): RinoProjectDocumentV1 {
  const original = baseDocument();
  const applied = expectSuccess(original, command);
  expect(isValidProjectDocument(applied.document)).toBe(true);

  const reverted = expectSuccess(applied.document, applied.inverse);
  expect(reverted.document).toEqual(original);
  return applied.document;
}

function graphOf(document: RinoProjectDocumentV1) {
  const graph = document.graphs[0];
  if (!graph) {
    throw new Error("The document must contain one graph.");
  }
  return graph;
}

describe("project license commands", () => {
  it("updates and restores the project-owned license", () => {
    const original = baseDocument();
    const updated = expectSuccess(original, {
      kind: "setProjectLicense",
      licenseIdentifier: "MIT",
    });
    expect(updated.document.metadata.licenseIdentifier).toBe("MIT");

    const restored = expectSuccess(updated.document, updated.inverse);
    expect(restored.document.metadata.licenseIdentifier).toBe(
      "LicenseRef-Proprietary",
    );
  });

  it("rejects invalid license identifiers", () => {
    expect(
      applyCommand(baseDocument(), {
        kind: "setProjectLicense",
        licenseIdentifier: "not a license",
      }),
    ).toEqual({ ok: false, reason: "projectLicenseInvalid" });
  });
});

describe("node commands", () => {
  it("adds a node and removes it again", () => {
    const applied = expectRoundTrip({
      kind: "addNode",
      graphId: GRAPH_ID,
      node: node(NODE_NEW),
    });

    expect(graphOf(applied).nodes).toHaveLength(3);
  });

  it("refuses to add a node whose identifier is already present", () => {
    const outcome = applyCommand(baseDocument(), {
      kind: "addNode",
      graphId: GRAPH_ID,
      node: node(NODE_START),
    });

    expect(outcome).toEqual({ ok: false, reason: "nodeAlreadyPresent" });
  });

  it("removes a node together with its edges and restores both", () => {
    const applied = expectRoundTrip({
      kind: "removeNode",
      graphId: GRAPH_ID,
      nodeId: NODE_START,
    });

    expect(graphOf(applied).nodes).toHaveLength(1);
    expect(graphOf(applied).edges).toHaveLength(0);
  });

  it("moves a node and restores its previous position", () => {
    const applied = expectRoundTrip({
      kind: "moveNode",
      graphId: GRAPH_ID,
      nodeId: NODE_START,
      position: { x: 500, y: 250 },
    });

    expect(graphOf(applied).nodes[0]?.position).toEqual({ x: 500, y: 250 });
  });

  it("reports a missing node rather than silently doing nothing", () => {
    const outcome = applyCommand(baseDocument(), {
      kind: "moveNode",
      graphId: GRAPH_ID,
      nodeId: NODE_NEW,
      position: { x: 0, y: 0 },
    });

    expect(outcome).toEqual({ ok: false, reason: "nodeMissing" });
  });

  it("reports a missing graph", () => {
    const outcome = applyCommand(baseDocument(), {
      kind: "addNode",
      graphId: "00000000-0000-4000-8000-000000000000",
      node: node(NODE_NEW),
    });

    expect(outcome).toEqual({ ok: false, reason: "graphMissing" });
  });
});

describe("edge commands", () => {
  it("adds an edge and removes it again", () => {
    const applied = expectRoundTrip({
      kind: "addEdge",
      graphId: GRAPH_ID,
      edge: {
        edgeId: EDGE_NEW,
        edgeKind: "execution",
        sourceNodeId: NODE_BRANCH,
        sourcePortId: "whenTrue",
        targetNodeId: NODE_START,
        targetPortId: "run",
      },
    });

    expect(graphOf(applied).edges).toHaveLength(2);
  });

  it("removes an edge and restores it unchanged", () => {
    const applied = expectRoundTrip({
      kind: "removeEdge",
      graphId: GRAPH_ID,
      edgeId: EDGE_ID,
    });

    expect(graphOf(applied).edges).toHaveLength(0);
  });

  it("reports a missing edge", () => {
    const outcome = applyCommand(baseDocument(), {
      kind: "removeEdge",
      graphId: GRAPH_ID,
      edgeId: EDGE_NEW,
    });

    expect(outcome).toEqual({ ok: false, reason: "edgeMissing" });
  });

  it("clears an attached repeat hint and restores both on undo", () => {
    const original = documentWithRepeatHint();
    const outcome = applyCommand(original, {
      kind: "removeEdge",
      graphId: GRAPH_ID,
      edgeId: EDGE_ID,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(graphOf(outcome.document).edges).toEqual([]);
    expect(graphOf(outcome.document).editorMetadata).toBeUndefined();
    const restored = applyCommand(outcome.document, outcome.inverse);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.document).toEqual(original);
  });
});

describe("repeat hint commands", () => {
  it("adds, moves, and removes a presentation hint without changing the edge", () => {
    const added = expectRoundTrip({
      kind: "addRepeatHint",
      graphId: GRAPH_ID,
      hint: {
        hintId: REPEAT_HINT_ID,
        edgeId: EDGE_ID,
        position: { x: 120, y: 180 },
      },
    });
    expect(graphOf(added).edges).toHaveLength(1);
    expect(graphOf(added).editorMetadata?.repeatHints).toHaveLength(1);

    const moved = applyCommand(documentWithRepeatHint(), {
      kind: "moveRepeatHint",
      graphId: GRAPH_ID,
      hintId: REPEAT_HINT_ID,
      position: { x: -100, y: 1000 },
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(
      graphOf(moved.document).editorMetadata?.repeatHints?.[0]?.position,
    ).toEqual({ x: -100, y: 1000 });
    const movedBack = applyCommand(moved.document, moved.inverse);
    expect(movedBack.ok).toBe(true);
    if (!movedBack.ok) return;
    expect(movedBack.document).toEqual(documentWithRepeatHint());

    const removed = applyCommand(documentWithRepeatHint(), {
      kind: "removeRepeatHint",
      graphId: GRAPH_ID,
      hintId: REPEAT_HINT_ID,
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(graphOf(removed.document).edges).toHaveLength(1);
    expect(graphOf(removed.document).editorMetadata).toBeUndefined();
    const restored = applyCommand(removed.document, removed.inverse);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.document).toEqual(documentWithRepeatHint());
  });

  it("rejects missing, data, duplicate, and out-of-bounds targets", () => {
    const missingEdge = applyCommand(baseDocument(), {
      kind: "addRepeatHint",
      graphId: GRAPH_ID,
      hint: {
        hintId: REPEAT_HINT_ID,
        edgeId: EDGE_NEW,
        position: { x: 0, y: 0 },
      },
    });
    expect(missingEdge).toEqual({
      ok: false,
      reason: "repeatHintEdgeMissing",
    });

    const dataEdgeBase = baseDocument();
    const dataEdgeGraph = graphOf(dataEdgeBase);
    const originalEdge = dataEdgeGraph.edges[0];
    if (originalEdge === undefined) {
      throw new Error("The base graph must contain one edge.");
    }
    const dataEdgeDocument: RinoProjectDocumentV1 = {
      ...dataEdgeBase,
      graphs: [
        {
          ...dataEdgeGraph,
          edges: [
            {
              ...originalEdge,
              edgeKind: "data",
            },
          ],
        },
      ],
    };
    const dataEdge = applyCommand(dataEdgeDocument, {
      kind: "addRepeatHint",
      graphId: GRAPH_ID,
      hint: {
        hintId: REPEAT_HINT_ID,
        edgeId: EDGE_ID,
        position: { x: 0, y: 0 },
      },
    });
    expect(dataEdge).toEqual({
      ok: false,
      reason: "repeatHintEdgeNotExecution",
    });

    const duplicate = applyCommand(documentWithRepeatHint(), {
      kind: "addRepeatHint",
      graphId: GRAPH_ID,
      hint: {
        hintId: REPEAT_HINT_ID,
        edgeId: EDGE_ID,
        position: { x: 0, y: 0 },
      },
    });
    expect(duplicate).toEqual({
      ok: false,
      reason: "repeatHintAlreadyPresent",
    });

    const invalidPosition = applyCommand(baseDocument(), {
      kind: "addRepeatHint",
      graphId: GRAPH_ID,
      hint: {
        hintId: REPEAT_HINT_ID,
        edgeId: EDGE_ID,
        position: { x: Number.POSITIVE_INFINITY, y: 0 },
      },
    });
    expect(invalidPosition).toEqual({
      ok: false,
      reason: "repeatHintPositionInvalid",
    });
  });

  it("clears hints when removing their node and restores the full graph on undo", () => {
    const original = documentWithRepeatHint();
    const outcome = applyCommand(original, {
      kind: "removeNode",
      graphId: GRAPH_ID,
      nodeId: NODE_START,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(graphOf(outcome.document).editorMetadata).toBeUndefined();
    const restored = applyCommand(outcome.document, outcome.inverse);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.document).toEqual(original);
  });
});

describe("value commands", () => {
  it("sets a property that was absent and removes it again", () => {
    const applied = expectRoundTrip({
      kind: "setNodeProperty",
      graphId: GRAPH_ID,
      nodeId: NODE_START,
      propertyKey: "mode",
      value: "strict",
    });

    expect(graphOf(applied).nodes[0]?.properties["mode"]).toBe("strict");
  });

  it("replaces an existing property and restores the previous value", () => {
    const applied = expectRoundTrip({
      kind: "setNodeProperty",
      graphId: GRAPH_ID,
      nodeId: NODE_BRANCH,
      propertyKey: "operator",
      value: "lessThan",
    });

    expect(graphOf(applied).nodes[1]?.properties["operator"]).toBe("lessThan");
  });

  it("clears a property and restores it", () => {
    const applied = expectRoundTrip({
      kind: "setNodeProperty",
      graphId: GRAPH_ID,
      nodeId: NODE_BRANCH,
      propertyKey: "operator",
    });

    expect(
      Object.hasOwn(graphOf(applied).nodes[1]?.properties ?? {}, "operator"),
    ).toBe(false);
  });

  it("sets and clears a literal input", () => {
    const set = expectRoundTrip({
      kind: "setInputValue",
      graphId: GRAPH_ID,
      nodeId: NODE_BRANCH,
      portId: "right",
      value: 42,
    });
    expect(graphOf(set).nodes[1]?.inputValues["right"]).toBe(42);

    const cleared = expectRoundTrip({
      kind: "setInputValue",
      graphId: GRAPH_ID,
      nodeId: NODE_BRANCH,
      portId: "left",
    });
    expect(
      Object.hasOwn(graphOf(cleared).nodes[1]?.inputValues ?? {}, "left"),
    ).toBe(false);
  });
});

describe("graph variable directory", () => {
  const variable = {
    variableId: "11111111-1111-4111-8111-111111111111",
    name: "score",
    valueKind: "number" as const,
    persistent: false,
  };

  it("preserves missing and empty variables fields through undo and redo", () => {
    const original = baseDocument();
    expect(Object.hasOwn(graphOf(original), "variables")).toBe(false);

    const added = expectSuccess(original, {
      kind: "setGraphVariables",
      graphId: GRAPH_ID,
      variables: [variable],
    });
    expect(graphOf(added.document).variables).toEqual([variable]);

    const undone = expectSuccess(added.document, added.inverse);
    expect(undone.document).toEqual(original);
    expect(Object.hasOwn(graphOf(undone.document), "variables")).toBe(false);

    const empty = expectSuccess(original, {
      kind: "setGraphVariables",
      graphId: GRAPH_ID,
      variables: [],
    });
    expect(Object.hasOwn(graphOf(empty.document), "variables")).toBe(true);
    expect(graphOf(empty.document).variables).toEqual([]);

    const removed = expectSuccess(empty.document, {
      kind: "setGraphVariables",
      graphId: GRAPH_ID,
    });
    expect(Object.hasOwn(graphOf(removed.document), "variables")).toBe(false);
    const restoredEmpty = expectSuccess(removed.document, removed.inverse);
    expect(Object.hasOwn(graphOf(restoredEmpty.document), "variables")).toBe(
      true,
    );
    expect(graphOf(restoredEmpty.document).variables).toEqual([]);

    const redone = expectSuccess(undone.document, {
      kind: "setGraphVariables",
      graphId: GRAPH_ID,
      variables: [variable],
    });
    expect(redone.document).toEqual(added.document);
  });

  it("rejects invalid variable directories without changing the graph", () => {
    const cases: {
      reason: CommandFailureReason;
      variables: VariableDefinition[];
    }[] = [
      {
        reason: "variableLimitReached" as const,
        variables: Array.from({ length: 129 }, (_, index) => ({
          ...variable,
          variableId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          name: `v${String(index)}`,
        })),
      },
      {
        reason: "variableIdInvalid" as const,
        variables: [{ ...variable, variableId: "not-a-uuid" }],
      },
      {
        reason: "variableIdDuplicate" as const,
        variables: [variable, { ...variable, name: "other" }],
      },
      {
        reason: "variableNameInvalid" as const,
        variables: [{ ...variable, name: "\u00a0\u00a0" }],
      },
      {
        reason: "variableNameInvalid" as const,
        variables: [{ ...variable, name: "😀".repeat(81) }],
      },
      {
        reason: "variableNameInvalid" as const,
        variables: [{ ...variable, name: ` ${"a".repeat(80)} ` }],
      },
      {
        reason: "variableNameDuplicate" as const,
        variables: [
          variable,
          {
            ...variable,
            variableId: "22222222-2222-4222-8222-222222222222",
            name: "ＳＣＯＲＥ",
          },
        ],
      },
      {
        reason: "variableKindInvalid" as const,
        variables: [
          {
            ...variable,
            valueKind: "decimal" as unknown as VariableDefinition["valueKind"],
          },
        ],
      },
      {
        reason: "variablePersistentImageUnsupported" as const,
        variables: [
          {
            ...variable,
            valueKind: "imageRef",
            persistent: true,
          },
        ],
      },
    ];

    for (const candidate of cases) {
      const outcome = applyCommand(baseDocument(), {
        kind: "setGraphVariables",
        graphId: GRAPH_ID,
        variables: candidate.variables,
      });
      expect(outcome).toEqual({ ok: false, reason: candidate.reason });
    }

    const maximumLength = applyCommand(baseDocument(), {
      kind: "setGraphVariables",
      graphId: GRAPH_ID,
      variables: [{ ...variable, name: "a".repeat(80) }],
    });
    expect(maximumLength.ok).toBe(true);
  });
});

describe("display alias", () => {
  it("sets an alias without changing execution identity", () => {
    const original = baseDocument();
    const applied = expectRoundTrip({
      kind: "setDisplayAlias",
      graphId: GRAPH_ID,
      nodeId: NODE_START,
      displayAlias: "起点",
    });

    const before = graphOf(original).nodes[0];
    const after = graphOf(applied).nodes[0];
    expect(after?.displayAlias).toBe("起点");
    expect(after?.typeKey).toBe(before?.typeKey);
    expect(after?.typeVersion).toBe(before?.typeVersion);
    expect(after?.nodeId).toBe(before?.nodeId);
    expect(after?.inputValues).toEqual(before?.inputValues);
  });

  it("clears an alias back to absent rather than to an empty value", () => {
    const withAlias = expectSuccess(baseDocument(), {
      kind: "setDisplayAlias",
      graphId: GRAPH_ID,
      nodeId: NODE_START,
      displayAlias: "起点",
    });

    const cleared = expectSuccess(withAlias.document, {
      kind: "setDisplayAlias",
      graphId: GRAPH_ID,
      nodeId: NODE_START,
    });

    expect(
      Object.hasOwn(graphOf(cleared.document).nodes[0] ?? {}, "displayAlias"),
    ).toBe(false);
    // The absent form is the one the canonical schema accepts.
    expect(isValidProjectDocument(cleared.document)).toBe(true);
  });
});

describe("area comments", () => {
  const comment = {
    commentId: "aa9fceb2-d6e7-42f3-8e16-80910213245f",
    text: "登录区域",
    position: { x: 48, y: 72 },
    size: { width: 360, height: 180 },
  };

  it("adds a sized comment and removes it through the inverse", () => {
    const applied = expectRoundTrip({
      kind: "addComment",
      graphId: GRAPH_ID,
      comment,
    });

    expect(graphOf(applied).editorMetadata?.comments).toEqual([comment]);
  });

  it("replaces comment text and geometry without changing its identity", () => {
    const added = expectSuccess(baseDocument(), {
      kind: "addComment",
      graphId: GRAPH_ID,
      comment,
    });
    const replaced = expectSuccess(added.document, {
      kind: "replaceComment",
      graphId: GRAPH_ID,
      comment: {
        ...comment,
        text: "战斗区域",
        position: { x: 96, y: 104 },
        size: { width: 420, height: 240 },
      },
    });

    expect(
      graphOf(replaced.document).editorMetadata?.comments?.[0],
    ).toMatchObject({
      commentId: comment.commentId,
      text: "战斗区域",
      position: { x: 96, y: 104 },
      size: { width: 420, height: 240 },
    });
  });
});

describe("composite commands", () => {
  it("undoes every step in reverse order", () => {
    const applied = expectRoundTrip({
      kind: "composite",
      label: "insertPair",
      commands: [
        { kind: "addNode", graphId: GRAPH_ID, node: node(NODE_NEW) },
        {
          kind: "addEdge",
          graphId: GRAPH_ID,
          edge: {
            edgeId: EDGE_NEW,
            edgeKind: "execution",
            sourceNodeId: NODE_NEW,
            sourcePortId: "next",
            targetNodeId: NODE_BRANCH,
            targetPortId: "run",
          },
        },
      ],
    });

    expect(graphOf(applied).nodes).toHaveLength(3);
    expect(graphOf(applied).edges).toHaveLength(2);
  });

  it("applies nothing when any step fails", () => {
    const original = baseDocument();
    const outcome = applyCommand(original, {
      kind: "composite",
      label: "partiallyInvalid",
      commands: [
        { kind: "addNode", graphId: GRAPH_ID, node: node(NODE_NEW) },
        { kind: "removeNode", graphId: GRAPH_ID, nodeId: "missing-node" },
      ],
    });

    expect(outcome).toEqual({ ok: false, reason: "nodeMissing" });
  });
});

describe("immutability", () => {
  it("never mutates the document it was given", () => {
    const original = baseDocument();
    const snapshot = structuredClone(original);

    applyCommand(original, {
      kind: "removeNode",
      graphId: GRAPH_ID,
      nodeId: NODE_START,
    });
    applyCommand(original, {
      kind: "setInputValue",
      graphId: GRAPH_ID,
      nodeId: NODE_BRANCH,
      portId: "left",
      value: 99,
    });

    expect(original).toEqual(snapshot);
  });

  it("shares the graphs a command did not touch", () => {
    const original = baseDocument();
    const second: RinoProjectDocumentV1 = {
      ...original,
      graphs: [
        ...original.graphs,
        {
          graphId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          name: "第二张图",
          kind: "entry",
          nodes: [],
          edges: [],
        },
      ],
    };

    const applied = expectSuccess(second, {
      kind: "moveNode",
      graphId: GRAPH_ID,
      nodeId: NODE_START,
      position: { x: 10, y: 10 },
    });

    expect(applied.document.graphs[1]).toBe(second.graphs[1]);
  });
});

describe("edge cases carried by the round trip", () => {
  it("keeps a removed edge's ports and kind on restore", () => {
    const original = baseDocument();
    const removed = expectSuccess(original, {
      kind: "removeEdge",
      graphId: GRAPH_ID,
      edgeId: EDGE_ID,
    });
    const restored = expectSuccess(removed.document, removed.inverse);

    const edge: EdgeV1 | undefined = graphOf(restored.document).edges[0];
    expect(edge).toEqual(graphOf(original).edges[0]);
  });
});

describe("task graph commands", () => {
  const secondGraphId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  function twoGraphDocument(): RinoProjectDocumentV1 {
    const original = baseDocument();
    return {
      ...original,
      graphs: [
        ...original.graphs,
        {
          graphId: secondGraphId,
          name: "刷金币",
          kind: "entry",
          nodes: [],
          edges: [],
        },
      ],
    };
  }

  it("adds, renames, changes the default, and removes a graph reversibly", () => {
    const original = twoGraphDocument();
    const graph = {
      graphId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      name: "刷钻石",
      kind: "entry" as const,
      nodes: [],
      edges: [],
    };

    const added = expectSuccess(original, { kind: "addGraph", graph });
    expect(added.document.graphs[2]).toEqual(graph);
    expectSuccess(added.document, added.inverse);

    const renamed = expectSuccess(original, {
      kind: "renameGraph",
      graphId: secondGraphId,
      name: "  刷体力  ",
    });
    expect(renamed.document.graphs[1]?.name).toBe("刷体力");
    expectSuccess(renamed.document, renamed.inverse);

    const defaulted = expectSuccess(original, {
      kind: "setEntryGraph",
      graphId: secondGraphId,
    });
    expect(defaulted.document.entryGraphId).toBe(secondGraphId);
    expectSuccess(defaulted.document, defaulted.inverse);

    const removed = expectSuccess(defaulted.document, {
      kind: "removeGraph",
      graphId: GRAPH_ID,
    });
    expect(
      removed.document.graphs.map((candidate) => candidate.graphId),
    ).toEqual([secondGraphId]);
    expectSuccess(removed.document, removed.inverse);
  });

  it("rejects invalid graph operations and preserves the original document", () => {
    const original = twoGraphDocument();
    const existingGraph = original.graphs[0];
    if (existingGraph === undefined) {
      throw new Error("The fixture must hold a graph.");
    }
    const duplicate = applyCommand(original, {
      kind: "addGraph",
      graph: existingGraph,
    });
    expect(duplicate).toEqual({ ok: false, reason: "graphAlreadyPresent" });

    expect(
      applyCommand(original, {
        kind: "renameGraph",
        graphId: GRAPH_ID,
        name: "   ",
      }),
    ).toEqual({ ok: false, reason: "graphNameInvalid" });
    expect(
      applyCommand(original, {
        kind: "renameGraph",
        graphId: GRAPH_ID,
        name: "x".repeat(201),
      }),
    ).toEqual({ ok: false, reason: "graphNameInvalid" });
    expect(
      applyCommand(original, { kind: "removeGraph", graphId: GRAPH_ID }),
    ).toEqual({ ok: false, reason: "cannotRemoveEntryGraph" });

    const only = baseDocument();
    expect(
      applyCommand(only, { kind: "removeGraph", graphId: GRAPH_ID }),
    ).toEqual({ ok: false, reason: "cannotRemoveOnlyGraph" });

    const full = {
      ...original,
      graphs: Array.from({ length: 64 }, (_, index) => ({
        graphId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        name: `任务${String(index + 1)}`,
        kind: "entry" as const,
        nodes: [],
        edges: [],
      })),
    };
    expect(
      applyCommand(full, {
        kind: "addGraph",
        graph: {
          graphId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          name: "第65个",
          kind: "entry",
          nodes: [],
          edges: [],
        },
      }),
    ).toEqual({ ok: false, reason: "graphLimitReached" });
  });

  it("rolls back a default deletion composite when a later step fails", () => {
    const original = twoGraphDocument();
    const outcome = applyCommand(original, {
      kind: "composite",
      label: "deleteTask",
      commands: [
        { kind: "setEntryGraph", graphId: secondGraphId },
        { kind: "removeGraph", graphId: "missing" },
      ],
    });

    expect(outcome).toEqual({ ok: false, reason: "graphMissing" });
    expect(original.entryGraphId).toBe(GRAPH_ID);
    expect(original.graphs).toHaveLength(2);
  });
});
