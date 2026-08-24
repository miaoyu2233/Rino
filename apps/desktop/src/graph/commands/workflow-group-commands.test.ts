import type {
  NodeDefinitionV1,
  NodeV1,
  PortDefinitionV1,
  RinoNodeRegistrySnapshotV1,
  RinoProjectDocumentV1,
  TypeDescriptorV1,
  WorkflowGroupV1,
} from "@rino/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useRegistryStore } from "../registry/registry-store";
import { useCoordinatePickerStore } from "../../device-preview/coordinate-picker-store";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import {
  focusCoordinateNode,
  focusImageRecognitionRegion,
  promoteInputToNode,
  setImageRecognitionRegion,
  setImageRecognitionRegionEnabled,
  setImageRecognitionMethod,
  setImageRecognitionTemplateAsset,
  setImageRecognitionThreshold,
  setRecognitionDelayMode,
  setRecognitionClickMethod,
  setTextRecognitionClickPoint,
  setTextRecognitionClickMethod,
  setTextRecognitionConfidence,
  setTextRecognitionDelay,
  setTextRecognitionRegion,
  setTextRecognitionRegionEnabled,
} from "./workflow-group-commands";

const GRAPH_ID = "graph";

function port(
  portId: string,
  direction: PortDefinitionV1["direction"],
  kind: TypeDescriptorV1["kind"],
): PortDefinitionV1 {
  return {
    portId,
    direction,
    portKind: kind === "exec" ? "execution" : "data",
    type: { kind } as TypeDescriptorV1,
    labelKey: `node.test.port.${portId}`,
  };
}

function collectionPort(
  portId: string,
  direction: PortDefinitionV1["direction"],
  elementKind: TypeDescriptorV1["kind"],
): PortDefinitionV1 {
  return {
    portId,
    direction,
    portKind: "data",
    type: {
      kind: "collection",
      element: { kind: elementKind },
    } as TypeDescriptorV1,
    labelKey: `node.test.port.${portId}`,
  };
}

function definition(
  typeKey: string,
  ports: PortDefinitionV1[],
  propertyDefaults: NodeDefinitionV1["propertyDefaults"] = {},
): NodeDefinitionV1 {
  return {
    typeKey,
    typeVersion: 1,
    runtimeKind: "execution",
    sideEffect: "none",
    category: "vision",
    titleKey: `node.${typeKey}.title`,
    descriptionKey: `node.${typeKey}.description`,
    iconKey: "node.ocr",
    ports,
    propertyDefaults,
  };
}

const EXECUTION_PAIR = [
  port("run", "input", "exec"),
  port("next", "output", "exec"),
];
const MATCH_OUTPUTS = [
  ...EXECUTION_PAIR,
  port("image", "input", "imageRef"),
  port("roi", "input", "rect"),
  port("matched", "output", "bool"),
  port("bestRect", "output", "rect"),
  port("matchedRegionIndex", "output", "number"),
];
const TEMPLATE_OUTPUTS = [
  ...MATCH_OUTPUTS,
  port("bestScore", "output", "number"),
];
const FEATURE_OUTPUTS = [
  ...MATCH_OUTPUTS,
  port("bestCount", "output", "number"),
];

