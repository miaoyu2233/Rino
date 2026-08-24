import {
  isValidDiagnosticReport,
  isValidProjectDocument,
  isValidRegistrySnapshot,
  type FunctionParameterV1,
  type FunctionSignatureV1,
  type GraphV1,
  type EdgeV1,
  type GraphDiagnosticCodeV1,
  type NodeV1,
  type NodeDefinitionV1,
  type PortDefinitionV1,
  type RinoNodeRegistrySnapshotV1,
  type RinoProjectDocumentV1,
} from "@rino/contracts";
import { describe, expect, it } from "vitest";

import coreDefinitions from "../../../../contracts/fixtures/registry/valid/core-definitions.json";
import { validateProjectDocument } from "./validate-graph";

// The shared fixture is imported at build time rather than read from disk, so this
// browser-context module stays free of Node APIs while the editor and the contract tests
// still validate against one registry.
const registrySnapshot =
  coreDefinitions as unknown as RinoNodeRegistrySnapshotV1;

/** Identifiers are spelled out so a fixture reads as a graph rather than as noise. */
const NODE_START = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const NODE_LITERAL = "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80";
const NODE_COMPARE = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";
const NODE_BRANCH = "6a5c9b8f-a3b4-4fc0-9be3-5d6e7f809102";
const NODE_OCR = "7b6dac90-b4c5-40d1-8cf4-6e7f80910213";
const NODE_SEQUENCE = "8c7ebda1-c5d6-41e2-9d05-7f8091021324";
const NODE_CAPTURE = "9d8fceb2-d6e7-42f3-8e16-80910213245a";
const NODE_CLICK = "ae90dfc3-e7f8-4304-9f27-910213245f60";
const NODE_PARALLEL_ONE = "bfa1e0d4-f809-4415-8038-0213245f6071";
const NODE_PARALLEL_TWO = "c012f3e5-a9b0-4526-b149-b1324567f809";
const GRAPH_ID = "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e";
const FUNCTION_GRAPH_ID = "d12304f6-b0c1-4637-c25a-c2435678f90a";
const FUNCTION_PARAMETER_A = "e23415a7-c1d2-4748-d36a-d3546789f01b";
const FUNCTION_PARAMETER_B = "f34526b8-d2e3-4859-e47b-e4657890a12c";
const FUNCTION_PARAMETER_C = "a45637c9-e3f4-496a-f58c-f5768901b23d";

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

let edgeCounter = 0;
function edge(overrides: Partial<EdgeV1> & Pick<EdgeV1, "edgeKind">): EdgeV1 {
  edgeCounter += 1;
  const suffix = edgeCounter.toString(16).padStart(12, "0");
  return {
    edgeId: `aaaaaaaa-bbbb-4ccc-8ddd-${suffix}`,
    sourceNodeId: NODE_START,
    sourcePortId: "next",
    targetNodeId: NODE_BRANCH,
    targetPortId: "run",
    ...overrides,
  };
}

function document(nodes: NodeV1[], edges: EdgeV1[]): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "1b0d4c3a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    metadata: {
      name: "测试项目",
      createdAt: "2026-07-26T10:00:00Z",
      updatedAt: "2026-07-26T10:00:00Z",
    },
    entryGraphId: GRAPH_ID,
    graphs: [{ graphId: GRAPH_ID, name: "主图", kind: "entry", nodes, edges }],
    assets: [],
    requiredCapabilities: [],
  };
}

function functionParameter(
  parameterId: string,
  portId: string,
  name: string,
  valueKind: FunctionParameterV1["valueKind"] = "string",
): FunctionParameterV1 {
  return { parameterId, portId, name, valueKind };
}

function functionSignature(
  inputs: FunctionParameterV1[] = [],
  outputs: FunctionParameterV1[] = [],
): FunctionSignatureV1 {
  return {
    inputs: inputs as FunctionSignatureV1["inputs"],
    outputs: outputs as FunctionSignatureV1["outputs"],
  };
}

function functionGraph(
  graphId = FUNCTION_GRAPH_ID,
  signature: FunctionSignatureV1 = functionSignature(),
  nodes: NodeV1[] = [],
  edges: EdgeV1[] = [],
): GraphV1 {
  return {
    graphId,
    name: "函数图",
    kind: "function",
    functionSignature: signature,
    nodes,
    edges,
  };
}

