import {
  type EdgeV1,
  type FunctionParameterV1,
  type FunctionSignatureV1,
  type GraphV1,
  type NodeV1,
  type RinoProjectDocumentV1,
} from "@rino/contracts";
import { describe, expect, it } from "vitest";

import { applyCommand, type GraphCommand } from "../commands/graph-commands";
import {
  buildAddFunctionParameterCommand,
  buildChangeFunctionParameterKindCommand,
  buildCreateFunctionGraphCommand,
  buildInsertFunctionCallCommand,
  buildRemoveFunctionParameterCommand,
  buildRenameFunctionParameterCommand,
} from "./function-authoring";

const ENTRY_ID = "00000000-0000-4000-8000-000000000001";
const FUNCTION_ID = "00000000-0000-4000-8000-000000000010";
const INPUT_NODE_ID = "00000000-0000-4000-8000-000000000011";
const RETURN_NODE_ID = "00000000-0000-4000-8000-000000000012";
const FUNCTION_EDGE_ID = "00000000-0000-4000-8000-000000000013";
const START_NODE_ID = "00000000-0000-4000-8000-000000000020";

function identifier(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function portFromIdentifier(value: string): string {
  return `p${value.replace(/-/gu, "").toLowerCase()}`;
}

function identifiers(...values: string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("The test identifier factory ran out of identifiers.");
    }
    return value;
  };
}

function parameter(
  parameterId: string,
  portId: string,
  name: string,
  valueKind: FunctionParameterV1["valueKind"] = "number",
): FunctionParameterV1 {
  return { parameterId, portId, name, valueKind };
}

function signature(
  inputs: FunctionParameterV1[] = [],
  outputs: FunctionParameterV1[] = [],
): FunctionSignatureV1 {
  return {
    inputs: inputs as FunctionSignatureV1["inputs"],
    outputs: outputs as FunctionSignatureV1["outputs"],
  };
}

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

function edge(
  edgeId: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
  edgeKind: EdgeV1["edgeKind"] = "data",
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

function functionGraph(
  graphId: string = FUNCTION_ID,
  functionSignature: FunctionSignatureV1 = signature(),
  nodes: NodeV1[] = [
    node(INPUT_NODE_ID, "core.function.input"),
    node(RETURN_NODE_ID, "core.function.return"),
  ],
  edges: EdgeV1[] = [
    edge(
      FUNCTION_EDGE_ID,
      INPUT_NODE_ID,
      "next",
      RETURN_NODE_ID,
      "run",
      "execution",
    ),
  ],
): GraphV1 {
  return {
    graphId,
    name: "函数",
    kind: "function",
    functionSignature,
    nodes,
    edges,
  };
}

function baseDocument(
  functions: GraphV1[] = [functionGraph()],
): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: identifier(100),
    metadata: {
      name: "函数编辑测试",
      createdAt: "2026-08-22T00:00:00Z",
      updatedAt: "2026-08-22T00:00:00Z",
    },
    entryGraphId: ENTRY_ID,
    graphs: [
      {
        graphId: ENTRY_ID,
        name: "入口",
        kind: "entry",
        nodes: [node(START_NODE_ID, "core.flow.start")],
        edges: [],
      },
      ...functions,
    ],
    assets: [],
    requiredCapabilities: [],
  };
}

function applySuccess(document: RinoProjectDocumentV1, command: GraphCommand) {
  const outcome = applyCommand(document, command);
  if (!outcome.ok) throw new Error(`Expected success, got ${outcome.reason}`);
  return outcome;
}

function graphOf(document: RinoProjectDocumentV1, graphId: string): GraphV1 {
  const graph = document.graphs.find(
    (candidate) => candidate.graphId === graphId,
  );
  if (graph === undefined) throw new Error(`Missing graph ${graphId}`);
  return graph;
}