const registry: RinoNodeRegistrySnapshotV1 = {
  schemaVersion: 1,
  registryVersion: "workflow-group-test",
  definitions: [
    definition(
      "vision.templateMatch",
      [
        ...TEMPLATE_OUTPUTS,
        port("template", "input", "imageRef"),
        collectionPort("templates", "input", "imageRef"),
      ],
      { method: "normalizedCoefficient" },
    ),
    definition(
      "vision.featureMatch",
      [
        ...FEATURE_OUTPUTS,
        port("template", "input", "imageRef"),
        collectionPort("templates", "input", "imageRef"),
      ],
      { detector: "SIFT" },
    ),
    definition("vision.colorMatch", FEATURE_OUTPUTS, { method: "RGB" }),
    definition("core.image.projectAsset", [
      port("image", "output", "imageRef"),
    ]),
    definition("core.geometry.rectangle", [
      port("image", "input", "imageRef"),
      port("rectangle", "output", "rect"),
    ]),
    definition("core.geometry.point", [
      port("image", "input", "imageRef"),
      { ...port("x", "input", "number"), acceptsLiteral: true },
      { ...port("y", "input", "number"), acceptsLiteral: true },
      { ...port("referenceWidth", "input", "number"), acceptsLiteral: true },
      { ...port("referenceHeight", "input", "number"), acceptsLiteral: true },
      port("point", "output", "point"),
    ]),
    definition(
      "vision.ocr",
      [
        ...EXECUTION_PAIR,
        port("image", "input", "imageRef"),
        port("roi", "input", "rect"),
        port("matched", "output", "bool"),
        port("bestRect", "output", "rect"),
      ],
      { confidenceThreshold: 0.3 },
    ),
    definition("automation.clickRectCenter", [
      ...EXECUTION_PAIR,
      port("rect", "input", "rect"),
    ]),
    definition("automation.clickPoint", [
      ...EXECUTION_PAIR,
      port("point", "input", "point"),
    ]),
    definition("core.flow.sequence", [
      port("run", "input", "exec"),
      port("steps", "output", "exec"),
    ]),
    definition(
      "core.value.numberLiteral",
      [port("value", "output", "number")],
      {
        value: 0,
      },
    ),
    definition("core.time.delay", [
      ...EXECUTION_PAIR,
      {
        ...port("durationMilliseconds", "input", "number"),
        acceptsLiteral: true,
      },
    ]),
  ],
  workflowTemplates: [],
};

function node(
  nodeId: string,
  typeKey: string,
  inputValues: NodeV1["inputValues"] = {},
): NodeV1 {
  return {
    nodeId,
    typeKey,
    typeVersion: 1,
    position: { x: 400, y: 100 },
    properties: {},
    inputValues,
  };
}

function project(
  nodes: NodeV1[],
  edges: RinoProjectDocumentV1["graphs"][number]["edges"],
  workflowGroups: WorkflowGroupV1[],
  assets: RinoProjectDocumentV1["assets"] = [],
): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "document",
    metadata: {
      name: "Test",
      createdAt: "2026-07-29T00:00:00Z",
      updatedAt: "2026-07-29T00:00:00Z",
    },
    entryGraphId: GRAPH_ID,
    graphs: [
      {
        graphId: GRAPH_ID,
        name: "Main",
        kind: "entry",
        nodes,
        edges,
        editorMetadata: { workflowGroups },
      },
    ],
    assets,
    requiredCapabilities: [],
  };
}

function currentGraph() {
  const graph = useDocumentStore.getState().history?.document.graphs[0];
  if (graph === undefined) {
    throw new Error("Expected an open graph.");
  }
  return graph;
}

beforeEach(() => {
  useRegistryStore.getState().installSnapshot(registry, "development");
  useEditorSessionStore.getState().setActiveGraph(GRAPH_ID);
  useCoordinatePickerStore.setState({
    pendingRequest: undefined,
    session: undefined,
  });
});

afterEach(() => {
  useDocumentStore.getState().closeDocument();
  useRegistryStore.getState().clearSnapshot();
  useEditorSessionStore.getState().resetSession();
  useCoordinatePickerStore.setState({
    pendingRequest: undefined,
    session: undefined,
  });
});