function testUuid(index: number): string {
  return `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
}

function functionCallNode(
  nodeId: string,
  target: string | number | undefined,
  inputValues: NodeV1["inputValues"] = {},
): NodeV1 {
  return node(nodeId, "core.function.call", {
    properties: target === undefined ? {} : { functionGraphId: target },
    inputValues,
  });
}

function functionGraphWithBody(
  graphId: string,
  signature: FunctionSignatureV1 = functionSignature(),
  extraNodes: NodeV1[] = [],
  edges: EdgeV1[] = [],
): GraphV1 {
  return functionGraph(
    graphId,
    signature,
    [
      node(
        testUuid(4000 + Number.parseInt(graphId.slice(0, 4), 16)),
        "core.function.input",
      ),
      node(
        testUuid(5000 + Number.parseInt(graphId.slice(0, 4), 16)),
        "core.function.return",
      ),
      ...extraNodes,
    ],
    edges,
  );
}

function documentWithGraphs(
  graphs: GraphV1[],
  entryGraphId = GRAPH_ID,
): RinoProjectDocumentV1 {
  return { ...document([], []), entryGraphId, graphs };
}

function entryGraph(): GraphV1 {
  const graph = document([], []).graphs[0];
  if (graph === undefined) {
    throw new Error("The fixture must hold an entry graph.");
  }
  return graph;
}

function codesOf(
  documentValue: RinoProjectDocumentV1,
  availableCapabilities?: readonly string[],
  registry: RinoNodeRegistrySnapshotV1 = registrySnapshot,
): GraphDiagnosticCodeV1[] {
  const report = validateProjectDocument(
    documentValue,
    registry,
    availableCapabilities ? { availableCapabilities } : {},
  );
  // Every produced report must itself satisfy the canonical diagnostics contract.
  expect(
    isValidDiagnosticReport({
      schemaVersion: 1,
      diagnostics: report.diagnostics,
    }),
  ).toBe(true);
  return report.diagnostics.map((diagnostic) => diagnostic.code);
}

const CLICK_POINT_INPUT_CASES = [
  { mode: "point", ports: ["point"] },
  {
    mode: "coordinates",
    ports: ["image", "x", "y", "referenceWidth", "referenceHeight"],
  },
  { mode: "randomPoints", ports: ["points"] },
  { mode: "sequentialPoints", ports: ["points"] },
  { mode: "rectCenter", ports: ["rect"] },
  { mode: "rectRandom", ports: ["rect"] },
] as const;

function clickPointValidationRegistry(): RinoNodeRegistrySnapshotV1 {
  const clickPoint = registrySnapshot.definitions.find(
    (definition) => definition.typeKey === "automation.clickPoint",
  );
  const pointPort = clickPoint?.ports.find((port) => port.portId === "point");
  const imagePort = clickPoint?.ports.find((port) => port.portId === "image");
  if (
    clickPoint === undefined ||
    pointPort === undefined ||
    imagePort === undefined
  ) {
    throw new Error("The registry fixture must define click point ports.");
  }

  const replacedPortIds = new Set(["point", "image", "points", "rect"]);
  const literalPointPort: PortDefinitionV1 = {
    ...pointPort,
    acceptsLiteral: true,
  };
  const literalImagePort: PortDefinitionV1 = {
    ...imagePort,
    acceptsLiteral: true,
  };
  const literalPointsPort: PortDefinitionV1 = {
    ...pointPort,
    portId: "points",
    type: { kind: "collection", element: { kind: "point" } },
    labelKey: "node.automation.clickPoint.port.points",
    acceptsLiteral: true,
  };
  const literalRectPort: PortDefinitionV1 = {
    ...pointPort,
    portId: "rect",
    type: { kind: "rect" },
    labelKey: "node.automation.clickPoint.port.rect",
    acceptsLiteral: true,
  };
  const definition: NodeDefinitionV1 = {
    ...clickPoint,
    ports: [
      ...clickPoint.ports.filter((port) => !replacedPortIds.has(port.portId)),
      literalPointPort,
      literalImagePort,
      literalPointsPort,
      literalRectPort,
    ],
  };
  return {
    ...registrySnapshot,
    definitions: registrySnapshot.definitions.map((candidate) =>
      candidate.typeKey === "automation.clickPoint" ? definition : candidate,
    ),
  };
}

function clickPointInputValues(
  ports: readonly string[],
): NodeV1["inputValues"] {
  const inputValues: NodeV1["inputValues"] = {};
  for (const port of ports) {
    inputValues[port] =
      port === "image"
        ? { source: "capture" }
        : port === "point"
          ? { x: 120, y: 340 }
          : port === "points"
            ? [{ x: 120, y: 340 }]
            : port === "rect"
              ? { x: 0, y: 0, width: 100, height: 100 }
              : 120;
  }
  return inputValues;
}

function clickPointDocument(
  mode: string | undefined,
  inputValues: NodeV1["inputValues"],
): RinoProjectDocumentV1 {
  return document(
    [
      node(NODE_START, "core.flow.start"),
      node(NODE_CLICK, "automation.clickPoint", {
        properties: mode === undefined ? {} : { inputMode: mode },
        inputValues,
      }),
    ],
    [],
  );
}

/** A graph that satisfies every rule, used as the baseline the cases mutate. */
function validDocument(): RinoProjectDocumentV1 {
  return document(
    [
      node(NODE_START, "core.flow.start"),
      node(NODE_LITERAL, "core.value.numberLiteral"),
      node(NODE_COMPARE, "core.logic.numberCompare", {
        inputValues: { left: 0 },
      }),
      node(NODE_BRANCH, "core.logic.branch"),
    ],
    [
      edge({
        edgeKind: "execution",
        sourceNodeId: NODE_START,
        sourcePortId: "next",
        targetNodeId: NODE_BRANCH,
        targetPortId: "run",
      }),
      edge({
        edgeKind: "data",
        sourceNodeId: NODE_LITERAL,
        sourcePortId: "value",
        targetNodeId: NODE_COMPARE,
        targetPortId: "right",
      }),
      edge({
        edgeKind: "data",
        sourceNodeId: NODE_COMPARE,
        sourcePortId: "result",
        targetNodeId: NODE_BRANCH,
        targetPortId: "condition",
      }),
    ],
  );
}

/** A capture-then-recognize graph whose required inputs are satisfied by edges, used for
 * the cases that need a device-backed node without an unrelated failure. */
function recognitionDocument(): RinoProjectDocumentV1 {
  return document(
    [
      node(NODE_START, "core.flow.start"),
      node(NODE_CAPTURE, "automation.captureScreen"),
      node(NODE_OCR, "vision.ocr"),
    ],
    [
      edge({
        edgeKind: "execution",
        sourceNodeId: NODE_START,
        sourcePortId: "next",
        targetNodeId: NODE_CAPTURE,
        targetPortId: "run",
      }),
      edge({
        edgeKind: "execution",
        sourceNodeId: NODE_CAPTURE,
        sourcePortId: "next",
        targetNodeId: NODE_OCR,
        targetPortId: "run",
      }),
      edge({
        edgeKind: "data",
        sourceNodeId: NODE_CAPTURE,
        sourcePortId: "image",
        targetNodeId: NODE_OCR,
        targetPortId: "image",
      }),
    ],
  );
}

describe("baseline", () => {
  it("accepts a graph that satisfies every rule", () => {
    const subject = validDocument();

    expect(isValidProjectDocument(subject)).toBe(true);
    expect(isValidRegistrySnapshot(registrySnapshot)).toBe(true);

    const report = validateProjectDocument(subject, registrySnapshot);
    expect(report.diagnostics).toEqual([]);
    expect(report.executable).toBe(true);
  });
});

describe("document structure", () => {
  it("reports a missing entry graph", () => {
    const subject = validDocument();
    subject.entryGraphId = "00000000-0000-4000-8000-000000000000";

    expect(codesOf(subject)).toContain("GRAPH_ENTRY_GRAPH_MISSING");
  });

  it("reports duplicate node and edge identifiers", () => {
    const subject = validDocument();
    const graph = subject.graphs[0];
    if (!graph) {
      throw new Error("The baseline document must contain one graph.");
    }
    graph.nodes.push(node(NODE_START, "core.flow.start"));
    const firstEdge = graph.edges[0];
    if (!firstEdge) {
      throw new Error("The baseline document must contain one edge.");
    }
    graph.edges.push({ ...firstEdge });

    const codes = codesOf(subject);
    expect(codes).toContain("GRAPH_DUPLICATE_NODE_ID");
    expect(codes).toContain("GRAPH_DUPLICATE_EDGE_ID");
  });

  it("reports a duplicate asset name after normalization", () => {
    const subject = validDocument();
    subject.assets = [
      {
        assetId: "bfa1e0d4-f809-4415-8038-0213245f6071",
        displayName: "Capture-001",
        contentHash:
          "9f2c1a7be3d45608192a3b4c5d6e7f80910213245f60718293a4b5c6d7e8f900",
        mediaType: "image/png",
        byteLength: 1,
        coordinateSpace: { spaceId: "device.main", width: 10, height: 10 },
        sourceKind: "deviceCapture",
        createdAt: "2026-07-26T10:00:00Z",
      },
      {
        assetId: "cfb2f1e5-091a-4526-9149-13245f607182",
        displayName: "  capture-001  ",
        contentHash:
          "0f2c1a7be3d45608192a3b4c5d6e7f80910213245f60718293a4b5c6d7e8f901",
        mediaType: "image/png",
        byteLength: 1,
        coordinateSpace: { spaceId: "device.main", width: 10, height: 10 },
        sourceKind: "deviceCapture",
        createdAt: "2026-07-26T10:00:00Z",
      },
    ];

    expect(codesOf(subject)).toContain("DOCUMENT_DUPLICATE_ASSET_NAME");
  });

  it("requires an entry graph and function graphs by document role", () => {
    const report = validateProjectDocument(
      documentWithGraphs([
        functionGraph(GRAPH_ID),
        { ...entryGraph(), graphId: FUNCTION_GRAPH_ID },
      ]),
      registrySnapshot,
    );

    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "GRAPH_ENTRY_KIND_INVALID",
      "GRAPH_NON_ENTRY_KIND_INVALID",
      "FUNCTION_ENTRY_NODE_MISSING",
      "FUNCTION_RETURN_NODE_MISSING",
    ]);
    expect(report.diagnostics[0]?.location).toEqual({
      scope: "graph",
      graphId: GRAPH_ID,
    });
    expect(report.diagnostics[1]?.location).toEqual({
      scope: "graph",
      graphId: FUNCTION_GRAPH_ID,
    });
  });
});

describe("function graph semantics", () => {
  it("checks parameter identity, normalized names, and forbidden parallel nodes in order", () => {
    const report = validateProjectDocument(
      documentWithGraphs([
        entryGraph(),
        functionGraph(
          FUNCTION_GRAPH_ID,
          functionSignature(
            [
              functionParameter(FUNCTION_PARAMETER_A, "inputPort", " Foo "),
              functionParameter(FUNCTION_PARAMETER_A, "inputPort", "ＦＯＯ"),
            ],
            [
              functionParameter(FUNCTION_PARAMETER_B, "outputPort", "foo"),
              functionParameter(FUNCTION_PARAMETER_C, "resultPort", "Result"),
              functionParameter(
                FUNCTION_PARAMETER_C,
                "resultPort",
                " ｒｅｓｕｌｔ ",
              ),
            ],
          ),
          [
            node(NODE_START, "core.flow.start"),
            node(NODE_PARALLEL_ONE, "core.flow.parallel"),
            node(NODE_PARALLEL_TWO, "core.flow.parallel"),
          ],
        ),
      ]),
      registrySnapshot,
    );

    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "FUNCTION_DUPLICATE_PARAMETER_ID",
      "FUNCTION_DUPLICATE_PARAMETER_ID",
      "FUNCTION_DUPLICATE_PORT_ID",
      "FUNCTION_DUPLICATE_PORT_ID",
      "FUNCTION_DUPLICATE_PARAMETER_NAME",
      "FUNCTION_DUPLICATE_PARAMETER_NAME",
      "FUNCTION_PARALLEL_FORBIDDEN",
      "FUNCTION_PARALLEL_FORBIDDEN",
      "FUNCTION_ENTRY_NODE_MISSING",
      "FUNCTION_RETURN_NODE_MISSING",
    ]);
    expect(report.diagnostics[0]?.parameters).toEqual({
      parameterId: FUNCTION_PARAMETER_A,
    });
    expect(report.diagnostics[4]?.parameters).toEqual({
      name: "ＦＯＯ",
      direction: "input",
    });
    expect(report.diagnostics[5]?.parameters).toEqual({
      name: " ｒｅｓｕｌｔ ",
      direction: "output",
    });
    expect(report.diagnostics[6]?.location).toEqual({
      scope: "node",
      graphId: FUNCTION_GRAPH_ID,
      nodeId: NODE_PARALLEL_ONE,
    });
    expect(report.diagnostics[7]?.location).toEqual({
      scope: "node",
      graphId: FUNCTION_GRAPH_ID,
      nodeId: NODE_PARALLEL_TWO,
    });
  });
});

describe("function node semantics", () => {
  it("validates function roles, reserved ports, and outside-function locations", () => {
    const missing = functionGraph(FUNCTION_GRAPH_ID);
    expect(codesOf(documentWithGraphs([entryGraph(), missing]))).toEqual([
      "FUNCTION_ENTRY_NODE_MISSING",
      "FUNCTION_RETURN_NODE_MISSING",
    ]);

    const multiple = functionGraphWithBody(testUuid(1), functionSignature(), [
      node(testUuid(11), "core.function.input"),
      node(testUuid(12), "core.function.return"),
    ]);
    expect(codesOf(documentWithGraphs([entryGraph(), multiple]))).toEqual([
      "FUNCTION_MULTIPLE_ENTRY_NODES",
    ]);

    const legalMultipleReturns = functionGraph(
      testUuid(2),
      functionSignature(),
      [
        node(testUuid(21), "core.function.input"),
        node(testUuid(22), "core.function.return"),
        node(testUuid(23), "core.function.return"),
      ],
    );
    expect(
      codesOf(documentWithGraphs([entryGraph(), legalMultipleReturns])),
    ).toEqual([]);

    const reserved = functionGraphWithBody(
      testUuid(3),
      functionSignature(
        [functionParameter(testUuid(31), "run", "run", "bool")],
        [functionParameter(testUuid(32), "next", "next", "point")],
      ),
    );
    expect(codesOf(documentWithGraphs([entryGraph(), reserved]))).toEqual([
      "FUNCTION_PARAMETER_PORT_RESERVED",
      "FUNCTION_PARAMETER_PORT_RESERVED",
    ]);

    const outsideInput = node(testUuid(41), "core.function.input");
    const outsideReturn = node(testUuid(42), "core.function.return");
    const outside = entryGraph();
    outside.nodes = [
      node(NODE_START, "core.flow.start"),
      outsideInput,
      outsideReturn,
    ];
    const outsideReport = validateProjectDocument(
      documentWithGraphs([outside]),
      registrySnapshot,
    );
    expect(
      outsideReport.diagnostics.map((diagnostic) => diagnostic.code),
    ).toEqual([
      "FUNCTION_NODE_OUTSIDE_FUNCTION",
      "FUNCTION_NODE_OUTSIDE_FUNCTION",
    ]);
    expect(
      outsideReport.diagnostics.map((diagnostic) => diagnostic.location),
    ).toEqual([
      { scope: "node", graphId: GRAPH_ID, nodeId: outsideInput.nodeId },
      { scope: "node", graphId: GRAPH_ID, nodeId: outsideReturn.nodeId },
    ]);
  });

  it("reports invalid call targets in node order", () => {
    const callNodes = [
      functionCallNode(testUuid(51), undefined),
      functionCallNode(testUuid(52), 7),
      functionCallNode(testUuid(53), "not-a-uuid"),
      functionCallNode(testUuid(54), testUuid(999)),
      functionCallNode(testUuid(55), GRAPH_ID),
    ];
    const entry = entryGraph();
    entry.nodes = [node(NODE_START, "core.flow.start"), ...callNodes];
    const target = functionGraphWithBody(testUuid(5));
    const report = validateProjectDocument(
      documentWithGraphs([entry, target]),
      registrySnapshot,
    );

    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "FUNCTION_CALL_TARGET_MISSING",
      "FUNCTION_CALL_TARGET_MISSING",
      "FUNCTION_CALL_TARGET_MISSING",
      "FUNCTION_CALL_TARGET_MISSING",
      "FUNCTION_CALL_TARGET_NOT_FUNCTION",
    ]);
    expect(report.diagnostics.map((diagnostic) => diagnostic.location)).toEqual(
      callNodes.map((callNode) => ({
        scope: "node",
        graphId: GRAPH_ID,
        nodeId: callNode.nodeId,
      })),
    );
  });

  it("rejects direct and indirect recursion without adding depth errors", () => {
    const directId = testUuid(60);
    const directCall = functionCallNode(testUuid(61), directId);
    const direct = functionGraphWithBody(directId, functionSignature(), [
      directCall,
    ]);
    const directEntry = entryGraph();
    directEntry.nodes = [
      node(NODE_START, "core.flow.start"),
      functionCallNode(testUuid(62), directId),
    ];
    expect(codesOf(documentWithGraphs([directEntry, direct]))).toEqual([
      "FUNCTION_RECURSION_FORBIDDEN",
    ]);

    const firstId = testUuid(63);
    const secondId = testUuid(64);
    const first = functionGraphWithBody(firstId, functionSignature(), [
      functionCallNode(testUuid(65), secondId),
    ]);
    const second = functionGraphWithBody(secondId, functionSignature(), [
      functionCallNode(testUuid(66), firstId),
    ]);
    const indirectEntry = entryGraph();
    indirectEntry.nodes = [
      node(NODE_START, "core.flow.start"),
      functionCallNode(testUuid(67), firstId),
    ];
    expect(codesOf(documentWithGraphs([indirectEntry, first, second]))).toEqual(
      ["FUNCTION_RECURSION_FORBIDDEN", "FUNCTION_RECURSION_FORBIDDEN"],
    );
  });

  it.each([16, 17])(
    "enforces a maximum of sixteen function frames",
    (count) => {
      const graphIds = Array.from({ length: count }, (_, index) =>
        testUuid(100 + index),
      );
      const entry = entryGraph();
      entry.nodes = [
        node(NODE_START, "core.flow.start"),
        functionCallNode(testUuid(200), graphIds[0]),
      ];
      const graphs = [entry];
      for (const [index, graphId] of graphIds.entries()) {
        const nextCall =
          graphIds[index + 1] === undefined
            ? []
            : [functionCallNode(testUuid(300 + index), graphIds[index + 1])];
        graphs.push(
          functionGraphWithBody(graphId, functionSignature(), nextCall),
        );
      }

      const codes = codesOf(documentWithGraphs(graphs));
      expect(codes).toEqual(
        count === 16 ? [] : ["FUNCTION_CALL_DEPTH_EXCEEDED"],
      );
    },
  );

  it("resolves all six value kinds and rejects only unsupported call literals", () => {
    const valueKinds: FunctionParameterV1["valueKind"][] = [
      "bool",
      "number",
      "string",
      "point",
      "rect",
      "imageRef",
    ];
    const inputs = valueKinds.map((valueKind, index) =>
      functionParameter(
        testUuid(400 + index),
        `input${String(index)}`,
        valueKind,
        valueKind,
      ),
    );
    const outputs = valueKinds.map((valueKind, index) =>
      functionParameter(
        testUuid(410 + index),
        `output${String(index)}`,
        valueKind,
        valueKind,
      ),
    );
    const inputNodeId = testUuid(420);
    const returnNodeId = testUuid(421);
    const validEdges = valueKinds.map((_, index) =>
      edge({
        edgeKind: "data",
        sourceNodeId: inputNodeId,
        sourcePortId: `input${String(index)}`,
        targetNodeId: returnNodeId,
        targetPortId: `output${String(index)}`,
      }),
    );
    validEdges.unshift(
      edge({
        edgeKind: "execution",
        sourceNodeId: inputNodeId,
        sourcePortId: "next",
        targetNodeId: returnNodeId,
        targetPortId: "run",
      }),
    );
    const valueGraph = functionGraph(
      testUuid(40),
      functionSignature(inputs, outputs),
      [
        node(inputNodeId, "core.function.input"),
        node(returnNodeId, "core.function.return"),
      ],
      validEdges,
    );
    expect(codesOf(documentWithGraphs([entryGraph(), valueGraph]))).toEqual([]);

    const targetId = testUuid(43);
    const targetInputs = valueKinds.map((valueKind, index) =>
      functionParameter(
        testUuid(430 + index),
        `call${String(index)}`,
        valueKind,
        valueKind,
      ),
    );
    const target = functionGraphWithBody(
      targetId,
      functionSignature(targetInputs),
    );
    const literalValues: NodeV1["inputValues"] = {
      call0: true,
      call1: 1,
      call2: "text",
      call3: { x: 1, y: 2 },
      call4: { x: 1, y: 2, width: 3, height: 4 },
      call5: { assetId: "asset" },
    };
    const literalEntry = entryGraph();
    literalEntry.nodes = [
      node(NODE_START, "core.flow.start"),
      functionCallNode(testUuid(44), targetId, literalValues),
    ];
    expect(codesOf(documentWithGraphs([literalEntry, target]))).toEqual([
      "NODE_INPUT_VALUE_NOT_ACCEPTED",
      "NODE_INPUT_VALUE_NOT_ACCEPTED",
      "NODE_INPUT_VALUE_NOT_ACCEPTED",
    ]);

    const wrongTargetId = testUuid(45);
    const wrongTarget = functionGraphWithBody(
      wrongTargetId,
      functionSignature([
        functionParameter(testUuid(450), "boolInput", "bool", "bool"),
      ]),
    );
    const wrongEntry = entryGraph();
    wrongEntry.nodes = [
      node(NODE_START, "core.flow.start"),
      node(NODE_LITERAL, "core.value.numberLiteral"),
      functionCallNode(testUuid(46), wrongTargetId),
    ];
    wrongEntry.edges = [
      edge({
        edgeKind: "data",
        sourceNodeId: NODE_LITERAL,
        sourcePortId: "value",
        targetNodeId: testUuid(46),
        targetPortId: "boolInput",
      }),
    ];
    expect(codesOf(documentWithGraphs([wrongEntry, wrongTarget]))).toEqual([
      "EDGE_TYPE_INCOMPATIBLE",
    ]);
  });

  it("forbids persistent function variables while preserving entry behavior and order", () => {
    const entry = entryGraph();
    const entryVariable: NonNullable<GraphV1["variables"]>[number] = {
      variableId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000120",
      name: "Entry image",
      valueKind: "imageRef",
      persistent: true,
    };
    entry.variables = [entryVariable];

    const firstFunction = functionGraphWithBody(testUuid(120));
    firstFunction.variables = [
      {
        variableId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000123",
        name: "Local bool",
        valueKind: "bool",
        persistent: true,
      },
      {
        variableId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000124",
        name: "Local image",
        valueKind: "imageRef",
        persistent: true,
      },
    ];
    const secondFunction = functionGraphWithBody(testUuid(125));
    secondFunction.variables = [
      {
        variableId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000128",
        name: "Local number",
        valueKind: "number",
        persistent: true,
      },
    ];

    const report = validateProjectDocument(
      documentWithGraphs([entry, firstFunction, secondFunction]),
      registrySnapshot,
    );
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "GRAPH_VARIABLE_PERSISTENCE_UNSUPPORTED",
      "FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN",
      "GRAPH_VARIABLE_PERSISTENCE_UNSUPPORTED",
      "FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN",
      "FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN",
    ]);
    expect(
      report.diagnostics.map((diagnostic) => diagnostic.parameters),
    ).toEqual([
      {
        variableId: entryVariable.variableId,
        name: entryVariable.name,
        valueKind: entryVariable.valueKind,
      },
      {
        variableId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000123",
        name: "Local bool",
      },
      {
        variableId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000124",
        name: "Local image",
        valueKind: "imageRef",
      },
      {
        variableId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000124",
        name: "Local image",
      },
      {
        variableId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000128",
        name: "Local number",
      },
    ]);
  });
  it("resolves one persistent project variable from entry and function graphs", () => {
    const sharedVariableId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000130";
    const sharedVariable = {
      variableId: sharedVariableId,
      name: "sharedCount",
      valueKind: "number" as const,
      persistent: true,
    };
    const entry = entryGraph();
    entry.nodes = [
      node(NODE_START, "core.flow.start"),
      node(NODE_LITERAL, "core.variable.getNumber", {
        properties: { variableId: sharedVariableId },
      }),
    ];
    const functionBody = functionGraphWithBody(
      testUuid(130),
      functionSignature(),
      [
        node(testUuid(131), "core.variable.setNumber", {
          properties: { variableId: sharedVariableId },
        }),
      ],
    );
    const subject = {
      ...documentWithGraphs([entry, functionBody]),
      variables: [sharedVariable],
    };

    const codes = codesOf(subject);
    expect(codes).not.toContain("FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN");
    expect(codes).not.toContain("NODE_VARIABLE_UNKNOWN");
    expect(codes).not.toContain("NODE_VARIABLE_TYPE_MISMATCH");
  });
});

describe("node definitions", () => {
  it("reports an unknown node type without cascading further failures", () => {
    const subject = document([node(NODE_START, "future.unknownNode")], []);

    const codes = codesOf(subject);
    expect(codes).toContain("NODE_TYPE_UNKNOWN");
    expect(codes).not.toContain("NODE_REQUIRED_INPUT_MISSING");
  });

  it("reports a node saved by a newer definition version", () => {
    const subject = validDocument();
    const target = subject.graphs[0]?.nodes[0];
    if (!target) {
      throw new Error("The baseline document must contain one node.");
    }
    target.typeVersion = 2;

    expect(codesOf(subject)).toContain("NODE_TYPE_VERSION_UNSUPPORTED");
  });

  it("reports a required input satisfied by neither an edge nor a literal", () => {
    const subject = validDocument();
    const compare = subject.graphs[0]?.nodes.find(
      (candidate) => candidate.nodeId === NODE_COMPARE,
    );
    if (!compare) {
      throw new Error("The baseline document must contain the compare node.");
    }
    compare.inputValues = {};

    expect(codesOf(subject)).toContain("NODE_REQUIRED_INPUT_MISSING");
  });

  it.each(CLICK_POINT_INPUT_CASES)(
    "accepts all required inputs for $mode click mode",
    ({ mode, ports }) => {
      const codes = codesOf(
        clickPointDocument(mode, clickPointInputValues(ports)),
        undefined,
        clickPointValidationRegistry(),
      );

      expect(codes).not.toContain("NODE_REQUIRED_INPUT_MISSING");
      expect(codes).not.toContain("NODE_INPUT_VALUE_NOT_ACCEPTED");
    },
  );

  it.each(
    CLICK_POINT_INPUT_CASES.flatMap(({ mode, ports }) =>
      ports.map((missingPort) => ({ mode, ports, missingPort })),
    ),
  )(
    "requires only $missingPort for $mode click mode",
    ({ mode, ports, missingPort }) => {
      const inputValues = clickPointInputValues(
        ports.filter((port) => port !== missingPort),
      );
      const codes = codesOf(
        clickPointDocument(mode, inputValues),
        undefined,
        clickPointValidationRegistry(),
      );

      expect(codes).toContain("NODE_REQUIRED_INPUT_MISSING");
      expect(codes).not.toContain("NODE_INPUT_VALUE_NOT_ACCEPTED");
    },
  );

  it.each([undefined, "legacy-mode"])(
    "keeps point as the fallback for a missing or unknown input mode",
    (mode) => {
      const codes = codesOf(
        clickPointDocument(mode, {}),
        undefined,
        clickPointValidationRegistry(),
      );

      expect(codes).toContain("NODE_REQUIRED_INPUT_MISSING");
      expect(codes).not.toContain("NODE_INPUT_VALUE_NOT_ACCEPTED");
    },
  );

  it("reports a literal written to a port the definition does not declare", () => {
    const subject = validDocument();
    const compare = subject.graphs[0]?.nodes.find(
      (candidate) => candidate.nodeId === NODE_COMPARE,
    );
    if (!compare) {
      throw new Error("The baseline document must contain the compare node.");
    }
    compare.inputValues = { left: 0, unknownPort: 1 };

    expect(codesOf(subject)).toContain("NODE_INPUT_VALUE_UNKNOWN_PORT");
  });

  it("reports a missing capability only once capabilities are known", () => {
    const subject = recognitionDocument();

    expect(codesOf(subject)).not.toContain("NODE_CAPABILITY_UNAVAILABLE");
    expect(codesOf(subject, [])).toContain("NODE_CAPABILITY_UNAVAILABLE");
    expect(
      codesOf(subject, ["automation.captureScreen", "vision.ocr"]),
    ).not.toContain("NODE_CAPABILITY_UNAVAILABLE");
  });

  it("rejects an inline literal on a port that does not accept one", () => {
    const subject = recognitionDocument();
    const ocr = subject.graphs[0]?.nodes.find(
      (candidate) => candidate.nodeId === NODE_OCR,
    );
    if (!ocr) {
      throw new Error("The recognition document must contain the OCR node.");
    }
    // An image is a runtime handle, so the definition does not opt this port in.
    ocr.inputValues = { image: "not-a-handle" };

    expect(codesOf(subject)).toContain("NODE_INPUT_VALUE_NOT_ACCEPTED");
  });
});

describe("edges", () => {
  it("reports an edge whose endpoint node is absent", () => {
    const subject = validDocument();
    subject.graphs[0]?.edges.push(
      edge({
        edgeKind: "execution",
        sourceNodeId: "00000000-0000-4000-8000-00000000dead",
        sourcePortId: "next",
        targetNodeId: NODE_BRANCH,
        targetPortId: "whenTrue",
      }),
    );

    expect(codesOf(subject)).toContain("EDGE_SOURCE_NODE_MISSING");
  });

  it("reports an edge referencing a port the definition does not declare", () => {
    const subject = validDocument();
    subject.graphs[0]?.edges.push(
      edge({
        edgeKind: "execution",
        sourceNodeId: NODE_START,
        sourcePortId: "missingPort",
        targetNodeId: NODE_BRANCH,
        targetPortId: "run",
      }),
    );

    expect(codesOf(subject)).toContain("EDGE_SOURCE_PORT_MISSING");
  });

  it("reports an edge connected against port direction", () => {
    const subject = validDocument();
    subject.graphs[0]?.edges.push(
      edge({
        edgeKind: "execution",
        sourceNodeId: NODE_BRANCH,
        sourcePortId: "run",
        targetNodeId: NODE_BRANCH,
        targetPortId: "whenTrue",
      }),
    );

    // A self connection is reported before direction, because it is the clearer failure.
    expect(codesOf(subject)).toContain("EDGE_SELF_CONNECTION");
  });

  it("reports an execution edge declared as a data edge", () => {
    const subject = validDocument();
    const executionEdge = subject.graphs[0]?.edges[0];
    if (!executionEdge) {
      throw new Error("The baseline document must contain one execution edge.");
    }
    executionEdge.edgeKind = "data";

    expect(codesOf(subject)).toContain("EDGE_KIND_MISMATCH");
  });

  it("reports an incompatible data type", () => {
    const subject = validDocument();
    subject.graphs[0]?.edges.push(
      edge({
        edgeKind: "data",
        sourceNodeId: NODE_COMPARE,
        sourcePortId: "result",
        targetNodeId: NODE_COMPARE,
        targetPortId: "left",
      }),
    );

    // The self connection is caught first; a cross-node boolean into a number is not.
    const crossNode = validDocument();
    crossNode.graphs[0]?.nodes.push(node(NODE_OCR, "vision.ocr"));
    crossNode.graphs[0]?.edges.push(
      edge({
        edgeKind: "data",
        sourceNodeId: NODE_OCR,
        sourcePortId: "matched",
        targetNodeId: NODE_COMPARE,
        targetPortId: "left",
      }),
    );

    expect(codesOf(crossNode)).toContain("EDGE_TYPE_INCOMPATIBLE");
  });

  it("reports a second edge into a data input", () => {
    const subject = validDocument();
    subject.graphs[0]?.nodes.push(
      node("9d8fceb2-d6e7-42f3-8e16-80910213245f", "core.value.numberLiteral"),
    );
    subject.graphs[0]?.edges.push(
      edge({
        edgeKind: "data",
        sourceNodeId: "9d8fceb2-d6e7-42f3-8e16-80910213245f",
        sourcePortId: "value",
        targetNodeId: NODE_COMPARE,
        targetPortId: "right",
      }),
    );

    expect(codesOf(subject)).toContain("EDGE_CARDINALITY_EXCEEDED");
  });

  it("allows many edges from a data output", () => {
    const subject = validDocument();
    subject.graphs[0]?.edges.push(
      edge({
        edgeKind: "data",
        sourceNodeId: NODE_LITERAL,
        sourcePortId: "value",
        targetNodeId: NODE_COMPARE,
        targetPortId: "left",
      }),
    );

    expect(codesOf(subject)).not.toContain("EDGE_CARDINALITY_EXCEEDED");
  });

  it("reports a second edge from an execution output that forbids fan-out", () => {
    const subject = validDocument();
    subject.graphs[0]?.nodes.push(node(NODE_SEQUENCE, "core.flow.sequence"));
    subject.graphs[0]?.edges.push(
      edge({
        edgeKind: "execution",
        sourceNodeId: NODE_START,
        sourcePortId: "next",
        targetNodeId: NODE_SEQUENCE,
        targetPortId: "run",
      }),
    );

    expect(codesOf(subject)).toContain("EDGE_CARDINALITY_EXCEEDED");
  });

  it("allows many edges from an execution output that declares fan-out", () => {
    const subject = document(
      [
        node(NODE_START, "core.flow.start"),
        node(NODE_SEQUENCE, "core.flow.sequence"),
        node(NODE_BRANCH, "core.logic.branch", {
          inputValues: {},
        }),
      ],
      [
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_START,
          sourcePortId: "next",
          targetNodeId: NODE_SEQUENCE,
          targetPortId: "run",
        }),
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_SEQUENCE,
          sourcePortId: "steps",
          targetNodeId: NODE_BRANCH,
          targetPortId: "run",
        }),
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_SEQUENCE,
          sourcePortId: "steps",
          targetNodeId: NODE_BRANCH,
          targetPortId: "run",
        }),
      ],
    );

    expect(codesOf(subject)).not.toContain("EDGE_CARDINALITY_EXCEEDED");
  });
});

describe("graph semantics", () => {
  it("reports a graph with no entry node", () => {
    const subject = document(
      [node(NODE_LITERAL, "core.value.numberLiteral")],
      [],
    );

    expect(codesOf(subject)).toContain("GRAPH_ENTRY_NODE_MISSING");
  });

  it("reports more than one entry node", () => {
    const subject = validDocument();
    subject.graphs[0]?.nodes.push(
      node("9d8fceb2-d6e7-42f3-8e16-80910213245f", "core.flow.start"),
    );

    expect(codesOf(subject)).toContain("GRAPH_MULTIPLE_ENTRY_NODES");
  });

  it("accepts an empty graph without demanding an entry node", () => {
    const subject = document([], []);

    expect(codesOf(subject)).not.toContain("GRAPH_ENTRY_NODE_MISSING");
  });

  it("reports a cycle between pure nodes", () => {
    const first = "9d8fceb2-d6e7-42f3-8e16-80910213245f";
    const second = "ae90dfc3-e7f8-4304-9f27-910213245f60";
    const subject = document(
      [
        node(NODE_START, "core.flow.start"),
        node(first, "core.logic.numberCompare", { inputValues: { left: 0 } }),
        node(second, "core.logic.numberCompare", { inputValues: { left: 0 } }),
      ],
      [
        edge({
          edgeKind: "data",
          sourceNodeId: first,
          sourcePortId: "result",
          targetNodeId: second,
          targetPortId: "right",
        }),
        edge({
          edgeKind: "data",
          sourceNodeId: second,
          sourcePortId: "result",
          targetNodeId: first,
          targetPortId: "right",
        }),
      ],
    );

    expect(codesOf(subject)).toContain("GRAPH_PURE_DATA_CYCLE");
  });

  it("does not mistake a shared pure dependency for a cycle", () => {
    const subject = validDocument();
    subject.graphs[0]?.edges.push(
      edge({
        edgeKind: "data",
        sourceNodeId: NODE_LITERAL,
        sourcePortId: "value",
        targetNodeId: NODE_COMPARE,
        targetPortId: "left",
      }),
    );

    expect(codesOf(subject)).not.toContain("GRAPH_PURE_DATA_CYCLE");
  });

  it("reports the second reachable parallel and locates that node", () => {
    const subject = document(
      [
        node(NODE_START, "core.flow.start"),
        node(NODE_PARALLEL_ONE, "core.flow.parallel"),
        node(NODE_PARALLEL_TWO, "core.flow.parallel"),
      ],
      [
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_START,
          sourcePortId: "next",
          targetNodeId: NODE_PARALLEL_ONE,
          targetPortId: "run",
        }),
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_PARALLEL_ONE,
          sourcePortId: "branch1",
          targetNodeId: NODE_PARALLEL_TWO,
          targetPortId: "run",
        }),
      ],
    );

    const report = validateProjectDocument(subject, registrySnapshot);
    const matching = report.diagnostics.filter(
      (diagnostic) => diagnostic.code === "GRAPH_MULTIPLE_PARALLEL_ON_PATH",
    );

    expect(matching).toHaveLength(1);
    expect(matching[0]?.severity).toBe("error");
    expect(matching[0]?.location).toEqual({
      scope: "node",
      graphId: GRAPH_ID,
      nodeId: NODE_PARALLEL_TWO,
    });
    expect(report.executable).toBe(false);
  });

  it("does not count sibling paths, unreachable nodes, or data edges", () => {
    const siblingPaths = document(
      [
        node(NODE_START, "core.flow.start"),
        node(NODE_SEQUENCE, "core.flow.sequence"),
        node(NODE_PARALLEL_ONE, "core.flow.parallel"),
        node(NODE_PARALLEL_TWO, "core.flow.parallel"),
      ],
      [
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_START,
          sourcePortId: "next",
          targetNodeId: NODE_SEQUENCE,
          targetPortId: "run",
        }),
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_SEQUENCE,
          sourcePortId: "step1",
          targetNodeId: NODE_PARALLEL_ONE,
          targetPortId: "run",
        }),
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_SEQUENCE,
          sourcePortId: "step2",
          targetNodeId: NODE_PARALLEL_TWO,
          targetPortId: "run",
        }),
      ],
    );
    const unreachable = document(
      [
        node(NODE_START, "core.flow.start"),
        node(NODE_PARALLEL_ONE, "core.flow.parallel"),
        node(NODE_PARALLEL_TWO, "core.flow.parallel"),
      ],
      [
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_START,
          sourcePortId: "next",
          targetNodeId: NODE_PARALLEL_ONE,
          targetPortId: "run",
        }),
        edge({
          edgeKind: "data",
          sourceNodeId: NODE_PARALLEL_ONE,
          sourcePortId: "branch1",
          targetNodeId: NODE_PARALLEL_TWO,
          targetPortId: "run",
        }),
      ],
    );

    expect(codesOf(siblingPaths)).not.toContain(
      "GRAPH_MULTIPLE_PARALLEL_ON_PATH",
    );
    expect(codesOf(unreachable)).not.toContain(
      "GRAPH_MULTIPLE_PARALLEL_ON_PATH",
    );
  });

  it("bounds loop traversal and checks every entry path", () => {
    const loopBridge = "d12304f6-b0c1-4637-c25a-c2435678f90a";
    const loop = document(
      [
        node(NODE_START, "core.flow.start"),
        node(NODE_PARALLEL_ONE, "core.flow.parallel"),
        node(loopBridge, "core.logic.branch"),
      ],
      [
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_START,
          sourcePortId: "next",
          targetNodeId: loopBridge,
          targetPortId: "run",
        }),
        edge({
          edgeKind: "execution",
          sourceNodeId: loopBridge,
          sourcePortId: "whenTrue",
          targetNodeId: NODE_PARALLEL_ONE,
          targetPortId: "run",
        }),
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_PARALLEL_ONE,
          sourcePortId: "branch1",
          targetNodeId: loopBridge,
          targetPortId: "run",
        }),
      ],
    );
    const secondStart = "e23415a7-c1d2-4748-d36a-d3546789f01b";
    const multiEntry = document(
      [
        node(NODE_START, "core.flow.start"),
        node(secondStart, "core.flow.start"),
        node(NODE_PARALLEL_ONE, "core.flow.parallel"),
        node(NODE_PARALLEL_TWO, "core.flow.parallel"),
      ],
      [
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_START,
          sourcePortId: "next",
          targetNodeId: NODE_PARALLEL_ONE,
          targetPortId: "run",
        }),
        edge({
          edgeKind: "execution",
          sourceNodeId: secondStart,
          sourcePortId: "next",
          targetNodeId: NODE_PARALLEL_TWO,
          targetPortId: "run",
        }),
        edge({
          edgeKind: "execution",
          sourceNodeId: NODE_PARALLEL_ONE,
          sourcePortId: "branch1",
          targetNodeId: NODE_PARALLEL_TWO,
          targetPortId: "run",
        }),
      ],
    );

    expect(codesOf(loop)).toContain("GRAPH_MULTIPLE_PARALLEL_ON_PATH");
    expect(codesOf(multiEntry)).toContain("GRAPH_MULTIPLE_PARALLEL_ON_PATH");
    expect(codesOf(multiEntry)).toContain("GRAPH_MULTIPLE_ENTRY_NODES");
  });
});

describe("report shape", () => {
  it("marks a document with only warnings as executable", () => {
    const subject = recognitionDocument();

    const report = validateProjectDocument(subject, registrySnapshot, {
      availableCapabilities: [],
    });

    expect(
      report.diagnostics.every(
        (diagnostic) => diagnostic.severity === "warning",
      ),
    ).toBe(true);
    expect(report.executable).toBe(true);
  });

  it("never carries project content in a diagnostic parameter", () => {
    const subject = validDocument();
    const compare = subject.graphs[0]?.nodes.find(
      (candidate) => candidate.nodeId === NODE_COMPARE,
    );
    if (!compare) {
      throw new Error("The baseline document must contain the compare node.");
    }
    compare.displayAlias = "s3cret-alias";
    compare.inputValues = {};
    subject.metadata.name = "s3cret-project";

    const report = validateProjectDocument(subject, registrySnapshot);
    const serialized = JSON.stringify(report.diagnostics);

    expect(serialized).not.toContain("s3cret-alias");
    expect(serialized).not.toContain("s3cret-project");
  });
});