describe("function graph authoring", () => {
  it("creates a bounded function graph without a default connection and supports undo", () => {
    const original = baseDocument();
    const built = buildCreateFunctionGraphCommand(
      original,
      "  图像处理  ",
      identifiers(identifier(200), identifier(201), identifier(202)),
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const applied = applySuccess(original, built.value.command);
    const created = graphOf(applied.document, built.value.functionGraphId);
    expect(created).toMatchObject({
      name: "图像处理",
      kind: "function",
      functionSignature: { inputs: [], outputs: [] },
    });
    expect(created.nodes).toEqual([
      expect.objectContaining({
        nodeId: identifier(201),
        typeKey: "core.function.input",
        position: { x: 0, y: 0 },
        properties: {},
        inputValues: {},
      }),
      expect.objectContaining({
        nodeId: identifier(202),
        typeKey: "core.function.return",
        position: { x: 360, y: 0 },
        properties: {},
        inputValues: {},
      }),
    ]);
    expect(created.edges).toEqual([]);
    const undone = applySuccess(applied.document, applied.inverse);
    expect(undone.document).toEqual(original);
  });

  it("inserts a call node without persisting dynamic ports", () => {
    const document = baseDocument();
    const built = buildInsertFunctionCallCommand(
      document,
      ENTRY_ID,
      FUNCTION_ID,
      { x: 120, y: 80 },
      identifiers(identifier(220)),
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const applied = applySuccess(document, built.value.command);
    const call = graphOf(applied.document, ENTRY_ID).nodes[1];
    expect(call).toEqual({
      nodeId: identifier(220),
      typeKey: "core.function.call",
      typeVersion: 1,
      position: { x: 120, y: 80 },
      properties: { functionGraphId: FUNCTION_ID },
      inputValues: {},
    });
  });

  it("adds and renames a parameter while preserving both identifiers", () => {
    const document = baseDocument();
    const added = buildAddFunctionParameterCommand(
      document,
      FUNCTION_ID,
      "input",
      "  Ｓｃｏｒｅ  ",
      "number",
      identifiers(identifier(230), identifier(231)),
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.parameter).toEqual({
      parameterId: identifier(230),
      portId: portFromIdentifier(identifier(231)),
      name: "Score",
      valueKind: "number",
    });
    const afterAdd = applySuccess(document, added.value.command).document;
    const renamed = buildRenameFunctionParameterCommand(
      afterAdd,
      FUNCTION_ID,
      identifier(230),
      "  分数  ",
    );
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    const afterRename = applySuccess(afterAdd, renamed.value.command).document;
    expect(graphOf(afterRename, FUNCTION_ID).functionSignature?.inputs).toEqual(
      [
        {
          parameterId: identifier(230),
          portId: portFromIdentifier(identifier(231)),
          name: "分数",
          valueKind: "number",
        },
      ],
    );
  });

  it("derives schema-compatible port IDs and retries a port collision", () => {
    const existing = parameter(
      identifier(232),
      portFromIdentifier(identifier(231)),
      "已有",
    );
    const document = baseDocument([
      functionGraph(FUNCTION_ID, signature([existing])),
    ]);
    const added = buildAddFunctionParameterCommand(
      document,
      FUNCTION_ID,
      "output",
      "新增",
      "string",
      identifiers(identifier(233), identifier(231), identifier(234)),
    );

    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.parameter.portId).toBe(
      portFromIdentifier(identifier(234)),
    );
    expect(added.value.parameter.portId).toMatch(/^p[a-f0-9]{32}$/u);
    expect(applySuccess(document, added.value.command).document).toBeDefined();
  });

  it("removes input and output parameters across multiple calls and undoes exactly", () => {
    const input = parameter(identifier(240), "inputPort", "输入", "number");
    const output = parameter(identifier(241), "outputPort", "输出", "string");
    const callOne = node(identifier(242), "core.function.call", {
      properties: { functionGraphId: FUNCTION_ID },
      inputValues: { inputPort: 1, outputPort: "literal" },
    });
    const callTwo = node(identifier(243), "core.function.call", {
      properties: { functionGraphId: FUNCTION_ID },
      inputValues: { inputPort: 2, outputPort: "literal2" },
    });
    const consumerOne = node(identifier(244), "core.logic.branch");
    const consumerTwo = node(identifier(245), "core.logic.branch");
    const target = functionGraph(
      FUNCTION_ID,
      signature([input], [output]),
      [
        node(INPUT_NODE_ID, "core.function.input", {
          inputValues: { inputPort: 9 },
        }),
        node(RETURN_NODE_ID, "core.function.return", {
          inputValues: { outputPort: "returnLiteral" },
        }),
        node(identifier(246), "core.value.numberLiteral"),
      ],
      [
        edge(
          identifier(247),
          INPUT_NODE_ID,
          "inputPort",
          RETURN_NODE_ID,
          "outputPort",
        ),
        edge(
          identifier(248),
          identifier(246),
          "value",
          RETURN_NODE_ID,
          "outputPort",
        ),
      ],
    );
    const entry = graphOf(baseDocument([target]), ENTRY_ID);
    const original: RinoProjectDocumentV1 = {
      ...baseDocument([target]),
      graphs: [
        {
          ...entry,
          nodes: [
            node(START_NODE_ID, "core.flow.start"),
            callOne,
            callTwo,
            consumerOne,
            consumerTwo,
          ],
          edges: [
            edge(
              identifier(249),
              identifier(250),
              "value",
              callOne.nodeId,
              "inputPort",
            ),
            edge(
              identifier(251),
              identifier(250),
              "value",
              callTwo.nodeId,
              "inputPort",
            ),
            edge(
              identifier(252),
              callOne.nodeId,
              "outputPort",
              consumerOne.nodeId,
              "left",
            ),
            edge(
              identifier(253),
              callTwo.nodeId,
              "outputPort",
              consumerTwo.nodeId,
              "left",
            ),
          ],
        },
        target,
      ],
    };

    const removeInput = buildRemoveFunctionParameterCommand(
      original,
      FUNCTION_ID,
      "inputPort" === input.portId ? input.parameterId : input.parameterId,
    );
    expect(removeInput.ok).toBe(true);
    if (!removeInput.ok) return;
    const afterInput = applySuccess(original, removeInput.value.command);
    const afterInputEntry = graphOf(afterInput.document, ENTRY_ID);
    expect(
      afterInputEntry.edges.some(
        (candidate) => candidate.targetPortId === "inputPort",
      ),
    ).toBe(false);
    expect(
      afterInputEntry.nodes.find(
        (candidate) => candidate.nodeId === callOne.nodeId,
      )?.inputValues,
    ).toEqual({ outputPort: "literal" });
    expect(
      graphOf(afterInput.document, FUNCTION_ID).edges.some(
        (candidate) => candidate.sourcePortId === "inputPort",
      ),
    ).toBe(false);
    expect(
      applySuccess(afterInput.document, afterInput.inverse).document,
    ).toEqual(original);

    const removeOutput = buildRemoveFunctionParameterCommand(
      original,
      FUNCTION_ID,
      "output",
      output.parameterId,
    );
    expect(removeOutput.ok).toBe(true);
    if (!removeOutput.ok) return;
    const afterOutput = applySuccess(original, removeOutput.value.command);
    expect(
      graphOf(afterOutput.document, ENTRY_ID).edges.some(
        (candidate) => candidate.sourcePortId === "outputPort",
      ),
    ).toBe(false);
    expect(
      graphOf(afterOutput.document, FUNCTION_ID).edges.some(
        (candidate) => candidate.targetPortId === "outputPort",
      ),
    ).toBe(false);
  });

  it("changes kind as one undo step and removes stale edges and literals", () => {
    const input = parameter(identifier(260), "inputPort", "输入", "number");
    const target = functionGraph(
      FUNCTION_ID,
      signature([input]),
      [node(INPUT_NODE_ID, "core.function.input")],
      [],
    );
    const call = node(identifier(261), "core.function.call", {
      properties: { functionGraphId: FUNCTION_ID },
      inputValues: { inputPort: 42 },
    });
    const literal = node(identifier(262), "core.value.numberLiteral");
    const originalBase = baseDocument([target]);
    const originalEntry = graphOf(originalBase, ENTRY_ID);
    const original: RinoProjectDocumentV1 = {
      ...originalBase,
      graphs: [
        {
          ...originalEntry,
          nodes: [node(START_NODE_ID, "core.flow.start"), call, literal],
          edges: [
            edge(
              identifier(263),
              literal.nodeId,
              "value",
              call.nodeId,
              "inputPort",
            ),
          ],
        },
        target,
      ],
    };

    const changed = buildChangeFunctionParameterKindCommand(
      original,
      FUNCTION_ID,
      input.parameterId,
      "string",
    );
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.command.kind).toBe("composite");
    const applied = applySuccess(original, changed.value.command);
    expect(graphOf(applied.document, ENTRY_ID).edges).toEqual([]);
    expect(graphOf(applied.document, ENTRY_ID).nodes[1]?.inputValues).toEqual(
      {},
    );
    expect(applySuccess(applied.document, applied.inverse).document).toEqual(
      original,
    );
  });

  it("rejects invalid signatures atomically at the low-level command", () => {
    const original = baseDocument();
    const invalid = (signatureValue: FunctionSignatureV1) =>
      applyCommand(original, {
        kind: "setFunctionSignature",
        graphId: FUNCTION_ID,
        signature: signatureValue,
      });
    expect(
      invalid(signature([parameter(identifier(270), "run", "a")])),
    ).toEqual({
      ok: false,
      reason: "functionParameterPortIdReserved",
    });
    expect(
      invalid(signature([parameter(identifier(268), identifier(269), "a")])),
    ).toEqual({
      ok: false,
      reason: "functionParameterPortIdInvalid",
    });
    expect(
      invalid(
        signature([
          parameter(identifier(271), "a", " Foo "),
          parameter(identifier(272), "b", "ＦＯＯ"),
        ]),
      ),
    ).toEqual({ ok: false, reason: "functionParameterNameDuplicate" });
    expect(invalid(signature([parameter("bad", "a", "a")]))).toEqual({
      ok: false,
      reason: "functionParameterIdInvalid",
    });
    expect(graphOf(original, FUNCTION_ID).functionSignature).toEqual(
      signature(),
    );
  });

  it("rejects indirect recursion and a static depth above sixteen", () => {
    const first = functionGraph(identifier(300));
    const second = functionGraph(identifier(301));
    const firstCall = node(identifier(302), "core.function.call", {
      properties: { functionGraphId: second.graphId },
    });
    const secondWithCall = {
      ...second,
      nodes: [
        ...second.nodes,
        node(identifier(303), "core.function.call", {
          properties: { functionGraphId: first.graphId },
        }),
      ],
    };
    const recursiveDocument = baseDocument([first, secondWithCall]);
    recursiveDocument.graphs[1] = {
      ...first,
      nodes: [...first.nodes, firstCall],
    };
    const recursion = buildInsertFunctionCallCommand(
      recursiveDocument,
      second.graphId,
      first.graphId,
      { x: 0, y: 0 },
      identifiers(identifier(304)),
    );
    expect(recursion).toEqual({ ok: false, reason: "recursion" });

    const chain = Array.from({ length: 17 }, (_, index) =>
      functionGraph(identifier(400 + index)),
    );
    const entry = graphOf(baseDocument(chain), ENTRY_ID);
    const chainDocument: RinoProjectDocumentV1 = {
      ...baseDocument(chain),
      graphs: [
        {
          ...entry,
          nodes: [
            node(START_NODE_ID, "core.flow.start"),
            node(identifier(500), "core.function.call", {
              properties: { functionGraphId: chain[0]?.graphId ?? "missing" },
            }),
          ],
        },
        ...chain.map((graph, index) => ({
          ...graph,
          nodes:
            index < 16
              ? [
                  ...graph.nodes,
                  node(identifier(600 + index), "core.function.call", {
                    properties: {
                      functionGraphId: chain[index + 1]?.graphId ?? "missing",
                    },
                  }),
                ]
              : graph.nodes,
        })),
      ],
    };
    const depth = buildInsertFunctionCallCommand(
      chainDocument,
      chain[15]?.graphId ?? "missing",
      chain[16]?.graphId ?? "missing",
      { x: 0, y: 0 },
      identifiers(identifier(700)),
    );
    expect(depth).toEqual({ ok: false, reason: "depthLimit" });
  });
});