describe("workflow group methods", () => {
  it("opens the coordinate picker for a direct click-point node", () => {
    useDocumentStore
      .getState()
      .openDocument(project([node("click", "automation.clickPoint")], [], []));

    expect(focusCoordinateNode(GRAPH_ID, "click")).toBe(true);
    expect(useEditorSessionStore.getState().selectedNodeIds).toEqual(["click"]);
    expect(useCoordinatePickerStore.getState().pendingRequest).toMatchObject({
      kind: "point",
      target: {
        graphId: GRAPH_ID,
        nodeId: "click",
        nodeTypeKey: "automation.clickPoint",
      },
    });
  });

  it("rejects click-only timing for a disabled recognition click member", () => {
    const group: WorkflowGroupV1 = {
      groupId: "text-group",
      kind: "textRecognition",
      collapsed: true,
      members: [
        { role: "delay", nodeId: "delay" },
        { role: "capture", nodeId: "capture" },
        { role: "recognizer", nodeId: "ocr" },
        { role: "matchBranch", nodeId: "branch" },
        { role: "click", nodeId: "click" },
      ],
      exposedPorts: [
        {
          proxyPortId: "run",
          nodeId: "capture",
          portId: "run",
          labelKey: "workflowGroup.textRecognition.port.run",
        },
      ],
    };
    useDocumentStore
      .getState()
      .openDocument(
        project(
          [
            node("delay", "core.time.delay", { durationMilliseconds: 100 }),
            node("capture", "automation.captureScreen"),
            node("ocr", "vision.ocr"),
            node("branch", "core.logic.branch"),
            node("click", "core.flow.sequence"),
          ],
          [],
          [group],
        ),
      );

    expect(setRecognitionDelayMode("text-group", "beforeClick")).toBe(false);
    expect(currentGraph().edges).toEqual([]);
    expect(
      currentGraph().editorMetadata?.workflowGroups?.[0]?.exposedPorts[0],
    ).toMatchObject({ nodeId: "capture", portId: "run" });
  });

  it("moves the new recognition delay between capture and click", () => {
    const group: WorkflowGroupV1 = {
      groupId: "text-group",
      kind: "textRecognition",
      collapsed: true,
      members: [
        { role: "delay", nodeId: "delay" },
        { role: "capture", nodeId: "capture" },
        { role: "recognizer", nodeId: "ocr" },
        { role: "matchBranch", nodeId: "branch" },
        { role: "click", nodeId: "click" },
      ],
      exposedPorts: [
        {
          proxyPortId: "run",
          nodeId: "delay",
          portId: "run",
          labelKey: "workflowGroup.textRecognition.port.run",
        },
      ],
    };
    useDocumentStore.getState().openDocument(
      project(
        [
          node("delay", "core.time.delay", { durationMilliseconds: 100 }),
          node("capture", "automation.captureScreen"),
          node("ocr", "vision.ocr"),
          node("branch", "core.logic.branch"),
          node("click", "automation.clickRectCenter"),
        ],
        [
          {
            edgeId: "delay-capture",
            edgeKind: "execution",
            sourceNodeId: "delay",
            sourcePortId: "next",
            targetNodeId: "capture",
            targetPortId: "run",
          },
          {
            edgeId: "capture-ocr",
            edgeKind: "execution",
            sourceNodeId: "capture",
            sourcePortId: "next",
            targetNodeId: "ocr",
            targetPortId: "run",
          },
          {
            edgeId: "ocr-branch",
            edgeKind: "execution",
            sourceNodeId: "ocr",
            sourcePortId: "next",
            targetNodeId: "branch",
            targetPortId: "run",
          },
          {
            edgeId: "branch-click",
            edgeKind: "execution",
            sourceNodeId: "branch",
            sourcePortId: "whenTrue",
            targetNodeId: "click",
            targetPortId: "run",
          },
        ],
        [group],
      ),
    );

    expect(setRecognitionDelayMode("text-group", "beforeClick")).toBe(true);
    let graph = currentGraph();
    expect(
      graph.editorMetadata?.workflowGroups?.[0]?.exposedPorts[0],
    ).toMatchObject({ nodeId: "capture", portId: "run" });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: "branch",
          sourcePortId: "whenTrue",
          targetNodeId: "delay",
        }),
        expect.objectContaining({
          sourceNodeId: "delay",
          sourcePortId: "next",
          targetNodeId: "click",
        }),
      ]),
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.sourceNodeId === "delay" && edge.targetNodeId === "capture",
      ),
    ).toBe(false);

    expect(setRecognitionDelayMode("text-group", "beforeRecognition")).toBe(
      true,
    );
    graph = currentGraph();
    expect(
      graph.editorMetadata?.workflowGroups?.[0]?.exposedPorts[0],
    ).toMatchObject({ nodeId: "delay", portId: "run" });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: "delay",
          sourcePortId: "next",
          targetNodeId: "capture",
        }),
        expect.objectContaining({
          sourceNodeId: "branch",
          sourcePortId: "whenTrue",
          targetNodeId: "click",
        }),
      ]),
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.sourceNodeId === "delay" && edge.targetNodeId === "click",
      ),
    ).toBe(false);
  });

  it("keeps template and region as internal connected parameters", () => {
    const group: WorkflowGroupV1 = {
      groupId: "image-group",
      kind: "imageRecognition",
      collapsed: true,
      members: [
        { role: "templateAsset", nodeId: "asset" },
        { role: "capture", nodeId: "capture" },
        { role: "recognizer", nodeId: "recognizer" },
        { role: "roi", nodeId: "roi" },
      ],
      exposedPorts: [],
    };
    const assetNode = node("asset", "core.image.projectAsset");
    const roiNode = node("roi", "core.geometry.rectangle", {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      referenceWidth: 1,
      referenceHeight: 1,
    });
    useDocumentStore.getState().openDocument(
      project(
        [
          assetNode,
          node("capture", "automation.captureScreen"),
          node("recognizer", "vision.templateMatch"),
          roiNode,
        ],
        [
          {
            edgeId: "template-edge",
            edgeKind: "data",
            sourceNodeId: "asset",
            sourcePortId: "image",
            targetNodeId: "recognizer",
            targetPortId: "template",
          },
          {
            edgeId: "roi-image",
            edgeKind: "data",
            sourceNodeId: "capture",
            sourcePortId: "image",
            targetNodeId: "roi",
            targetPortId: "image",
          },
        ],
        [group],
        [
          {
            assetId: "01234567-89ab-4cde-8f01-23456789abcd",
            displayName: "确认按钮",
            contentHash: "ab".repeat(32),
            mediaType: "image/png",
            byteLength: 120,
            coordinateSpace: {
              spaceId: "device-space",
              width: 1080,
              height: 1920,
            },
            sourceKind: "regionCapture",
            createdAt: "2026-07-29T00:00:00Z",
          },
        ],
      ),
    );

    expect(
      setImageRecognitionTemplateAsset(
        "image-group",
        "01234567-89ab-4cde-8f01-23456789abcd",
      ),
    ).toBe(true);
    expect(
      currentGraph().nodes.find((item) => item.nodeId === "asset")?.properties,
    ).toMatchObject({ assetId: "01234567-89ab-4cde-8f01-23456789abcd" });
    expect(setImageRecognitionThreshold("image-group", 0.82)).toBe(true);
    expect(
      currentGraph().nodes.find((item) => item.nodeId === "recognizer")
        ?.properties,
    ).toMatchObject({ threshold: 0.82 });
    expect(setImageRecognitionThreshold("image-group", -0.01)).toBe(false);
    expect(setImageRecognitionThreshold("image-group", 1.01)).toBe(false);
    expect(
      currentGraph().nodes.find((item) => item.nodeId === "roi")?.inputValues,
    ).toMatchObject({
      width: 1,
      height: 1,
      referenceWidth: 1,
      referenceHeight: 1,
    });

    expect(setImageRecognitionRegionEnabled("image-group", true)).toBe(true);
    expect(
      setImageRecognitionRegion("image-group", {
        x: 20,
        y: 30,
        width: 300,
        height: 400,
        referenceWidth: 1080,
        referenceHeight: 1920,
      }),
    ).toBe(true);
    expect(currentGraph().edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: "roi",
        sourcePortId: "rectangle",
        targetNodeId: "recognizer",
        targetPortId: "roi",
      }),
    );
    expect(
      currentGraph().nodes.find((item) => item.nodeId === "roi")?.inputValues,
    ).toMatchObject({ x: 20, y: 30, width: 300, height: 400 });

    expect(
      setImageRecognitionRegion("image-group", {
        x: 20,
        y: 30,
        width: 300,
        height: 400,
        referenceWidth: 100,
        referenceHeight: 100,
      }),
    ).toBe(true);
    expect(
      setImageRecognitionRegion("image-group", {
        x: 0,
        y: 0,
        width: 20_000,
        height: 1,
        referenceWidth: 1,
        referenceHeight: 1,
      }),
    ).toBe(false);

    expect(setImageRecognitionMethod("image-group", "color")).toBe(true);
    expect(
      currentGraph().edges.some((edge) => edge.targetPortId === "template"),
    ).toBe(false);
    expect(setImageRecognitionMethod("image-group", "feature")).toBe(true);
    expect(currentGraph().edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: "asset",
        sourcePortId: "image",
        targetNodeId: "recognizer",
        targetPortId: "template",
      }),
    );

    expect(focusImageRecognitionRegion("image-group")).toBe(true);
    expect(useEditorSessionStore.getState().selectedNodeIds).toEqual(["roi"]);
    expect(useCoordinatePickerStore.getState().pendingRequest).toMatchObject({
      kind: "rectangle",
      target: {
        graphId: GRAPH_ID,
        nodeId: "roi",
        nodeTypeKey: "core.geometry.rectangle",
      },
    });
  });

  it("switches image recognition without leaving an invalid template edge", () => {
    const group: WorkflowGroupV1 = {
      groupId: "image-group",
      kind: "imageRecognition",
      collapsed: true,
      members: [
        { role: "capture", nodeId: "capture" },
        { role: "recognizer", nodeId: "recognizer" },
      ],
      exposedPorts: [
        {
          proxyPortId: "templates",
          nodeId: "recognizer",
          portId: "templates",
          labelKey: "workflowGroup.imageRecognition.port.templates",
        },
        {
          proxyPortId: "matchValue",
          nodeId: "recognizer",
          portId: "bestScore",
          labelKey: "workflowGroup.imageRecognition.port.matchValue",
        },
      ],
    };
    useDocumentStore.getState().openDocument(
      project(
        [
          node("capture", "automation.captureScreen"),
          node("recognizer", "vision.templateMatch"),
          node("template-source", "automation.captureScreen"),
        ],
        [
          {
            edgeId: "template-edge",
            edgeKind: "data",
            sourceNodeId: "template-source",
            sourcePortId: "image",
            targetNodeId: "recognizer",
            targetPortId: "template",
          },
        ],
        [group],
      ),
    );

    expect(setImageRecognitionMethod("image-group", "color")).toBe(true);
    expect(
      currentGraph().nodes.find((item) => item.nodeId === "recognizer")
        ?.typeKey,
    ).toBe("vision.colorMatch");
    expect(currentGraph().edges).toEqual([]);
    const colorPorts =
      currentGraph().editorMetadata?.workflowGroups?.[0]?.exposedPorts ?? [];
    expect(colorPorts).toHaveLength(1);
    expect(colorPorts[0]).toMatchObject({
      proxyPortId: "matchValue",
      portId: "bestCount",
    });

    expect(setImageRecognitionMethod("image-group", "feature")).toBe(true);
    const featurePorts =
      currentGraph().editorMetadata?.workflowGroups?.[0]?.exposedPorts ?? [];
    expect(featurePorts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proxyPortId: "templates",
          portId: "templates",
        }),
        expect.objectContaining({
          proxyPortId: "matchValue",
          portId: "bestCount",
        }),
      ]),
    );

    expect(setImageRecognitionMethod("image-group", "template")).toBe(true);
    const templatePorts =
      currentGraph().editorMetadata?.workflowGroups?.[0]?.exposedPorts ?? [];
    expect(templatePorts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proxyPortId: "templates",
          portId: "templates",
        }),
        expect.objectContaining({
          proxyPortId: "matchValue",
          portId: "bestScore",
        }),
      ]),
    );

    expect(
      currentGraph().nodes.find((item) => item.nodeId === "recognizer")
        ?.typeKey,
    ).toBe("vision.templateMatch");
  });

  it("switches OCR clicking to a point input while preserving the execution path", () => {
    const group: WorkflowGroupV1 = {
      groupId: "text-group",
      kind: "textRecognition",
      collapsed: true,
      members: [
        { role: "recognizer", nodeId: "ocr" },
        { role: "matchBranch", nodeId: "branch" },
        { role: "click", nodeId: "click" },
        { role: "afterDelay", nodeId: "after-delay" },
      ],
      exposedPorts: [],
    };
    useDocumentStore.getState().openDocument(
      project(
        [
          node("ocr", "vision.ocr"),
          node("branch", "core.logic.branch"),
          node("click", "automation.clickRectCenter"),
          node("after-delay", "core.time.delay"),
        ],
        [
          {
            edgeId: "rect-edge",
            edgeKind: "data",
            sourceNodeId: "ocr",
            sourcePortId: "bestRect",
            targetNodeId: "click",
            targetPortId: "rect",
          },
          {
            edgeId: "next-edge",
            edgeKind: "execution",
            sourceNodeId: "click",
            sourcePortId: "next",
            targetNodeId: "after-delay",
            targetPortId: "run",
          },
        ],
        [group],
      ),
    );

    expect(setTextRecognitionClickMethod("text-group", "point")).toBe(true);
    expect(
      currentGraph().nodes.find((item) => item.nodeId === "click")?.typeKey,
    ).toBe("automation.clickPoint");
    expect(
      currentGraph().edges.some((edge) => edge.edgeId === "rect-edge"),
    ).toBe(false);
    expect(
      currentGraph().edges.some((edge) => edge.edgeId === "next-edge"),
    ).toBe(true);
    expect(
      currentGraph().editorMetadata?.workflowGroups?.[0]?.exposedPorts[0],
    ).toMatchObject({ proxyPortId: "clickPoint", portId: "point" });
  });

  it("enables clicking inside the compact image recognition node", () => {
    const group: WorkflowGroupV1 = {
      groupId: "image-group",
      kind: "imageRecognition",
      collapsed: true,
      members: [
        { role: "recognizer", nodeId: "recognizer" },
        { role: "matchBranch", nodeId: "branch" },
        { role: "click", nodeId: "click" },
      ],
      exposedPorts: [],
    };
    useDocumentStore.getState().openDocument(
      project(
        [
          node("recognizer", "vision.templateMatch"),
          node("branch", "core.logic.branch"),
          node("click", "core.flow.sequence"),
        ],
        [
          {
            edgeId: "success-edge",
            edgeKind: "execution",
            sourceNodeId: "branch",
            sourcePortId: "whenTrue",
            targetNodeId: "click",
            targetPortId: "run",
          },
        ],
        [group],
      ),
    );

    expect(setRecognitionClickMethod("image-group", "rectCenter")).toBe(true);
    expect(
      currentGraph().nodes.find((item) => item.nodeId === "click")?.typeKey,
    ).toBe("automation.clickRectCenter");
    expect(currentGraph().edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: "recognizer",
        sourcePortId: "bestRect",
        targetNodeId: "click",
        targetPortId: "rect",
      }),
    );
  });

  it("edits collapsed text recognition parameters on their ordinary nodes", () => {
    const group: WorkflowGroupV1 = {
      groupId: "text-group",
      kind: "textRecognition",
      collapsed: true,
      members: [
        { role: "beforeDelay", nodeId: "before-delay" },
        { role: "capture", nodeId: "capture" },
        { role: "recognizer", nodeId: "ocr" },
        { role: "roi", nodeId: "roi" },
        { role: "matchBranch", nodeId: "branch" },
        { role: "click", nodeId: "click" },
        { role: "clickPoint", nodeId: "point" },
        { role: "afterDelay", nodeId: "after-delay" },
      ],
      exposedPorts: [],
    };
    useDocumentStore.getState().openDocument(
      project(
        [
          node("before-delay", "core.time.delay", {
            durationMilliseconds: 0,
          }),
          node("capture", "automation.captureScreen"),
          node("ocr", "vision.ocr"),
          node("roi", "core.geometry.rectangle", {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            referenceWidth: 1,
            referenceHeight: 1,
          }),
          node("branch", "core.logic.branch"),
          node("click", "automation.clickRectCenter"),
          node("point", "core.geometry.point", {
            x: 0,
            y: 0,
            referenceWidth: 1,
            referenceHeight: 1,
          }),
          node("after-delay", "core.time.delay", {
            durationMilliseconds: 0,
          }),
        ],
        [],
        [group],
      ),
    );

    expect(setTextRecognitionDelay("text-group", "beforeDelay", 250)).toBe(
      true,
    );
    expect(setTextRecognitionDelay("text-group", "afterDelay", 500)).toBe(true);
    expect(setTextRecognitionConfidence("text-group", 0.75)).toBe(true);
    expect(
      setTextRecognitionRegion("text-group", {
        x: 10,
        y: 20,
        width: 300,
        height: 180,
        referenceWidth: 1080,
        referenceHeight: 1920,
      }),
    ).toBe(true);
    expect(setTextRecognitionRegionEnabled("text-group", true)).toBe(true);
    expect(
      setTextRecognitionClickPoint("text-group", {
        x: 640,
        y: 360,
        referenceWidth: 1280,
        referenceHeight: 720,
      }),
    ).toBe(true);
    expect(setTextRecognitionClickMethod("text-group", "point")).toBe(true);

    const graph = currentGraph();
    expect(
      graph.nodes.find((item) => item.nodeId === "before-delay")?.inputValues,
    ).toMatchObject({ durationMilliseconds: 250 });
    expect(
      graph.nodes.find((item) => item.nodeId === "after-delay")?.inputValues,
    ).toMatchObject({ durationMilliseconds: 500 });
    expect(
      graph.nodes.find((item) => item.nodeId === "ocr")?.properties,
    ).toMatchObject({ confidenceThreshold: 0.75 });
    expect(
      graph.nodes.find((item) => item.nodeId === "roi")?.inputValues,
    ).toMatchObject({ x: 10, y: 20, width: 300, height: 180 });
    expect(
      graph.nodes.find((item) => item.nodeId === "point")?.inputValues,
    ).toMatchObject({
      x: 640,
      y: 360,
      referenceWidth: 1280,
      referenceHeight: 720,
    });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: "roi",
          sourcePortId: "rectangle",
          targetNodeId: "ocr",
          targetPortId: "roi",
        }),
        expect.objectContaining({
          sourceNodeId: "point",
          sourcePortId: "point",
          targetNodeId: "click",
          targetPortId: "point",
        }),
      ]),
    );
    expect(group.exposedPorts).toEqual([]);
  });
});

describe("input promotion", () => {
  it("extracts an inline delay into a connected number node in one undo step", () => {
    useDocumentStore
      .getState()
      .openDocument(
        project(
          [node("delay", "core.time.delay", { durationMilliseconds: 250 })],
          [],
          [],
        ),
      );

    expect(promoteInputToNode("delay", "durationMilliseconds", "number")).toBe(
      true,
    );
    const graph = currentGraph();
    const literal = graph.nodes.find(
      (item) => item.typeKey === "core.value.numberLiteral",
    );
    expect(literal?.properties["value"]).toBe(250);
    expect(
      graph.nodes.find((item) => item.nodeId === "delay")?.inputValues,
    ).toEqual({});
    expect(graph.edges[0]).toMatchObject({
      sourceNodeId: literal?.nodeId,
      sourcePortId: "value",
      targetNodeId: "delay",
      targetPortId: "durationMilliseconds",
    });

    useDocumentStore.getState().undoChange();
    expect(currentGraph().nodes).toHaveLength(1);
    expect(currentGraph().nodes[0]?.inputValues["durationMilliseconds"]).toBe(
      250,
    );
  });
});
