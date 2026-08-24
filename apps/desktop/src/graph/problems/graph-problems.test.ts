import type {
  FunctionSignatureV1,
  GraphV1,
  NodeV1,
  RinoNodeRegistrySnapshotV1,
  RinoProjectDocumentV1,
} from "@rino/contracts";
import { describe, expect, it } from "vitest";

import coreDefinitions from "../../../../../contracts/fixtures/registry/valid/core-definitions.json";
import { validateProjectDocument } from "../validate-graph";
import { createIncrementalValidation } from "./incremental-validation";
import { countProblems, focusTargetOf, orderProblems } from "./problem-model";

const registrySnapshot =
  coreDefinitions as unknown as RinoNodeRegistrySnapshotV1;

const GRAPH_MAIN = "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e";
const GRAPH_SECOND = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const NODE_START = "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80";
const NODE_COMPARE = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";
const NODE_LITERAL = "6a5c9b8f-a3b4-4fc0-9be3-5d6e7f809102";
const NODE_OCR = "7b6dac90-b4c5-40d1-8cf4-6e7f80910213";
const NODE_CALL = "8c7ebda1-c5d6-41e2-9d05-7f8091021324";

function node(
  nodeId: string,
  typeKey: string,
  overrides: Partial<NodeV1> = {},
): NodeV1 {
  return {
    nodeId,
    typeKey,
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
    ...overrides,
  };
}

function graph(graphId: string, nodes: NodeV1[]): GraphV1 {
  return { graphId, name: "图", kind: "entry", nodes, edges: [] };
}

function document(graphs: GraphV1[]): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "1b0d4c3a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    metadata: {
      name: "测试项目",
      createdAt: "2026-07-27T10:00:00Z",
      updatedAt: "2026-07-27T10:00:00Z",
    },
    entryGraphId: GRAPH_MAIN,
    graphs,
    assets: [],
    requiredCapabilities: [],
  };
}

/** The graph an edit will replace, and the one it must leave alone. Both carry at least
 * one diagnostic, so a revalidation has something to reuse and something to recompute. */
function mainGraph(): GraphV1 {
  return graph(GRAPH_MAIN, [
    node(NODE_START, "core.flow.start"),
    node(NODE_COMPARE, "core.logic.numberCompare"),
  ]);
}

function secondGraph(): GraphV1 {
  return graph(GRAPH_SECOND, [node(NODE_LITERAL, "core.value.numberLiteral")]);
}

function functionGraph(portId: string): GraphV1 {
  const signature: FunctionSignatureV1 = {
    inputs: [
      {
        parameterId: "8d7ebda1-c5d6-41e2-9d05-7f8091021324",
        portId,
        name: "value",
        valueKind: "number",
      },
    ],
    outputs: [],
  };
  return {
    graphId: GRAPH_SECOND,
    name: "函数图",
    kind: "function",
    functionSignature: signature,
    nodes: [
      node("9e8fceb2-d6e7-42f3-8e16-80910213245a", "core.function.input"),
      node("af90dfc3-e7f8-4304-9f27-910213245f60", "core.function.return"),
    ],
    edges: [],
  };
}

function callGraph(targetGraphId: string, portId: string): GraphV1 {
  return graph(GRAPH_MAIN, [
    node(NODE_START, "core.flow.start"),
    node(NODE_CALL, "core.function.call", {
      properties: { functionGraphId: targetGraphId },
      inputValues: { [portId]: 1 },
    }),
  ]);
}

function diagnosticsOfGraph(
  report: ReturnType<typeof validateProjectDocument>,
  graphId: string,
) {
  return report.diagnostics.filter(
    (diagnostic) =>
      diagnostic.location.scope !== "document" &&
      diagnostic.location.scope !== "asset" &&
      diagnostic.location.graphId === graphId,
  );
}

