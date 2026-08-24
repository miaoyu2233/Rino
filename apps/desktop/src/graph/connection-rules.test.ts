import type {
  EdgeV1,
  GraphV1,
  FunctionSignatureV1,
  NodeV1,
  RinoProjectDocumentV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";
import { describe, expect, it } from "vitest";

import coreDefinitions from "../../../../contracts/fixtures/registry/valid/core-definitions.json";
import { connectionRejectionKeys } from "./canvas/connection-messages";
import { evaluateConnection } from "./connection-rules";

const registry = coreDefinitions as unknown as RinoNodeRegistrySnapshotV1;

const START = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const BRANCH = "6a5c9b8f-a3b4-4fc0-9be3-5d6e7f809102";
const SEQUENCE = "2b1a0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d";
const LITERAL = "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80";
const COMPARE = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";
const CAPTURE = "7c6d5e4f-3a2b-4190-8f7e-6d5c4b3a2190";
const OCR = "9a8b7c6d-5e4f-4382-9170-8f7e6d5c4b3a";
const SECOND_LITERAL = "1c0b9a8d-7e6f-4501-8243-3a2b1c0d9e8f";
const PARALLEL_ONE = "bfa1e0d4-f809-4415-8038-0213245f6071";
const PARALLEL_TWO = "c012f3e5-a9b0-4526-b149-b1324567f809";
const FUNCTION_GRAPH = "function-graph";
const FUNCTION_CALL = "function-call";

function node(nodeId: string, typeKey: string): NodeV1 {
  return {
    nodeId,
    typeKey,
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
  };
}

function graphWith(edges: EdgeV1[]): GraphV1 {
  return {
    graphId: "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e",
    name: "主图",
    kind: "entry",
    nodes: [
      node(START, "core.flow.start"),
      node(BRANCH, "core.logic.branch"),
      node(SEQUENCE, "core.flow.sequence"),
      node(LITERAL, "core.value.numberLiteral"),
      node(SECOND_LITERAL, "core.value.numberLiteral"),
      node(COMPARE, "core.logic.numberCompare"),
      node(CAPTURE, "automation.captureScreen"),
      node(OCR, "vision.ocr"),
      node(PARALLEL_ONE, "core.flow.parallel"),
      node(PARALLEL_TWO, "core.flow.parallel"),
    ],
    edges,
  };
}

function functionDocument(
  outputKind: "number" | "string" = "number",
): RinoProjectDocumentV1 {
  const signature: FunctionSignatureV1 = {
    inputs: [],
    outputs: [
      {
        parameterId: "output-parameter",
        portId: "output-value",
        name: "Output value",
        valueKind: outputKind,
      },
    ],
  };
  const entryGraph: GraphV1 = {
    graphId: "function-entry",
    name: "Main graph",
    kind: "entry",
    nodes: [
      {
        ...node(FUNCTION_CALL, "core.function.call"),
        properties: { functionGraphId: FUNCTION_GRAPH },
      },
      node(COMPARE, "core.logic.numberCompare"),
    ],
    edges: [],
  };
  return {
    schemaVersion: 1,
    documentId: "document-id",
    metadata: {
      name: "Project",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    entryGraphId: entryGraph.graphId,
    graphs: [
      entryGraph,
      {
        graphId: FUNCTION_GRAPH,
        name: "Score function",
        kind: "function",
        functionSignature: signature,
        nodes: [
          node("function-input", "core.function.input"),
          node("function-return", "core.function.return"),
        ],
        edges: [],
      },
    ],
    assets: [],
    requiredCapabilities: [],
  };
}

function edge(
  edgeId: string,
  edgeKind: EdgeV1["edgeKind"],
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): EdgeV1 {
  return {
    edgeId,
    edgeKind,
    sourceNodeId,
    sourcePortId,
    targetNodeId,
    targetPortId,
  };
}

describe("accepted connections", () => {
  it("accepts an execution connection and classifies its kind", () => {
    const evaluation = evaluateConnection(graphWith([]), registry, {
      sourceNodeId: START,
      sourcePortId: "next",
      targetNodeId: BRANCH,
      targetPortId: "run",
    });

    expect(evaluation).toEqual({
      accepted: true,
      edgeKind: "execution",
      replaces: [],
    });
  });

  it("accepts a data connection between matching types", () => {
    const evaluation = evaluateConnection(graphWith([]), registry, {
      sourceNodeId: LITERAL,
      sourcePortId: "value",
      targetNodeId: COMPARE,
      targetPortId: "left",
    });

    expect(evaluation).toEqual({
      accepted: true,
      edgeKind: "data",
      replaces: [],
    });
  });

  it("accepts a captured image into the recognition input", () => {
    const evaluation = evaluateConnection(graphWith([]), registry, {
      sourceNodeId: CAPTURE,
      sourcePortId: "image",
      targetNodeId: OCR,
      targetPortId: "image",
    });

    expect(evaluation.accepted).toBe(true);
  });

  it("resolves function call output ports from the project document", () => {
    const document = functionDocument();
    const graph = document.graphs[0];
    if (graph === undefined) {
      throw new Error("Function entry graph is required.");
    }

    expect(
      evaluateConnection(
        graph,
        registry,
        {
          sourceNodeId: FUNCTION_CALL,
          sourcePortId: "output-value",
          targetNodeId: COMPARE,
          targetPortId: "left",
        },
        document,
      ),
    ).toEqual({ accepted: true, edgeKind: "data", replaces: [] });
  });
});

describe("rejected connections", () => {
  it("rejects an incompatible function output type", () => {
    const document = functionDocument("string");
    const graph = document.graphs[0];
    if (graph === undefined) {
      throw new Error("Function entry graph is required.");
    }

    expect(
      evaluateConnection(
        graph,
        registry,
        {
          sourceNodeId: FUNCTION_CALL,
          sourcePortId: "output-value",
          targetNodeId: COMPARE,
          targetPortId: "left",
        },
        document,
      ),
    ).toEqual({ accepted: false, reason: "typeIncompatible" });
  });

  it("maps the parallel-path rejection to a localized message key", () => {
    expect(connectionRejectionKeys.wouldCreateMultipleParallelOnPath).toBe(
      "graph.connection.rejected.wouldCreateMultipleParallelOnPath",
    );
  });

  it("rejects a node connecting to itself", () => {
    expect(
      evaluateConnection(graphWith([]), registry, {
        sourceNodeId: BRANCH,
        sourcePortId: "whenTrue",
        targetNodeId: BRANCH,
        targetPortId: "run",
      }),
    ).toEqual({ accepted: false, reason: "selfConnection" });
  });

  it("rejects an output wired to another output", () => {
    expect(
      evaluateConnection(graphWith([]), registry, {
        sourceNodeId: START,
        sourcePortId: "next",
        targetNodeId: BRANCH,
        targetPortId: "whenTrue",
      }),
    ).toEqual({ accepted: false, reason: "portDirectionMismatch" });
  });

  it("rejects an execution output wired to a data input", () => {
    expect(
      evaluateConnection(graphWith([]), registry, {
        sourceNodeId: START,
        sourcePortId: "next",
        targetNodeId: BRANCH,
        targetPortId: "condition",
      }),
    ).toEqual({ accepted: false, reason: "portKindMismatch" });
  });

  it("rejects incompatible data types", () => {
    expect(
      evaluateConnection(graphWith([]), registry, {
        sourceNodeId: LITERAL,
        sourcePortId: "value",
        targetNodeId: BRANCH,
        targetPortId: "condition",
      }),
    ).toEqual({ accepted: false, reason: "typeIncompatible" });
  });

  it("rejects a connection that already exists", () => {
    const graph = graphWith([
      edge("e1", "execution", START, "next", BRANCH, "run"),
    ]);

    expect(
      evaluateConnection(graph, registry, {
        sourceNodeId: START,
        sourcePortId: "next",
        targetNodeId: BRANCH,
        targetPortId: "run",
      }),
    ).toEqual({ accepted: false, reason: "duplicateConnection" });
  });

  it("rejects an unknown port", () => {
    expect(
      evaluateConnection(graphWith([]), registry, {
        sourceNodeId: START,
        sourcePortId: "notAPort",
        targetNodeId: BRANCH,
        targetPortId: "run",
      }),
    ).toEqual({ accepted: false, reason: "portMissing" });
  });

  it("rejects a connection that would close a cycle between pure nodes", () => {
    // compare.result feeds nothing yet; wiring compare back into itself through the
    // literal would create a dependency loop with no starting point.
    const graph = graphWith([
      edge("e1", "data", LITERAL, "value", COMPARE, "left"),
    ]);

    expect(
      evaluateConnection(graph, registry, {
        sourceNodeId: COMPARE,
        sourcePortId: "result",
        targetNodeId: LITERAL,
        targetPortId: "value",
      }).accepted,
    ).toBe(false);
  });

  it("rejects a second parallel on one execution path", () => {
    const graph = graphWith([
      edge("entry", "execution", START, "next", PARALLEL_ONE, "run"),
    ]);

    expect(
      evaluateConnection(graph, registry, {
        sourceNodeId: PARALLEL_ONE,
        sourcePortId: "branch1",
        targetNodeId: PARALLEL_TWO,
        targetPortId: "run",
      }),
    ).toEqual({
      accepted: false,
      reason: "wouldCreateMultipleParallelOnPath",
    });
  });

  it("rejects a loop that re-enters the same parallel", () => {
    const graph = graphWith([
      edge("entry", "execution", START, "next", PARALLEL_ONE, "run"),
      edge("out", "execution", PARALLEL_ONE, "branch1", BRANCH, "run"),
    ]);

    expect(
      evaluateConnection(graph, registry, {
        sourceNodeId: BRANCH,
        sourcePortId: "whenTrue",
        targetNodeId: PARALLEL_ONE,
        targetPortId: "run",
      }),
    ).toEqual({
      accepted: false,
      reason: "wouldCreateMultipleParallelOnPath",
    });
  });
});

describe("displaced connections", () => {
  it("replaces the edge already occupying a data input", () => {
    const graph = graphWith([
      edge("occupied", "data", LITERAL, "value", COMPARE, "left"),
    ]);

    expect(
      evaluateConnection(graph, registry, {
        sourceNodeId: SECOND_LITERAL,
        sourcePortId: "value",
        targetNodeId: COMPARE,
        targetPortId: "left",
      }),
    ).toEqual({ accepted: true, edgeKind: "data", replaces: ["occupied"] });
  });

  it("leaves a data output feeding as many consumers as it likes", () => {
    const graph = graphWith([
      edge("first", "data", LITERAL, "value", COMPARE, "left"),
    ]);

    expect(
      evaluateConnection(graph, registry, {
        sourceNodeId: LITERAL,
        sourcePortId: "value",
        targetNodeId: COMPARE,
        targetPortId: "right",
      }),
    ).toEqual({ accepted: true, edgeKind: "data", replaces: [] });
  });

  it("accepts several predecessors on one execution input", () => {
    const graph = graphWith([
      edge("first", "execution", START, "next", BRANCH, "run"),
    ]);

    expect(
      evaluateConnection(graph, registry, {
        sourceNodeId: SEQUENCE,
        sourcePortId: "steps",
        targetNodeId: BRANCH,
        targetPortId: "run",
      }),
    ).toEqual({ accepted: true, edgeKind: "execution", replaces: [] });
  });

  it("replaces an execution output that carries one successor", () => {
    const graph = graphWith([
      edge("occupied", "execution", START, "next", BRANCH, "run"),
    ]);

    expect(
      evaluateConnection(graph, registry, {
        sourceNodeId: START,
        sourcePortId: "next",
        targetNodeId: SEQUENCE,
        targetPortId: "run",
      }),
    ).toEqual({
      accepted: true,
      edgeKind: "execution",
      replaces: ["occupied"],
    });
  });

  it("evaluates parallel paths after replacing the occupied execution edge", () => {
    const graph = graphWith([
      edge("occupied", "execution", START, "next", PARALLEL_ONE, "run"),
      edge("second", "execution", PARALLEL_ONE, "branch1", PARALLEL_TWO, "run"),
    ]);

    expect(
      evaluateConnection(graph, registry, {
        sourceNodeId: START,
        sourcePortId: "next",
        targetNodeId: BRANCH,
        targetPortId: "run",
      }),
    ).toEqual({
      accepted: true,
      edgeKind: "execution",
      replaces: ["occupied"],
    });
  });

  it("does not reject an unrelated edit in an already-invalid graph", () => {
    const graph = graphWith([
      edge("entry", "execution", START, "next", PARALLEL_ONE, "run"),
      edge("second", "execution", PARALLEL_ONE, "branch1", PARALLEL_TWO, "run"),
    ]);

    expect(
      evaluateConnection(graph, registry, {
        sourceNodeId: LITERAL,
        sourcePortId: "value",
        targetNodeId: COMPARE,
        targetPortId: "left",
      }),
    ).toEqual({ accepted: true, edgeKind: "data", replaces: [] });
  });

  it("keeps every successor of an execution output that declares fan-out", () => {
    const graph = graphWith([
      edge("first", "execution", SEQUENCE, "steps", BRANCH, "run"),
    ]);

    expect(
      evaluateConnection(graph, registry, {
        sourceNodeId: SEQUENCE,
        sourcePortId: "steps",
        targetNodeId: CAPTURE,
        targetPortId: "run",
      }),
    ).toEqual({
      accepted: true,
      edgeKind: "execution",
      replaces: [],
    });
  });
});
