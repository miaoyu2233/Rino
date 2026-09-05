import type {
  EdgeV1,
  GraphV1,
  NodeV1,
  NodeDefinitionV1,
  PortDefinitionV1,
  FunctionSignatureV1,
  RinoProjectDocumentV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";
import { describe, expect, it } from "vitest";

import coreDefinitions from "../../../../../contracts/fixtures/registry/valid/core-definitions.json";
import {
  EMPTY_EDGE_ACTIVITY,
  GraphProjection,
  mergeEdgeRenderState,
  mergeNodeRenderState,
  repeatHintNodeId,
  RINO_NODE_TYPE,
  type EdgeActivityMap,
  type RinoFlowNode,
} from "./graph-view-model";

const registry = coreDefinitions as unknown as RinoNodeRegistrySnapshotV1;

const START = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const COMPARE = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";
const LITERAL = "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80";
const EDGE = "8c7ebda1-c5d6-41e2-9d05-7f8091021324";
const CAPTURE = "capture-node";
const OCR = "ocr-node";
const OVERLAY = "overlay-node";
const NUMBER_ID = "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80";
const FUNCTION_GRAPH_ID = "function-graph";
const FUNCTION_CALL_ID = "function-call";
const FUNCTION_INPUT_ID = "function-input";
const FUNCTION_RETURN_ID = "function-return";

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

function graph(nodes: NodeV1[], edges: EdgeV1[] = []): GraphV1 {
  return {
    graphId: "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e",
    name: "主图",
    kind: "entry",
    nodes,
    edges,
  };
}

function baseGraph(): GraphV1 {
  return graph(
    [
      node(START, "core.flow.start"),
      node(LITERAL, "core.value.numberLiteral", { position: { x: 40, y: 80 } }),
      node(COMPARE, "core.logic.numberCompare", {
        position: { x: 320, y: 60 },
        inputValues: { right: 100 },
      }),
    ],
    [
      {
        edgeId: EDGE,
        edgeKind: "data",
        sourceNodeId: LITERAL,
        sourcePortId: "value",
        targetNodeId: COMPARE,
        targetPortId: "left",
      },
    ],
  );
}

function functionSignature(
  outputKind: "number" | "string" = "number",
): FunctionSignatureV1 {
  return {
    inputs: [
      {
        parameterId: "input-parameter",
        portId: "input-value",
        name: "Input value",
        valueKind: "number",
      },
    ],
    outputs: [
      {
        parameterId: "output-parameter",
        portId: "output-value",
        name: "Output value",
        valueKind: outputKind,
      },
    ],
  };
}

function functionDocument(
  outputKind: "number" | "string" = "number",
): RinoProjectDocumentV1 {
  const functionGraph: GraphV1 = {
    graphId: FUNCTION_GRAPH_ID,
    name: "Calculate score",
    kind: "function",
    functionSignature: functionSignature(outputKind),
    nodes: [
      node(FUNCTION_INPUT_ID, "core.function.input"),
      node(FUNCTION_RETURN_ID, "core.function.return"),
    ],
    edges: [],
  };
  const entryGraph: GraphV1 = graph([
    node(FUNCTION_CALL_ID, "core.function.call", {
      properties: { functionGraphId: FUNCTION_GRAPH_ID },
    }),
  ]);
  return {
    schemaVersion: 1,
    documentId: "document-id",
    metadata: {
      name: "Project",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    entryGraphId: entryGraph.graphId,
    graphs: [entryGraph, functionGraph],
    assets: [],
    requiredCapabilities: [],
  };
}

function clickPointRegistry(): RinoNodeRegistrySnapshotV1 {
  const clickPoint = registry.definitions.find(
    (definition) => definition.typeKey === "automation.clickPoint",
  );
  const pointPort = clickPoint?.ports.find((port) => port.portId === "point");
  const numberPort = clickPoint?.ports.find((port) => port.portId === "x");
  if (
    clickPoint === undefined ||
    pointPort === undefined ||
    numberPort === undefined
  ) {
    throw new Error("The registry fixture must define click point ports.");
  }

  const collectionPointPort = (
    portId: string,
    labelKey: string,
  ): PortDefinitionV1 => ({
    ...pointPort,
    portId,
    labelKey,
    type: { kind: "collection", element: { kind: "point" } },
  });
  const pointListDefinition: NodeDefinitionV1 = {
    typeKey: "core.collection.pointList",
    typeVersion: 1,
    runtimeKind: "pure",
    sideEffect: "none",
    category: "values",
    titleKey: "node.core.collection.pointList.title",
    descriptionKey: "node.core.collection.pointList.description",
    iconKey: "node.coordinate",
    ports: [
      ...Array.from({ length: 16 }, (_, index) => ({
        ...pointPort,
        portId: `item${(index + 1).toString()}`,
        labelKey: `node.core.collection.pointList.port.item${(index + 1).toString()}`,
      })),
      {
        ...collectionPointPort(
          "points",
          "node.core.collection.pointList.port.points",
        ),
        direction: "output",
      },
    ],
  };
  const clickPointDefinition: NodeDefinitionV1 = {
    ...clickPoint,
    ports: [
      ...clickPoint.ports,
      collectionPointPort("points", "node.automation.clickPoint.port.points"),
      {
        ...pointPort,
        portId: "rect",
        labelKey: "node.automation.clickPoint.port.rect",
        type: { kind: "rect" },
      },
      {
        ...numberPort,
        portId: "clickedCount",
        direction: "output",
        labelKey: "node.automation.clickPoint.port.clickedCount",
      },
      {
        ...numberPort,
        portId: "selectedIndex",
        direction: "output",
        labelKey: "node.automation.clickPoint.port.selectedIndex",
      },
    ],
  };
  return {
    ...registry,
    definitions: [
      ...registry.definitions.filter(
        (definition) => definition.typeKey !== "automation.clickPoint",
      ),
      clickPointDefinition,
      pointListDefinition,
    ],
  };
}

function variableRegistry(): RinoNodeRegistrySnapshotV1 {
  const source = registry.definitions.find(
    (definition) => definition.typeKey === "core.value.numberLiteral",
  );
  if (source === undefined) {
    throw new Error("The registry fixture must define a number literal.");
  }
  const variableDefinition: NodeDefinitionV1 = {
    ...source,
    typeKey: "core.variable.getNumber",
    titleKey: "node.core.variable.getNumber.title",
    propertySchema: {
      type: "object",
      additionalProperties: false,
      required: ["variableId"],
      properties: {
        variableId: {
          type: "string",
          format: "uuid",
          "x-rinoLabelKey":
            "node.core.variable.getNumber.property.variableId.label",
          "x-rinoDescriptionKey":
            "node.core.variable.getNumber.property.variableId.description",
        },
      },
    },
    propertyDefaults: {},
  };
  return {
    ...registry,
    definitions: [...registry.definitions, variableDefinition],
  };
}

function readValueRegistry(): RinoNodeRegistrySnapshotV1 {
  const source = registry.definitions.find(
    (definition) => definition.typeKey === "text.readNumber",
  );
  if (source === undefined) {
    throw new Error(
      "The registry fixture must define the legacy read number node.",
    );
  }
  const run = source.ports.find((port) => port.portId === "run");
  const result = source.ports.find((port) => port.portId === "result");
  const number = source.ports.find((port) => port.portId === "number");
  const rect = source.ports.find((port) => port.portId === "rect");
  const selected = source.ports.find((port) => port.portId === "selected");
  const missing = source.ports.find((port) => port.portId === "missing");
  const invalid = source.ports.find((port) => port.portId === "invalid");
  if (
    run === undefined ||
    result === undefined ||
    number === undefined ||
    rect === undefined ||
    selected === undefined ||
    missing === undefined ||
    invalid === undefined
  ) {
    throw new Error("The registry fixture must define read value ports.");
  }
  const outputPort = (
    portId: string,
    sourcePort: PortDefinitionV1,
  ): PortDefinitionV1 => ({
    ...sourcePort,
    portId,
    labelKey: `node.text.readValue.port.${portId}`,
  });
  const readValue: NodeDefinitionV1 = {
    ...source,
    typeKey: "text.readValue",
    titleKey: "node.text.readValue.title",
    descriptionKey: "node.text.readValue.description",
    ports: [
      { ...run, labelKey: "node.text.readValue.port.run" },
      { ...result, labelKey: "node.text.readValue.port.result" },
      outputPort("text", { ...number, type: { kind: "string" } }),
      outputPort("texts", {
        ...rect,
        type: { kind: "collection", element: { kind: "string" } },
      }),
      outputPort("number", number),
      outputPort("numbers", {
        ...number,
        type: { kind: "collection", element: { kind: "number" } },
      }),
      outputPort("rect", rect),
      outputPort("rects", {
        ...rect,
        type: { kind: "collection", element: { kind: "rect" } },
      }),
      outputPort("selected", selected),
      outputPort("missing", missing),
      outputPort("invalid", invalid),
    ],
  };
  return {
    ...registry,
    definitions: [
      ...registry.definitions.filter(
        (definition) => definition.typeKey !== "text.readValue",
      ),
      readValue,
    ],
  };
}

function groupedRecognitionGraph(collapsed: boolean): GraphV1 {
  return {
    ...graph(
      [
        node(CAPTURE, "automation.captureScreen", {
          position: { x: 160, y: 120 },
        }),
        node(OCR, "vision.ocr", { position: { x: 440, y: 120 } }),
      ],
      [
        {
          edgeId: "capture-next",
          edgeKind: "execution",
          sourceNodeId: CAPTURE,
          sourcePortId: "next",
          targetNodeId: OCR,
          targetPortId: "run",
        },
        {
          edgeId: "capture-image",
          edgeKind: "data",
          sourceNodeId: CAPTURE,
          sourcePortId: "image",
          targetNodeId: OCR,
          targetPortId: "image",
        },
      ],
    ),
    editorMetadata: {
      workflowGroups: [
        {
          groupId: "recognition-group",
          kind: "textRecognition",
          collapsed,
          members: [
            { role: "capture", nodeId: CAPTURE },
            { role: "recognizer", nodeId: OCR },
          ],
          exposedPorts: [
            {
              proxyPortId: "run",
              nodeId: CAPTURE,
              portId: "run",
              labelKey: "workflowGroup.textRecognition.port.run",
            },
            {
              proxyPortId: "region",
              nodeId: OCR,
              portId: "roi",
              labelKey: "workflowGroup.textRecognition.port.roi",
            },
            {
              proxyPortId: "matched",
              nodeId: OCR,
              portId: "matched",
              labelKey: "workflowGroup.textRecognition.port.matched",
            },
            {
              proxyPortId: "next",
              nodeId: OCR,
              portId: "next",
              labelKey: "workflowGroup.textRecognition.port.next",
            },
          ],
        },
      ],
    },
  };
}

describe("node projection", () => {
  it("projects valid repeat hints as editor-only cards and skips dangling hints", () => {
    const source = graph(
      [node(START, "core.flow.start"), node("branch", "core.logic.branch")],
      [
        {
          edgeId: "valid-repeat-edge",
          edgeKind: "execution",
          sourceNodeId: START,
          sourcePortId: "next",
          targetNodeId: "branch",
          targetPortId: "run",
        },
        {
          edgeId: "data-edge",
          edgeKind: "data",
          sourceNodeId: "branch",
          sourcePortId: "condition",
          targetNodeId: "branch",
          targetPortId: "condition",
        },
      ],
    );
    source.editorMetadata = {
      repeatHints: [
        {
          hintId: "10000000-0000-4000-8000-000000000001",
          edgeId: "valid-repeat-edge",
          position: { x: 120, y: 180 },
        },
        {
          hintId: "10000000-0000-4000-8000-000000000002",
          edgeId: "missing-edge",
          position: { x: 160, y: 180 },
        },
        {
          hintId: "10000000-0000-4000-8000-000000000003",
          edgeId: "data-edge",
          position: { x: 200, y: 180 },
        },
      ],
    };

    const projection = new GraphProjection();
    const nodes = projection.projectNodes(source, registry);
    const edges = projection.projectEdges(
      source,
      registry,
      EMPTY_EDGE_ACTIVITY,
    );
    const hint = nodes.find((item) =>
      item.id.startsWith("editor-repeat-hint:"),
    );

    expect(hint?.id).toBe(
      repeatHintNodeId("10000000-0000-4000-8000-000000000001"),
    );
    expect(hint?.position).toEqual({ x: 120, y: 180 });
    expect(hint?.data.inputs).toEqual([]);
    expect(hint?.data.outputs).toEqual([]);
    expect(
      nodes.filter((item) => item.id.startsWith("editor-repeat-hint:")),
    ).toHaveLength(1);
    expect(edges.find((edge) => edge.id === "valid-repeat-edge")).toMatchObject(
      {
        target: repeatHintNodeId("10000000-0000-4000-8000-000000000001"),
        targetHandle: "repeat",
        reconnectable: false,
      },
    );
  });

  it("keeps ordinary node view references stable when only repeat metadata changes", () => {
    const projection = new GraphProjection();
    const source = baseGraph();
    const before = projection.projectNodes(source, registry);
    const withHint: GraphV1 = {
      ...source,
      editorMetadata: {
        repeatHints: [
          {
            hintId: "10000000-0000-4000-8000-000000000004",
            edgeId: "missing-edge",
            position: { x: 0, y: 0 },
          },
        ],
      },
    };
    const after = projection.projectNodes(withHint, registry);

    expect(after.find((node) => node.id === START)).toBe(
      before.find((node) => node.id === START),
    );
  });

  it("derives ports, literals, and connection state from the registry", () => {
    const projection = new GraphProjection();
    const nodes = projection.projectNodes(baseGraph(), registry);
    const compare = nodes.find((item) => item.id === COMPARE);

    expect(compare?.type).toBe(RINO_NODE_TYPE);
    expect(compare?.data.inputs.map((port) => port.portId)).toEqual([
      "left",
      "right",
    ]);
    expect(compare?.data.outputs.map((port) => port.portId)).toEqual([
      "result",
      "relation",
    ]);

    const left = compare?.data.inputs.find((port) => port.portId === "left");
    const right = compare?.data.inputs.find((port) => port.portId === "right");
    expect(left?.connected).toBe(true);
    expect(right?.connected).toBe(false);
    expect(right?.literalValue).toBe(100);
    expect(right?.required).toBe(true);
    expect(compare?.data.outputs[0]?.colorRole).toBe("boolean");
  });

  it("shows only the active ordered ports of a new sequence node", () => {
    const projection = new GraphProjection();
    const sequence = node("sequence", "core.flow.sequence", {
      dynamicPortState: { sequenceStepCount: 3 },
    });
    const projected = projection.projectNodes(graph([sequence]), registry)[0];

    expect(projected?.data.outputs.map((port) => port.portId)).toEqual([
      "step1",
      "step2",
      "step3",
    ]);
    expect(projected?.data.sequenceControl).toEqual({
      stepCount: 3,
      canAdd: true,
      order: ["step1", "step2", "step3"],
      kind: "sequence",
    });
  });

  it("renders authored sequence order while keeping stable handle ids", () => {
    const projection = new GraphProjection();
    const sequence = node("sequence", "core.flow.sequence", {
      dynamicPortState: {
        sequenceStepCount: 3,
        sequenceOrder: ["step3", "step1", "step2"],
      },
    });
    const projected = projection.projectNodes(graph([sequence]), registry)[0];

    expect(projected?.data.outputs.map((port) => port.portId)).toEqual([
      "step3",
      "step1",
      "step2",
    ]);
    expect(projected?.data.outputs.map((port) => port.domainPortId)).toEqual([
      "step3",
      "step1",
      "step2",
    ]);
  });

  it("projects the execution-order node without execution ports", () => {
    const projection = new GraphProjection();
    const orderNode = node("order", "core.flow.sequenceOrder", {
      dynamicPortState: {
        sequenceStepCount: 3,
        sequenceOrder: ["step2", "step3", "step1"],
      },
    });
    const projected = projection.projectNodes(graph([orderNode]), registry)[0];

    expect(projected?.data.inputs).toEqual([]);
    expect(projected?.data.outputs.map((port) => port.portId)).toEqual([
      "order",
    ]);
    expect(projected?.data.sequenceControl).toEqual({
      stepCount: 3,
      canAdd: true,
      order: ["step2", "step3", "step1"],
      kind: "sequenceOrder",
    });
  });

  it.each([
    ["point", ["run", "point"]],
    [
      "coordinates",
      ["run", "image", "x", "y", "referenceWidth", "referenceHeight"],
    ],
    ["randomPoints", ["run", "points"]],
    ["sequentialPoints", ["run", "points"]],
    ["rectCenter", ["run", "rect"]],
    ["rectRandom", ["run", "rect"]],
  ] as const)("shows click point ports for %s mode", (mode, expected) => {
    const projection = new GraphProjection();
    const click = node("click", "automation.clickPoint", {
      properties: { inputMode: mode },
    });
    const projected = projection.projectNodes(
      graph([click]),
      clickPointRegistry(),
    )[0];

    expect(projected?.data.inputs.map((port) => port.portId)).toEqual(expected);
    expect(projected?.data.outputs.map((port) => port.portId)).toEqual(
      expect.arrayContaining([
        "clicked",
        "clickedCount",
        "selectedIndex",
        "next",
        "failed",
      ]),
    );
  });

  it.each([
    [
      "text",
      "position",
      ["run", "result"],
      ["text", "rect", "selected", "missing", "invalid"],
    ],
    [
      "text",
      "all",
      ["run", "result"],
      ["texts", "rects", "selected", "missing", "invalid"],
    ],
    [
      "number",
      "position",
      ["run", "result"],
      ["number", "rect", "selected", "missing", "invalid"],
    ],
    [
      "number",
      "all",
      ["run", "result"],
      ["numbers", "rects", "selected", "missing", "invalid"],
    ],
  ] as const)(
    "shows read value ports for %s and %s",
    (valueMode, selectionMode, expectedInputs, expectedOutputs) => {
      const projection = new GraphProjection();
      const readValue = node("read-value", "text.readValue", {
        properties: { valueMode, selectionMode },
      });
      const projected = projection.projectNodes(
        graph([readValue]),
        readValueRegistry(),
      )[0];

      expect(projected?.data.inputs.map((port) => port.portId)).toEqual(
        expectedInputs,
      );
      expect(projected?.data.outputs.map((port) => port.portId)).toEqual(
        expectedOutputs,
      );
    },
  );

  it("does not rewrite read value properties while switching visible modes", () => {
    const properties = {
      valueMode: "text",
      selectionMode: "all",
      numberType: "percentage",
      lineIndex: 4,
      itemIndex: 5,
    };
    const readValue = node("read-value", "text.readValue", { properties });

    new GraphProjection().projectNodes(graph([readValue]), readValueRegistry());

    expect(readValue.properties).toEqual(properties);
  });

  it("exposes the bounded add control for point lists", () => {
    const projection = new GraphProjection();
    const pointList = node("point-list", "core.collection.pointList", {
      dynamicPortState: { collectionItemCount: 2 },
    });
    const projected = projection.projectNodes(
      graph([pointList]),
      clickPointRegistry(),
    )[0];

    expect(projected?.data.inputs.map((port) => port.portId)).toEqual([
      "item1",
      "item2",
    ]);
    expect(projected?.data.outputs.map((port) => port.portId)).toEqual([
      "points",
    ]);
    expect(projected?.data.dynamicPortControl).toEqual({
      kind: "collectionItem",
      count: 2,
      canAdd: true,
    });
  });

  it("projects only catalogued overlay cases and uses their labels", () => {
    const projection = new GraphProjection();
    const overlay = node(OVERLAY, "core.logic.caseOverlayNumber", {
      dynamicPortState: {
        taskChoiceCases: [
          { caseId: "primary", portId: "case1", label: "Primary" },
          { caseId: "backup", portId: "case3", label: "Backup" },
        ],
      },
    });

    const projected = projection.projectNodes(graph([overlay]), registry)[0];

    expect(projected?.data.inputs.map((port) => port.portId)).toEqual([
      "selectedCaseId",
      "fallback",
      "case1",
      "case3",
    ]);
    expect(
      projected?.data.inputs.find((port) => port.portId === "case3")
        ?.labelOverride,
    ).toBe("Backup");
    expect(projected?.data.outputs.map((port) => port.portId)).toEqual([
      "value",
    ]);
  });

  it("keeps malformed overlay case ports inspectable", () => {
    const projection = new GraphProjection();
    const overlay = node(OVERLAY, "core.logic.caseOverlayNumber", {
      dynamicPortState: { taskChoiceCases: [] },
    });

    const projected = projection.projectNodes(graph([overlay]), registry)[0];
    const inputIds = projected?.data.inputs.map((port) => port.portId) ?? [];

    expect(inputIds).toContain("case1");
    expect(inputIds).toContain("case16");
  });

  it("shows the real legacy sequence count before migration", () => {
    const projection = new GraphProjection();
    const sequence = node("sequence", "core.flow.sequence");
    const source = graph([sequence]);
    source.edges = Array.from({ length: 16 }, (_, index) => ({
      edgeId: `legacy-edge-${index.toString()}`,
      edgeKind: "execution" as const,
      sourceNodeId: sequence.nodeId,
      sourcePortId: "steps",
      targetNodeId: `target-${index.toString()}`,
      targetPortId: "run",
    }));

    const projected = projection.projectNodes(source, registry)[0];

    expect(projected?.data.outputs.map((port) => port.portId)).toEqual([
      "steps",
    ]);
    expect(projected?.data.sequenceControl).toEqual({
      stepCount: 16,
      canAdd: false,
      order: Array.from(
        { length: 16 },
        (_, index) => `step${String(index + 1)}`,
      ),
      kind: "sequence",
      legacy: true,
    });
  });

  it("rebuilds a legacy sequence when its first fan-out edge appears", () => {
    const projection = new GraphProjection();
    const sequence = node("sequence", "core.flow.sequence");
    const before = graph([sequence]);
    const first = projection.projectNodes(before, registry)[0];
    const after: GraphV1 = {
      ...before,
      edges: [
        {
          edgeId: "legacy-edge",
          edgeKind: "execution",
          sourceNodeId: sequence.nodeId,
          sourcePortId: "steps",
          targetNodeId: "target",
          targetPortId: "run",
        },
      ],
    };
    const second = projection.projectNodes(after, registry)[0];

    expect(second).not.toBe(first);
    expect(second?.data.sequenceControl?.legacy).toBe(true);
    expect(second?.data.sequenceControl?.order).toEqual(["step1"]);
  });

  it("keeps a node whose type the registry does not define", () => {
    const projection = new GraphProjection();
    const nodes = projection.projectNodes(
      graph([node(START, "vendor.unknownNode")]),
      registry,
    );

    expect(nodes[0]?.data.unresolved).toBe(true);
    expect(nodes[0]?.data.inputs).toEqual([]);
    expect(nodes[0]?.data.titleKey).toBe("vendor.unknownNode");
  });

  it("projects a collapsed workflow as one proxy node with ordered ordinary steps", () => {
    const projection = new GraphProjection();
    const source = groupedRecognitionGraph(true);
    const aliasTarget = source.nodes.find((node) => node.nodeId === CAPTURE);
    if (aliasTarget === undefined) {
      throw new Error(
        "The grouped recognition fixture must contain its capture node.",
      );
    }
    aliasTarget.displayAlias = "登录区域";
    const nodes = projection.projectNodes(source, registry);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("workflow-group:recognition-group");
    expect(nodes[0]?.data.displayAlias).toBe("登录区域");
    expect(nodes[0]?.position).toEqual({ x: 160, y: 120 });
    expect(nodes[0]?.data.inputs.map((item) => item.portId)).toEqual([
      "run",
      "region",
    ]);
    expect(nodes[0]?.data.outputs.map((item) => item.portId)).toEqual([
      "matched",
      "next",
    ]);
    expect(
      nodes[0]?.data.workflowGroup?.steps.map((step) => step.role),
    ).toEqual(["capture", "recognizer"]);
    expect(
      projection.projectEdges(source, registry, EMPTY_EDGE_ACTIVITY),
    ).toEqual([]);
  });

  it("keeps the image recognition title stable when click is enabled", () => {
    const source = groupedRecognitionGraph(true);
    const clickNode = node("click-node", "core.flow.sequence");
    source.nodes.push(clickNode);
    const group = source.editorMetadata?.workflowGroups?.[0];
    if (group === undefined) throw new Error("Expected workflow group.");
    group.kind = "imageRecognition";
    group.members.push({ role: "click", nodeId: clickNode.nodeId });

    const projected = new GraphProjection().projectNodes(source, registry)[0];

    expect(projected?.data.titleKey).toBe(
      "workflowGroup.imageRecognition.title",
    );
  });

  it("detects the image template rectangle connection as an enabled region", () => {
    const template = registry.workflowTemplates?.find(
      (candidate) => candidate.templateKey === "template.imageRecognition",
    );
    if (template?.workflowGroup === undefined) {
      throw new Error(
        "The registry fixture must define the image template group.",
      );
    }
    const nodes = template.nodes.map((templateNode) =>
      node(templateNode.placeholderId, templateNode.typeKey, {
        position: templateNode.offset,
        inputValues: templateNode.inputValues ?? {},
      }),
    );
    const edges = (template.edges ?? []).map((templateEdge, index) => ({
      edgeId: `image-template-edge-${index.toString()}`,
      edgeKind: templateEdge.edgeKind,
      sourceNodeId: templateEdge.sourcePlaceholderId,
      sourcePortId: templateEdge.sourcePortId,
      targetNodeId: templateEdge.targetPlaceholderId,
      targetPortId: templateEdge.targetPortId,
    }));
    const members = template.workflowGroup.members.map((member) => ({
      role: member.role,
      nodeId: member.placeholderId,
    }));
    const firstMember = members[0];
    if (firstMember === undefined) {
      throw new Error("The image template group must have members.");
    }
    const source: GraphV1 = {
      ...graph(nodes, edges),
      editorMetadata: {
        workflowGroups: [
          {
            groupId: "image-template-group",
            kind: template.workflowGroup.kind,
            collapsed: true,
            members: [firstMember, ...members.slice(1)],
            exposedPorts: template.workflowGroup.exposedPorts.map((port) => ({
              proxyPortId: port.proxyPortId,
              nodeId: port.placeholderId,
              portId: port.portId,
              labelKey: port.labelKey,
            })),
          },
        ],
      },
    };

    const projected = new GraphProjection().projectNodes(source, registry)[0];

    expect(
      projected?.data.workflowGroup?.imageRecognitionParameters?.regionEnabled,
    ).toBe(true);
    expect(
      projected?.data.workflowGroup?.imageRecognitionParameters?.matchThreshold,
    ).toBe(0.7);
  });

  it("projects text recognition settings inside the collapsed workflow node", () => {
    const source: GraphV1 = {
      ...graph(
        [
          node("before", "core.time.delay", {
            inputValues: { durationMilliseconds: 250 },
          }),
          node(CAPTURE, "automation.captureScreen"),
          node(OCR, "vision.ocr", {
            properties: { confidenceThreshold: 0.75 },
          }),
          node("roi", "core.geometry.rectangle", {
            inputValues: {
              x: 10,
              y: 20,
              width: 300,
              height: 180,
              referenceWidth: 1080,
              referenceHeight: 1920,
            },
          }),
          node("branch", "core.logic.branch"),
          node("click", "automation.clickRectCenter"),
          node("point", "core.geometry.point", {
            inputValues: {
              x: 500,
              y: 600,
              referenceWidth: 1080,
              referenceHeight: 1920,
            },
          }),
          node("after", "core.time.delay", {
            inputValues: { durationMilliseconds: 500 },
          }),
        ],
        [
          {
            edgeId: "roi-edge",
            edgeKind: "data",
            sourceNodeId: "roi",
            sourcePortId: "rectangle",
            targetNodeId: OCR,
            targetPortId: "roi",
          },
        ],
      ),
      editorMetadata: {
        workflowGroups: [
          {
            groupId: "text-parameters",
            kind: "textRecognition",
            collapsed: true,
            members: [
              { role: "beforeDelay", nodeId: "before" },
              { role: "capture", nodeId: CAPTURE },
              { role: "recognizer", nodeId: OCR },
              { role: "roi", nodeId: "roi" },
              { role: "matchBranch", nodeId: "branch" },
              { role: "click", nodeId: "click" },
              { role: "clickPoint", nodeId: "point" },
              { role: "afterDelay", nodeId: "after" },
            ],
            exposedPorts: [
              {
                proxyPortId: "run",
                nodeId: CAPTURE,
                portId: "run",
                labelKey: "workflowGroup.textRecognition.port.run",
              },
              {
                proxyPortId: "matched",
                nodeId: OCR,
                portId: "matched",
                labelKey: "workflowGroup.textRecognition.port.matched",
              },
            ],
          },
        ],
      },
    };

    const proxy = new GraphProjection().projectNodes(source, registry)[0];
    expect(proxy?.data.inputs.map((port) => port.portId)).toEqual(["run"]);
    expect(proxy?.data.outputs.map((port) => port.portId)).toEqual(["matched"]);
    expect(proxy?.data.workflowGroup?.steps.map((step) => step.role)).toEqual([
      "beforeDelay",
      "capture",
      "recognizer",
      "matchBranch",
      "click",
      "afterDelay",
    ]);
    expect(proxy?.data.workflowGroup?.textRecognitionParameters).toEqual({
      delayMilliseconds: 250,
      delayMode: "beforeRecognition",
      canDelayClick: true,
      confidenceThreshold: 0.75,
      region: {
        nodeId: "roi",
        enabled: true,
        x: 10,
        y: 20,
        width: 300,
        height: 180,
        referenceWidth: 1080,
        referenceHeight: 1920,
      },
      clickPoint: {
        nodeId: "point",
        x: 500,
        y: 600,
        referenceWidth: 1080,
        referenceHeight: 1920,
      },
    });
  });

  it("does not expose click-only timing when the click member is disabled", () => {
    const source: GraphV1 = {
      ...graph([
        node("delay", "core.time.delay", {
          inputValues: { durationMilliseconds: 250 },
        }),
        node(CAPTURE, "automation.captureScreen"),
        node(OCR, "vision.ocr"),
        node("branch", "core.logic.branch"),
        node("click", "core.flow.sequence"),
      ]),
      editorMetadata: {
        workflowGroups: [
          {
            groupId: "disabled-click",
            kind: "textRecognition",
            collapsed: true,
            members: [
              { role: "delay", nodeId: "delay" },
              { role: "capture", nodeId: CAPTURE },
              { role: "recognizer", nodeId: OCR },
              { role: "matchBranch", nodeId: "branch" },
              { role: "click", nodeId: "click" },
            ],
            exposedPorts: [
              {
                proxyPortId: "run",
                nodeId: CAPTURE,
                portId: "run",
                labelKey: "workflowGroup.textRecognition.port.run",
              },
            ],
          },
        ],
      },
    };

    const proxy = new GraphProjection()
      .projectNodes(source, registry)
      .find((item) => item.id === "workflow-group:disabled-click");
    expect(proxy?.data.workflowGroup?.textRecognitionParameters).toMatchObject({
      delayMode: "beforeClick",
      canDelayClick: false,
    });
  });

  it("restores ordinary nodes and internal edges when the workflow is expanded", () => {
    const projection = new GraphProjection();
    const source = groupedRecognitionGraph(false);

    expect(
      projection.projectNodes(source, registry).map((item) => item.id),
    ).toEqual([CAPTURE, OCR]);
    expect(
      projection.projectNodes(source, registry)[0]?.data.workflowGroupControl,
    ).toEqual({ groupId: "recognition-group", expanded: true });
    expect(
      projection.projectEdges(source, registry, EMPTY_EDGE_ACTIVITY),
    ).toHaveLength(2);
  });

  it("keeps a user-created boundary connection visible after collapsing", () => {
    const projection = new GraphProjection();
    const grouped = groupedRecognitionGraph(true);
    const source: GraphV1 = {
      ...grouped,
      nodes: [...grouped.nodes, node(COMPARE, "core.logic.numberCompare")],
      edges: [
        ...grouped.edges,
        {
          edgeId: "custom-boundary",
          edgeKind: "data",
          sourceNodeId: OCR,
          sourcePortId: "result",
          targetNodeId: COMPARE,
          targetPortId: "left",
        },
      ],
    };

    const proxy = projection
      .projectNodes(source, registry)
      .find((item) => item.id === "workflow-group:recognition-group");
    const boundary = projection
      .projectEdges(source, registry, EMPTY_EDGE_ACTIVITY)
      .find((item) => item.id === "custom-boundary");

    expect(proxy?.data.outputs.map((item) => item.portId)).toContain(
      "recognizer:result",
    );
    expect(
      proxy?.data.outputs.find((item) => item.portId === "recognizer:result")
        ?.connected,
    ).toBe(true);
    expect(boundary).toMatchObject({
      source: "workflow-group:recognition-group",
      sourceHandle: "recognizer:result",
      target: COMPARE,
      targetHandle: "left",
    });
  });
});

describe("projection stability", () => {
  it("returns the same objects when the graph is unchanged", () => {
    const projection = new GraphProjection();
    const source = baseGraph();

    const first = projection.projectNodes(source, registry);
    const second = projection.projectNodes(source, registry);

    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(second[2]).toBe(first[2]);
  });

  it("rebuilds only the node an edit touched", () => {
    const projection = new GraphProjection();
    const before = baseGraph();
    const first = projection.projectNodes(before, registry);

    const after: GraphV1 = {
      ...before,
      nodes: before.nodes.map((item) =>
        item.nodeId === START ? { ...item, position: { x: 8, y: 8 } } : item,
      ),
    };
    const second = projection.projectNodes(after, registry);

    expect(second[0]).not.toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(second[2]).toBe(first[2]);
  });

  it("rebuilds both endpoint nodes when their connection changes", () => {
    const projection = new GraphProjection();
    const connected = baseGraph();
    const first = projection.projectNodes(connected, registry);

    const disconnected: GraphV1 = { ...connected, edges: [] };
    const second = projection.projectNodes(disconnected, registry);

    const literalBefore = first.find((item) => item.id === LITERAL);
    const compareBefore = first.find((item) => item.id === COMPARE);
    const literalAfter = second.find((item) => item.id === LITERAL);
    const compareAfter = second.find((item) => item.id === COMPARE);
    expect(literalAfter).not.toBe(literalBefore);
    expect(compareAfter).not.toBe(compareBefore);
    expect(
      literalBefore?.data.outputs.find((port) => port.portId === "value")
        ?.connected,
    ).toBe(true);
    expect(
      literalAfter?.data.outputs.find((port) => port.portId === "value")
        ?.connected,
    ).toBe(false);
    expect(
      compareBefore?.data.inputs.find((port) => port.portId === "left")
        ?.connected,
    ).toBe(true);
    expect(
      compareAfter?.data.inputs.find((port) => port.portId === "left")
        ?.connected,
    ).toBe(false);
  });

  it("forgets nodes that have been removed", () => {
    const projection = new GraphProjection();
    projection.projectNodes(baseGraph(), registry);

    const reduced = projection.projectNodes(
      graph([node(START, "core.flow.start")]),
      registry,
    );

    expect(reduced).toHaveLength(1);
  });

  it("rebuilds everything when the registry snapshot is replaced", () => {
    const projection = new GraphProjection();
    const source = baseGraph();
    const first = projection.projectNodes(source, registry);
    const replacement: RinoNodeRegistrySnapshotV1 = { ...registry };

    expect(projection.projectNodes(source, replacement)[0]).not.toBe(first[0]);
  });

  it("never reuses cached render objects across graph identities", () => {
    const projection = new GraphProjection();
    const source = baseGraph();
    const first = projection.projectNodes(source, registry);
    const replacement: GraphV1 = {
      ...source,
      graphId: "7a6f5e4d-3c2b-4a19-8f7e-6d5c4b3a2910",
    };

    const second = projection.projectNodes(replacement, registry);

    expect(second[0]).not.toBe(first[0]);
    expect(second[0]?.data.graphId).toBe(replacement.graphId);
  });

  it("projects same-kind variable controls and hides the raw identifier field", () => {
    const projection = new GraphProjection();
    const source: GraphV1 = {
      ...graph([
        node("variable-node", "core.variable.getNumber", {
          properties: { variableId: NUMBER_ID },
        }),
      ]),
      variables: [
        {
          variableId: NUMBER_ID,
          name: "score",
          valueKind: "number",
          persistent: true,
        },
        {
          variableId: "string-variable",
          name: "label",
          valueKind: "string",
          persistent: false,
        },
      ],
    };

    const projected = projection.projectNodes(source, variableRegistry())[0];
    expect(projected?.data.variableControl).toMatchObject({
      valueKind: "number",
      selectedVariableId: NUMBER_ID,
      selectedVariableName: "score",
      selectedPersistent: true,
      canPersist: true,
      variableMissing: false,
    });
    expect(projected?.data.variableControl?.options).toEqual([
      { variableId: NUMBER_ID, name: "score", persistent: true },
    ]);
    expect(
      projected?.data.propertyFields?.some(
        (field) => field.propertyKey === "variableId",
      ),
    ).toBe(false);
  });

  it("hides permanent variable persistence inside function graphs", () => {
    const projection = new GraphProjection();
    const source: GraphV1 = {
      ...graph([
        node("function-variable-node", "core.variable.getNumber", {
          properties: { variableId: NUMBER_ID },
        }),
      ]),
      kind: "function",
      functionSignature: { inputs: [], outputs: [] },
      variables: [
        {
          variableId: NUMBER_ID,
          name: "score",
          valueKind: "number",
          persistent: true,
        },
      ],
    };

    const projected = projection.projectNodes(source, variableRegistry())[0];
    expect(projected?.data.variableControl).toMatchObject({
      selectedPersistent: true,
      canPersist: false,
    });
  });

  it("refreshes all variable controls when the directory reference changes", () => {
    const projection = new GraphProjection();
    const before: GraphV1 = {
      ...graph([
        node("variable-node", "core.variable.getNumber", {
          properties: { variableId: NUMBER_ID },
        }),
      ]),
      variables: [
        {
          variableId: NUMBER_ID,
          name: "score",
          valueKind: "number",
          persistent: false,
        },
      ],
    };
    const first = projection.projectNodes(before, variableRegistry())[0];
    const after: GraphV1 = {
      ...before,
      variables: [
        {
          variableId: NUMBER_ID,
          name: "total",
          valueKind: "number",
          persistent: true,
        },
      ],
    };
    const second = projection.projectNodes(after, variableRegistry())[0];

    expect(second).not.toBe(first);
    expect(second?.data.variableControl?.selectedVariableName).toBe("total");
    expect(second?.data.variableControl?.selectedPersistent).toBe(true);
  });

  it("keeps an unknown binding recoverable with the same-kind options", () => {
    const source: GraphV1 = {
      ...graph([
        node("variable-node", "core.variable.getNumber", {
          properties: { variableId: "missing-variable" },
        }),
      ]),
      variables: [
        {
          variableId: NUMBER_ID,
          name: "score",
          valueKind: "number",
          persistent: false,
        },
      ],
    };

    const projected = new GraphProjection().projectNodes(
      source,
      variableRegistry(),
    )[0];
    expect(projected?.data.variableControl).toMatchObject({
      selectedVariableId: "missing-variable",
      selectedVariableName: undefined,
      variableMissing: true,
    });
    expect(projected?.data.variableControl?.options).toHaveLength(1);
  });
});

describe("edge projection", () => {
  it("maps ports onto handles and colours the edge by its source type", () => {
    const projection = new GraphProjection();
    const edges = projection.projectEdges(
      baseGraph(),
      registry,
      EMPTY_EDGE_ACTIVITY,
    );

    expect(edges[0]).toMatchObject({
      id: EDGE,
      source: LITERAL,
      sourceHandle: "value",
      target: COMPARE,
      targetHandle: "left",
    });
    expect(edges[0]?.data).toEqual({
      edgeKind: "data",
      colorRole: "number",
      typeLabel: "number",
      activity: "idle",
    });
  });

  it("carries execution activity onto the edge and rebuilds it when that changes", () => {
    const projection = new GraphProjection();
    const source = baseGraph();
    const active: EdgeActivityMap = new Map([[EDGE, "active" as const]]);

    const idle = projection.projectEdges(source, registry, EMPTY_EDGE_ACTIVITY);
    const running = projection.projectEdges(source, registry, active);
    const traversed = projection.projectEdges(
      source,
      registry,
      new Map([[EDGE, "traversed" as const]]),
    );

    expect(idle[0]?.data?.activity).toBe("idle");
    expect(running[0]?.data?.activity).toBe("active");
    expect(traversed[0]?.data?.activity).toBe("traversed");
    expect(running[0]).not.toBe(idle[0]);
  });

  it("returns the same edge object while nothing about it changes", () => {
    const projection = new GraphProjection();
    const source = baseGraph();

    const first = projection.projectEdges(
      source,
      registry,
      EMPTY_EDGE_ACTIVITY,
    );
    const second = projection.projectEdges(
      source,
      registry,
      EMPTY_EDGE_ACTIVITY,
    );

    expect(second[0]).toBe(first[0]);
  });
});

describe("function node projection", () => {
  it("resolves internal nodes outside the production registry", () => {
    const document = functionDocument();
    const entry = document.graphs[0];
    const functionGraph = document.graphs[1];
    if (entry === undefined || functionGraph === undefined) {
      throw new Error("Function fixture graphs are required.");
    }

    expect(
      registry.definitions.some(
        (item) => item.typeKey === "core.function.call",
      ),
    ).toBe(false);
    const entryNode = new GraphProjection().projectNodes(
      entry,
      registry,
      document,
    )[0];
    const inputNode = new GraphProjection().projectNodes(
      functionGraph,
      registry,
      document,
    )[0];

    expect(entryNode?.data.unresolved).toBe(false);
    expect(entryNode?.data.titleOverride).toBe("Calculate score");
    expect(entryNode?.data.inputs.map((port) => port.portId)).toContain(
      "input-value",
    );
    expect(
      inputNode?.data.outputs.find((port) => port.portId === "input-value"),
    ).toMatchObject({
      portId: "input-value",
      labelOverride: "Input value",
      typeLabel: "number",
    });
  });

  it("invalidates a call projection when the target signature changes", () => {
    const document = functionDocument();
    const entry = document.graphs[0];
    if (entry === undefined) {
      throw new Error("Function entry fixture is required.");
    }
    const projection = new GraphProjection();
    const first = projection.projectNodes(entry, registry, document)[0];
    const changedDocument: RinoProjectDocumentV1 = {
      ...document,
      graphs: document.graphs.map((graph) =>
        graph.graphId === FUNCTION_GRAPH_ID
          ? {
              ...graph,
              functionSignature: functionSignature("string"),
            }
          : graph,
      ),
    };
    const second = projection.projectNodes(
      changedDocument.graphs[0] ?? entry,
      registry,
      changedDocument,
    )[0];

    expect(second).not.toBe(first);
    expect(second?.data.outputs.map((port) => port.typeLabel)).toContain(
      "string",
    );
  });

  it("uses the effective function port type when projecting edge colour", () => {
    const document = functionDocument();
    const entry = document.graphs[0];
    if (entry === undefined) {
      throw new Error("Function entry fixture is required.");
    }
    const call = entry.nodes[0];
    if (call === undefined) {
      throw new Error("Function call fixture is required.");
    }
    const target = node(COMPARE, "core.logic.numberCompare", {
      position: { x: 320, y: 0 },
    });
    const graphWithFunctionEdge: GraphV1 = {
      ...entry,
      nodes: [...entry.nodes, target],
      edges: [
        {
          edgeId: "function-data-edge",
          edgeKind: "data",
          sourceNodeId: call.nodeId,
          sourcePortId: "output-value",
          targetNodeId: target.nodeId,
          targetPortId: "left",
        },
      ],
    };
    const edge = new GraphProjection().projectEdges(
      graphWithFunctionEdge,
      registry,
      EMPTY_EDGE_ACTIVITY,
      document,
    )[0];

    expect(edge?.data).toMatchObject({
      edgeKind: "data",
      colorRole: "number",
      typeLabel: "number",
    });
  });
});

describe("render-state merging", () => {
  function flowNode(
    id: string,
    overrides: Partial<RinoFlowNode> = {},
  ): RinoFlowNode {
    return {
      id,
      type: RINO_NODE_TYPE,
      position: { x: 0, y: 0 },
      data: {
        graphId: "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e",
        nodeId: id,
        typeKey: "core.flow.start",
        titleKey: "node.core.flow.start.title",
        displayAlias: undefined,
        iconKey: "run.start",
        category: "flow",
        inputs: [],
        outputs: [],
        disabled: false,
        breakpoint: false,
        unresolved: false,
      },
      ...overrides,
    };
  }

  it("carries selection and measurement onto a rebuilt node", () => {
    const projected = flowNode(START, { position: { x: 16, y: 16 } });
    const current = flowNode(START, {
      selected: true,
      measured: { width: 220, height: 96 },
    });

    const merged = mergeNodeRenderState([projected], [current])[0];

    expect(merged?.selected).toBe(true);
    expect(merged?.measured).toEqual({ width: 220, height: 96 });
    expect(merged?.position).toEqual({ x: 16, y: 16 });
  });

  it("returns the existing node untouched when nothing changed", () => {
    const projected = flowNode(START);
    const current: RinoFlowNode = {
      ...projected,
      selected: true,
      position: { x: 0, y: 0 },
    };

    expect(mergeNodeRenderState([projected], [current])[0]).toBe(current);
  });

  it("leaves a node being dragged in the position the pointer put it", () => {
    const projected = flowNode(START, { position: { x: 0, y: 0 } });
    const dragging = flowNode(START, {
      position: { x: 137, y: 42 },
      dragging: true,
    });

    expect(mergeNodeRenderState([projected], [dragging])[0]).toBe(dragging);
  });

  it("never lets render metadata reach the projected data", () => {
    const projected = flowNode(START, { position: { x: 16, y: 0 } });
    const current = flowNode(START, { selected: true, width: 220 });

    const merged = mergeNodeRenderState([projected], [current])[0];

    expect(merged?.data).toBe(projected.data);
  });

  it("keeps edge selection across a rebuild", () => {
    const projected = {
      id: EDGE,
      source: LITERAL,
      target: COMPARE,
      data: {
        edgeKind: "data" as const,
        colorRole: "number" as const,
        typeLabel: "number",
        activity: "idle" as const,
      },
    };
    const current = {
      ...projected,
      data: { ...projected.data },
      selected: true,
    };

    expect(mergeEdgeRenderState([projected], [current])[0]?.selected).toBe(
      true,
    );
  });
});