describe("incremental validation", () => {
  it("revalidates a call when an unchanged call graph gets a new target signature", () => {
    const validation = createIncrementalValidation();
    const call = callGraph(GRAPH_SECOND, "value");
    const target = functionGraph("value");
    const initial = document([call, target]);

    expect(validation.validate(initial, registrySnapshot)).toEqual(
      validateProjectDocument(initial, registrySnapshot),
    );
    expect(call).toBe(initial.graphs[0]);

    target.functionSignature = {
      inputs: [
        {
          parameterId: "8d7ebda1-c5d6-41e2-9d05-7f8091021324",
          portId: "point",
          name: "point",
          valueKind: "point",
        },
      ],
      outputs: [],
    };
    const changed = document([call, target]);
    const incremental = validation.validate(changed, registrySnapshot);

    expect(incremental).toEqual(
      validateProjectDocument(changed, registrySnapshot),
    );
    expect(
      diagnosticsOfGraph(incremental, GRAPH_MAIN).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toEqual(["NODE_INPUT_VALUE_UNKNOWN_PORT", "NODE_REQUIRED_INPUT_MISSING"]);
  });

  it("produces exactly what a full validation produces", () => {
    const validation = createIncrementalValidation();
    const untouched = secondGraph();
    const first = document([mainGraph(), untouched]);

    expect(validation.validate(first, registrySnapshot)).toEqual(
      validateProjectDocument(first, registrySnapshot),
    );

    // An edit replaces the graph it touched and leaves the other graph object identical,
    // which is what an incremental pass keys on.
    const second = document([
      graph(GRAPH_MAIN, [node(NODE_COMPARE, "core.logic.numberCompare")]),
      untouched,
    ]);

    expect(validation.validate(second, registrySnapshot)).toEqual(
      validateProjectDocument(second, registrySnapshot),
    );
  });

  it("reuses the diagnostics of a graph the edit did not touch", () => {
    const validation = createIncrementalValidation();
    const untouched = secondGraph();
    const before = validation.validate(
      document([mainGraph(), untouched]),
      registrySnapshot,
    );
    const after = validation.validate(
      document([
        graph(GRAPH_MAIN, [node(NODE_START, "core.flow.start")]),
        untouched,
      ]),
      registrySnapshot,
    );

    const reused = diagnosticsOfGraph(after, GRAPH_SECOND);
    const beforeDiagnostics = diagnosticsOfGraph(before, GRAPH_SECOND);
    expect(reused).toHaveLength(2);
    // Structure diagnostics are recomputed on every document pass; graph diagnostics are
    // the cached objects whose identity proves the untouched graph was reused.
    expect(reused[0]).not.toBe(beforeDiagnostics[0]);
    expect(reused[1]).toBe(beforeDiagnostics[1]);
  });

  it("recomputes every graph when the registry snapshot changes", () => {
    const validation = createIncrementalValidation();
    const openDocument = document([mainGraph(), secondGraph()]);
    const before = validation.validate(openDocument, registrySnapshot);

    const replacementRegistry: RinoNodeRegistrySnapshotV1 = {
      ...registrySnapshot,
    };
    const after = validation.validate(openDocument, replacementRegistry);

    expect(after.diagnostics).toEqual(before.diagnostics);
    expect(after.diagnostics[0]).not.toBe(before.diagnostics[0]);
  });

  it("recomputes when the advertised capabilities change", () => {
    const validation = createIncrementalValidation();
    const openDocument = document([
      graph(GRAPH_MAIN, [
        node(NODE_START, "core.flow.start"),
        node(NODE_OCR, "vision.ocr"),
      ]),
    ]);

    const capabilitiesUnknown = validation.validate(
      openDocument,
      registrySnapshot,
    );
    const capabilitiesEmpty = validation.validate(
      openDocument,
      registrySnapshot,
      { availableCapabilities: [] },
    );

    expect(
      capabilitiesEmpty.diagnostics.map((diagnostic) => diagnostic.code),
    ).toContain("NODE_CAPABILITY_UNAVAILABLE");
    expect(
      capabilitiesUnknown.diagnostics.map((diagnostic) => diagnostic.code),
    ).not.toContain("NODE_CAPABILITY_UNAVAILABLE");
  });

  it("forgets a graph the document no longer contains", () => {
    const validation = createIncrementalValidation();
    const removed = secondGraph();
    validation.validate(document([mainGraph(), removed]), registrySnapshot);

    const withoutSecond = document([mainGraph()]);
    expect(validation.validate(withoutSecond, registrySnapshot)).toEqual(
      validateProjectDocument(withoutSecond, registrySnapshot),
    );

    // Restoring an equal but distinct graph must revalidate rather than serve a stale
    // entry that no longer describes anything in the document.
    const restored = document([mainGraph(), secondGraph()]);
    expect(validation.validate(restored, registrySnapshot)).toEqual(
      validateProjectDocument(restored, registrySnapshot),
    );
  });
});

describe("problem model", () => {
  it("lists what blocks a run before what only warns, keeping validator order", () => {
    const report = validateProjectDocument(
      document([
        graph(GRAPH_MAIN, [
          node(NODE_START, "core.flow.start"),
          node(NODE_OCR, "vision.ocr"),
        ]),
      ]),
      registrySnapshot,
      { availableCapabilities: [] },
    );
    const problems = orderProblems(report.diagnostics);
    const counts = countProblems(problems);

    expect(counts.errors).toBeGreaterThan(0);
    expect(counts.warnings).toBeGreaterThan(0);
    expect(
      problems.slice(0, counts.errors).every((p) => p.severity === "error"),
    ).toBe(true);
    expect(
      problems.slice(counts.errors).every((p) => p.severity === "warning"),
    ).toBe(true);
  });

  it("gives every problem a key that is unique and stable", () => {
    const report = validateProjectDocument(
      document([
        graph(GRAPH_MAIN, [node(NODE_COMPARE, "core.logic.numberCompare")]),
      ]),
      registrySnapshot,
    );
    const keys = orderProblems(report.diagnostics).map(
      (problem) => problem.key,
    );

    expect(keys.length).toBeGreaterThan(1);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      orderProblems(report.diagnostics).map((problem) => problem.key),
    ).toEqual(keys);
  });

  it("navigates to elements the editor can show and to nothing else", () => {
    expect(focusTargetOf({ scope: "document" })).toBeUndefined();
    expect(focusTargetOf({ scope: "asset", assetId: "a" })).toBeUndefined();
    expect(
      focusTargetOf({
        scope: "port",
        graphId: GRAPH_MAIN,
        nodeId: NODE_COMPARE,
        portId: "left",
      }),
    ).toEqual({
      graphId: GRAPH_MAIN,
      nodeId: NODE_COMPARE,
      edgeId: undefined,
      portId: "left",
    });
    expect(
      focusTargetOf({ scope: "edge", graphId: GRAPH_MAIN, edgeId: "e" }),
    ).toEqual({
      graphId: GRAPH_MAIN,
      nodeId: undefined,
      edgeId: "e",
      portId: undefined,
    });
  });
});
