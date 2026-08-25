import { ReactFlowProvider, useStoreApi, type NodeProps } from "@xyflow/react";
import type { RinoProjectDocumentV1 } from "@rino/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/Tooltip";
import { applicationI18n } from "../../localization/i18n";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import type {
  CanvasNodeData,
  CanvasPortView,
  RinoFlowNode,
} from "./graph-view-model";
import { shouldFloatDisplayAlias } from "./alias-display";
import { RinoNodeView } from "./RinoNodeView";

function renderNode(element: ReactNode) {
  return render(<TooltipProvider>{element}</TooltipProvider>);
}

function SetCanvasZoom({ zoom }: { zoom: number }) {
  const store = useStoreApi();

  useEffect(() => {
    store.setState({ transform: [0, 0, zoom] });
  }, [store, zoom]);

  return null;
}

function port(
  portId: string,
  portKind: CanvasPortView["portKind"],
): CanvasPortView {
  return {
    portId,
    domainNodeId: "node",
    domainPortId: portId,
    labelKey: `node.core.time.delay.port.${portId}`,
    typeLabel: portKind === "execution" ? "exec" : "number",
    showTypeLabel: false,
    portKind,
    colorRole: portKind === "execution" ? "execution" : "number",
    shape: portKind === "execution" ? "execution" : "value",
    required: false,
    connected: false,
    acceptsLiteral: false,
    literalValue: undefined,
    literalEditor: { kind: "unsupported", reason: "typeUnsupported" },
    promotionKind: undefined,
  };
}

function dataPort(
  portId: string,
  labelKey: string,
  typeLabel: string,
  colorRole: CanvasPortView["colorRole"],
  shape: CanvasPortView["shape"] = "value",
): CanvasPortView {
  return {
    ...port(portId, "data"),
    labelKey,
    typeLabel,
    colorRole,
    shape,
  };
}

function clickPointData(
  inputMode: "point" | "coordinates" | "sequentialPoints",
): CanvasNodeData {
  return {
    graphId: "graph",
    nodeId: "click",
    typeKey: "automation.clickPoint",
    titleKey: "node.automation.clickPoint.title",
    displayAlias: undefined,
    iconKey: "node.click",
    category: "device",
    inputs: [],
    outputs: [],
    disabled: false,
    breakpoint: false,
    unresolved: false,
    propertyFields: [
      {
        propertyKey: "inputMode",
        labelKey: "node.automation.clickPoint.property.inputMode.label",
        descriptionKey:
          "node.automation.clickPoint.property.inputMode.description",
        required: true,
        defaultValue: "point",
        editor: {
          kind: "choice",
          choices: [
            {
              value: "point",
              labelKey:
                "node.automation.clickPoint.property.inputMode.option.point",
            },
            {
              value: "coordinates",
              labelKey:
                "node.automation.clickPoint.property.inputMode.option.coordinates",
            },
            {
              value: "sequentialPoints",
              labelKey:
                "node.automation.clickPoint.property.inputMode.option.sequentialPoints",
            },
          ],
        },
        value: inputMode,
      },
      {
        propertyKey: "intervalMilliseconds",
        labelKey:
          "node.automation.clickPoint.property.intervalMilliseconds.label",
        descriptionKey:
          "node.automation.clickPoint.property.intervalMilliseconds.description",
        required: false,
        defaultValue: 100,
        editor: {
          kind: "number",
          integer: true,
          minimum: 0,
          maximum: 60_000,
          unitKey: undefined,
        },
        value: 100,
      },
    ],
  };
}

type ReadValueMode = "text" | "number";
type ReadValueSelectionMode = "all" | "position";
type ReadValueFieldValue = string | number | boolean | undefined;

const readValueChoiceValues: Readonly<Record<string, readonly string[]>> = {
  valueMode: ["text", "number"],
  numberType: ["integer", "float", "percentage", "positive", "unsignedInteger"],
  selectionMode: ["all", "position"],
  readingOrder: ["rowMajor", "columnMajor"],
};

function readValueField(
  propertyKey: string,
  value: ReadValueFieldValue,
): NonNullable<CanvasNodeData["propertyFields"]>[number] {
  const choiceValues = readValueChoiceValues[propertyKey];
  const editor =
    choiceValues === undefined
      ? typeof value === "boolean"
        ? { kind: "boolean" as const }
        : {
            kind: "number" as const,
            integer: propertyKey === "lineIndex" || propertyKey === "itemIndex",
            minimum:
              propertyKey === "lineIndex" || propertyKey === "itemIndex"
                ? 1
                : undefined,
            maximum:
              propertyKey === "lineIndex" || propertyKey === "itemIndex"
                ? 256
                : undefined,
            unitKey: undefined,
          }
      : {
          kind: "choice" as const,
          choices: choiceValues.map((choice) => ({
            value: choice,
            labelKey: `node.text.readValue.property.${propertyKey}.option.${choice}`,
          })),
        };
  return {
    propertyKey,
    labelKey: `node.text.readValue.property.${propertyKey}.label`,
    descriptionKey: `node.text.readValue.property.${propertyKey}.description`,
    required: propertyKey !== "minimum" && propertyKey !== "maximum",
    defaultValue: value,
    editor,
    value,
  };
}

function readValueData(
  valueMode: ReadValueMode,
  selectionMode: ReadValueSelectionMode,
  overrides: Readonly<Record<string, ReadValueFieldValue>> = {},
): CanvasNodeData {
  const values: Record<string, ReadValueFieldValue> = {
    valueMode,
    numberType: "float",
    selectionMode,
    readingOrder: "rowMajor",
    lineIndex: 1,
    itemIndex: 1,
    decimalSeparator: ".",
    groupingSeparator: ",",
    normalizeFullWidth: false,
    allowSign: true,
    minimum: undefined,
    maximum: undefined,
    ...overrides,
  };
  return {
    graphId: "graph",
    nodeId: "read-value",
    typeKey: "text.readValue",
    titleKey: "node.text.readValue.title",
    displayAlias: undefined,
    iconKey: "node.compare",
    category: "text",
    inputs: [],
    outputs: [],
    disabled: false,
    breakpoint: false,
    unresolved: false,
    propertyFields: Object.entries(values).map(([propertyKey, value]) =>
      readValueField(propertyKey, value),
    ),
  };
}

function variableNodeData(
  valueKind: "number" | "imageRef",
  selectedVariableId: string | undefined,
  variableMissing = false,
): CanvasNodeData {
  const options =
    valueKind === "number"
      ? [
          {
            variableId: "10000000-0000-4000-8000-000000000001",
            name: "score",
            persistent: false,
          },
          {
            variableId: "10000000-0000-4000-8000-000000000002",
            name: "total",
            persistent: false,
          },
        ]
      : [
          {
            variableId: "10000000-0000-4000-8000-000000000003",
            name: "screen",
            persistent: false,
          },
        ];
  const selected = options.find(
    (option) => option.variableId === selectedVariableId,
  );
  return {
    graphId: "variable-graph",
    nodeId: "variable-node",
    typeKey:
      valueKind === "number"
        ? "core.variable.getNumber"
        : "core.variable.getImageRef",
    titleKey:
      valueKind === "number"
        ? "node.core.variable.getNumber.title"
        : "node.core.variable.getImageRef.title",
    displayAlias: undefined,
    iconKey: "node.variable",
    category: "values",
    inputs: [],
    outputs: [],
    disabled: false,
    breakpoint: false,
    unresolved: false,
    propertyFields: [],
    variableControl: {
      valueKind,
      selectedVariableId,
      selectedVariableName: selected?.name,
      selectedPersistent: selected?.persistent,
      options,
      canPersist: valueKind !== "imageRef",
      variableMissing,
    },
  };
}

describe("node port placement", () => {
  beforeEach(async () => {
    await applicationI18n.changeLanguage("zh-CN");
  });

  it("places execution ports above data ports", () => {
    const data: CanvasNodeData = {
      graphId: "graph",
      nodeId: "node",
      typeKey: "core.time.delay",
      titleKey: "node.core.time.delay.title",
      displayAlias: undefined,
      iconKey: "node.delay",
      category: "timing",
      inputs: [port("run", "execution"), port("durationMilliseconds", "data")],
      outputs: [port("next", "execution")],
      disabled: false,
      breakpoint: false,
      unresolved: false,
    };
    const nodeProps = { data, selected: false } as NodeProps<RinoFlowNode>;
    const { container } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView {...nodeProps} />
      </ReactFlowProvider>,
    );
    const execution = container.querySelector(
      '[data-port-section="execution"]',
    );
    const values = container.querySelector('[data-port-section="data"]');

    expect(execution).not.toBeNull();
    expect(values).not.toBeNull();
    expect(execution?.compareDocumentPosition(values as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("keeps wrapped names and connected anchors below 50 percent zoom", async () => {
    const data: CanvasNodeData = {
      graphId: "graph",
      nodeId: "node",
      typeKey: "core.time.delay",
      titleKey: "node.core.time.delay.title",
      titleOverride: "等待节点",
      displayAlias: "识别后等待",
      iconKey: "node.delay",
      category: "timing",
      inputs: [
        { ...port("run", "execution"), connected: true },
        port("durationMilliseconds", "data"),
      ],
      outputs: [{ ...port("next", "execution"), connected: true }],
      disabled: false,
      breakpoint: false,
      unresolved: false,
    };
    const nodeProps = { data, selected: false } as NodeProps<RinoFlowNode>;
    const { container } = renderNode(
      <ReactFlowProvider>
        <SetCanvasZoom zoom={0.4} />
        <RinoNodeView {...nodeProps} />
      </ReactFlowProvider>,
    );

    await waitFor(() => {
      expect(container.querySelector(".rino-node")).toHaveAttribute(
        "data-detail",
        "overview",
      );
    });
    const overviewNode = container.querySelector<HTMLElement>(".rino-node");
    expect(overviewNode?.style.minHeight).not.toBe("");
    expect(overviewNode?.style.height).toBe("");
    expect(screen.getByText("等待节点")).toBeInTheDocument();
    expect(screen.getByText("识别后等待")).toBeInTheDocument();
    expect(container.querySelector("[data-port-section]")).toBeNull();
    expect(
      container.querySelectorAll(".rino-node__overview-handle"),
    ).toHaveLength(2);
  });

  it("shows a description when a non-obvious port label is hovered", async () => {
    const user = userEvent.setup();
    const matched = {
      ...port("matched", "data"),
      labelKey: "node.vision.templateMatch.port.matched",
      typeLabel: "bool",
      showTypeLabel: true,
    };
    const data: CanvasNodeData = {
      graphId: "graph",
      nodeId: "node",
      typeKey: "vision.templateMatch",
      titleKey: "node.vision.templateMatch.title",
      displayAlias: undefined,
      iconKey: "recognition.template",
      category: "vision",
      inputs: [],
      outputs: [matched],
      disabled: false,
      breakpoint: false,
      unresolved: false,
    };

    renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    await user.hover(screen.getByText("是否匹配"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "找到至少一个达到当前阈值的匹配区域时为真",
    );
  });

  it("shows the add-step action for a sequence node", () => {
    const data: CanvasNodeData = {
      graphId: "graph",
      nodeId: "node",
      typeKey: "core.flow.sequence",
      titleKey: "node.core.flow.sequence.title",
      displayAlias: undefined,
      iconKey: "category.flow",
      category: "flow",
      inputs: [port("run", "execution")],
      outputs: [port("step1", "execution"), port("step2", "execution")],
      disabled: false,
      breakpoint: false,
      unresolved: false,
      sequenceControl: { stepCount: 2, canAdd: true },
    };

    renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByRole("button", { name: "添加步骤" })).toBeVisible();
  });

  it("places a collection output at the bottom and removes its last item", async () => {
    const user = userEvent.setup();
    const graphId = "20000000-0000-0000-0000-000000000020";
    const nodeId = "10000000-0000-0000-0000-000000000020";
    useDocumentStore.getState().openDocument({
      schemaVersion: 1,
      documentId: "30000000-0000-0000-0000-000000000020",
      metadata: {
        name: "Collection node",
        createdAt: "2026-08-16T00:00:00.000Z",
        updatedAt: "2026-08-16T00:00:00.000Z",
      },
      entryGraphId: graphId,
      graphs: [
        {
          graphId,
          name: "Main",
          kind: "entry",
          nodes: [
            {
              nodeId,
              typeKey: "core.collection.pointList",
              typeVersion: 1,
              position: { x: 0, y: 0 },
              properties: {},
              inputValues: {},
              dynamicPortState: { collectionItemCount: 2 },
            },
          ],
          edges: [],
        },
      ],
      assets: [],
      requiredCapabilities: [],
    });
    const item1 = { ...port("item1", "data"), typeLabel: "point" };
    const item2 = { ...port("item2", "data"), typeLabel: "point" };
    const points = {
      ...port("points", "data"),
      typeLabel: "point[]",
      shape: "collection" as const,
      colorRole: "spatial" as const,
      showTypeLabel: true,
    };
    const data: CanvasNodeData = {
      graphId,
      nodeId,
      typeKey: "core.collection.pointList",
      titleKey: "node.core.collection.pointList.title",
      displayAlias: undefined,
      iconKey: "node.coordinate",
      category: "values",
      inputs: [item1, item2],
      outputs: [points],
      disabled: false,
      breakpoint: false,
      unresolved: false,
      dynamicPortControl: {
        kind: "collectionItem",
        count: 2,
        canAdd: true,
      },
    };

    const { container } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    const collectionOutput = container.querySelector(
      ".rino-node__collection-outputs [data-port-id='points']",
    );
    expect(collectionOutput).not.toBeNull();
    expect(collectionOutput?.parentElement).toHaveClass(
      "rino-node__collection-outputs",
    );
    await user.click(screen.getByRole("button", { name: "删除第 2 项" }));

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0]
        ?.dynamicPortState,
    ).toEqual({ collectionItemCount: 1 });
  });

  it("renders repeat hints without handles and removes only the metadata", async () => {
    const user = userEvent.setup();
    const graphId = "20000000-0000-4000-8000-000000000010";
    const edgeId = "30000000-0000-4000-8000-000000000010";
    const hintId = "40000000-0000-4000-8000-000000000010";
    useDocumentStore.getState().openDocument({
      schemaVersion: 1,
      documentId: "50000000-0000-4000-8000-000000000010",
      metadata: {
        name: "Repeat hint",
        createdAt: "2026-08-16T00:00:00.000Z",
        updatedAt: "2026-08-16T00:00:00.000Z",
      },
      entryGraphId: graphId,
      graphs: [
        {
          graphId,
          name: "Main",
          kind: "entry",
          nodes: [
            {
              nodeId: "60000000-0000-4000-8000-000000000010",
              typeKey: "core.flow.start",
              typeVersion: 1,
              position: { x: 0, y: 0 },
              properties: {},
              inputValues: {},
            },
            {
              nodeId: "70000000-0000-4000-8000-000000000010",
              typeKey: "core.logic.branch",
              typeVersion: 1,
              position: { x: 200, y: 0 },
              properties: {},
              inputValues: {},
            },
          ],
          edges: [
            {
              edgeId,
              edgeKind: "execution",
              sourceNodeId: "60000000-0000-4000-8000-000000000010",
              sourcePortId: "next",
              targetNodeId: "70000000-0000-4000-8000-000000000010",
              targetPortId: "run",
            },
          ],
          editorMetadata: {
            repeatHints: [{ hintId, edgeId, position: { x: 120, y: 80 } }],
          },
        },
      ],
      assets: [],
      requiredCapabilities: [],
    });
    const data: CanvasNodeData = {
      graphId,
      nodeId: `editor-repeat-hint:${hintId}`,
      typeKey: "editor.repeatHint",
      titleKey: "graph.repeatHint.title",
      displayAlias: undefined,
      iconKey: "node.imageRecognition",
      category: "vision",
      inputs: [],
      outputs: [],
      disabled: false,
      breakpoint: false,
      unresolved: false,
      repeatHint: { hintId, edgeId },
    };

    const { container } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByText("重复执行")).toBeVisible();
    expect(screen.getByText("沿原连线返回并再次执行识别")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "移除重复执行提示" }),
    ).toBeVisible();
    expect(container.querySelector(".react-flow__handle")).toBeNull();

    await user.click(screen.getByRole("button", { name: "移除重复执行提示" }));

    const storedGraph = useDocumentStore
      .getState()
      .history?.document.graphs.find((graph) => graph.graphId === graphId);
    expect(storedGraph?.edges).toHaveLength(1);
    expect(storedGraph?.editorMetadata?.repeatHints).toBeUndefined();
  });

  it("renders the execution-order editor with stable labels and persists moves", async () => {
    const user = userEvent.setup();
    const graphId = "20000000-0000-4000-8000-000000000002";
    const nodeId = "10000000-0000-4000-8000-000000000002";
    const document: RinoProjectDocumentV1 = {
      schemaVersion: 1,
      documentId: "30000000-0000-4000-8000-000000000002",
      metadata: {
        name: "Execution order",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      entryGraphId: graphId,
      graphs: [
        {
          graphId,
          name: "Main",
          kind: "entry",
          nodes: [
            {
              nodeId,
              typeKey: "core.flow.sequenceOrder",
              typeVersion: 1,
              position: { x: 0, y: 0 },
              properties: {},
              inputValues: {},
              dynamicPortState: {
                sequenceStepCount: 3,
                sequenceOrder: ["step3", "step1", "step2"],
              },
            },
          ],
          edges: [],
        },
      ],
      assets: [],
      requiredCapabilities: [],
    };
    useDocumentStore.getState().openDocument(document);
    useEditorSessionStore.getState().setActiveGraph(undefined);

    const data: CanvasNodeData = {
      graphId,
      nodeId,
      typeKey: "core.flow.sequenceOrder",
      titleKey: "node.core.flow.sequenceOrder.title",
      displayAlias: undefined,
      iconKey: "category.flow",
      category: "flow",
      inputs: [],
      outputs: [port("order", "data")],
      disabled: false,
      breakpoint: false,
      unresolved: false,
      sequenceControl: {
        stepCount: 3,
        canAdd: true,
        order: ["step3", "step1", "step2"],
        kind: "sequenceOrder",
      },
    };

    const { container } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    expect(
      container.querySelector('[data-port-section="execution"]'),
    ).toBeNull();
    expect(screen.getByText("步骤 3")).toBeVisible();
    expect(screen.getByText("步骤 1")).toBeVisible();
    expect(screen.getByText("步骤 2")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "上移步骤 1（当前位置 2）",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "上移步骤 3（当前位置 1）",
      }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole("button", {
        name: "上移步骤 1（当前位置 2）",
      }),
    );

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0]
        ?.dynamicPortState,
    ).toEqual({
      sequenceStepCount: 3,
      sequenceOrder: ["step1", "step3", "step2"],
    });
  });

  it("shows stable move controls for legacy sequence fan-out steps", () => {
    const data: CanvasNodeData = {
      graphId: "graph",
      nodeId: "legacy-sequence",
      typeKey: "core.flow.sequence",
      titleKey: "node.core.flow.sequence.title",
      displayAlias: undefined,
      iconKey: "category.flow",
      category: "flow",
      inputs: [port("run", "execution")],
      outputs: [port("steps", "execution")],
      disabled: false,
      breakpoint: false,
      unresolved: false,
      sequenceControl: {
        stepCount: 2,
        canAdd: true,
        order: ["step1", "step2"],
        kind: "sequence",
        legacy: true,
      },
    };

    renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByText("步骤 1")).toBeVisible();
    expect(screen.getByText("步骤 2")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "下移步骤 1（当前位置 1）",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "上移步骤 1（当前位置 1）",
      }),
    ).toBeDisabled();
  });

  it("adds a sequence step to the graph that owns the rendered node", async () => {
    const user = userEvent.setup();
    const graphId = "20000000-0000-4000-8000-000000000001";
    const nodeId = "10000000-0000-4000-8000-000000000001";
    const document: RinoProjectDocumentV1 = {
      schemaVersion: 1,
      documentId: "30000000-0000-4000-8000-000000000001",
      metadata: {
        name: "Sequence steps",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      entryGraphId: graphId,
      graphs: [
        {
          graphId,
          name: "Main",
          kind: "entry",
          nodes: [
            {
              nodeId,
              typeKey: "core.flow.sequence",
              typeVersion: 1,
              position: { x: 0, y: 0 },
              properties: {},
              inputValues: {},
              dynamicPortState: { sequenceStepCount: 2 },
            },
          ],
          edges: [],
        },
      ],
      assets: [],
      requiredCapabilities: [],
    };
    useDocumentStore.getState().openDocument(document);
    useEditorSessionStore.getState().setActiveGraph(undefined);
    const data: CanvasNodeData = {
      graphId,
      nodeId,
      typeKey: "core.flow.sequence",
      titleKey: "node.core.flow.sequence.title",
      displayAlias: undefined,
      iconKey: "category.flow",
      category: "flow",
      inputs: [port("run", "execution")],
      outputs: [port("step1", "execution"), port("step2", "execution")],
      disabled: false,
      breakpoint: false,
      unresolved: false,
      sequenceControl: { stepCount: 2, canAdd: true },
    };

    renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );
    await user.click(screen.getByRole("button", { name: "添加步骤" }));

    const storedNode = useDocumentStore
      .getState()
      .history?.document.graphs.find((graph) => graph.graphId === graphId)
      ?.nodes.find((node) => node.nodeId === nodeId);
    expect(storedNode?.dynamicPortState).toEqual({
      sequenceStepCount: 3,
      sequenceOrder: ["step1", "step2", "step3"],
    });
  });

  it("shows click interval only for sequential points and picker only for coordinates", () => {
    const point = clickPointData("point");
    const { rerender } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data: point, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    expect(
      screen.queryByRole("textbox", { name: "点击间隔（毫秒）" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "从模拟器取值" })).toBeNull();

    rerender(
      <TooltipProvider>
        <ReactFlowProvider>
          <RinoNodeView
            {...({
              data: clickPointData("sequentialPoints"),
              selected: false,
            } as NodeProps<RinoFlowNode>)}
          />
        </ReactFlowProvider>
      </TooltipProvider>,
    );
    expect(
      screen.getByRole("textbox", { name: "点击间隔（毫秒）" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "从模拟器取值" })).toBeNull();

    rerender(
      <TooltipProvider>
        <ReactFlowProvider>
          <RinoNodeView
            {...({
              data: clickPointData("coordinates"),
              selected: false,
            } as NodeProps<RinoFlowNode>)}
          />
        </ReactFlowProvider>
      </TooltipProvider>,
    );
    expect(
      screen.queryByRole("textbox", { name: "点击间隔（毫秒）" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "从模拟器取值" })).toBeVisible();
  });

  it("labels a connected click input while hiding its fallback editor", () => {
    const connectedInput: CanvasPortView = {
      ...port("x", "data"),
      labelKey: "node.automation.clickPoint.port.x",
      required: true,
      acceptsLiteral: true,
      connected: true,
      literalValue: 120,
      literalEditor: {
        kind: "number",
        integer: true,
        minimum: 0,
        maximum: 16_384,
        unitKey: undefined,
      },
    };
    const data: CanvasNodeData = {
      graphId: "graph",
      nodeId: "click",
      typeKey: "automation.clickPoint",
      titleKey: "node.automation.clickPoint.title",
      displayAlias: undefined,
      iconKey: "node.click",
      category: "device",
      inputs: [connectedInput],
      outputs: [],
      disabled: false,
      breakpoint: false,
      unresolved: false,
    };

    renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    expect(screen.queryByRole("textbox", { name: /点击节点.*X/u })).toBeNull();
    expect(screen.getByText("连线提供")).toHaveAttribute(
      "title",
      "该输入由连线提供，内联值不会被使用。",
    );
  });

  it("places existing device pickers beside active recognition parameters", () => {
    const data: CanvasNodeData = {
      graphId: "graph",
      nodeId: "workflow-group:text",
      typeKey: "workflowGroup.textRecognition",
      titleKey: "workflowGroup.textRecognition.title",
      displayAlias: undefined,
      iconKey: "node.ocr",
      category: "vision",
      inputs: [],
      outputs: [],
      disabled: false,
      breakpoint: false,
      unresolved: false,
      workflowGroup: {
        groupId: "text-group",
        kind: "textRecognition",
        steps: [
          {
            role: "click",
            nodeId: "click",
            typeKey: "automation.clickPoint",
            titleKey: "node.automation.clickPoint.title",
            iconKey: "node.click",
          },
        ],
        textRecognitionParameters: {
          delayMilliseconds: 0,
          delayMode: "beforeRecognition",
          canDelayClick: true,
          confidenceThreshold: 0.8,
          region: {
            nodeId: "region",
            enabled: true,
            x: 10,
            y: 20,
            width: 300,
            height: 200,
            referenceWidth: 1080,
            referenceHeight: 1920,
          },
          clickPoint: {
            nodeId: "point",
            x: 100,
            y: 200,
            referenceWidth: 1080,
            referenceHeight: 1920,
          },
        },
      },
    };

    const { container, rerender } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    const regions = container.querySelectorAll(".rino-workflow-region");
    expect(regions).toHaveLength(2);
    expect(
      within(regions[0] as HTMLElement).getByRole("button", {
        name: "从画面选择",
      }),
    ).toBeVisible();
    expect(
      within(regions[1] as HTMLElement).getByRole("button", {
        name: "从画面选择",
      }),
    ).toBeVisible();

    const imageData: CanvasNodeData = {
      graphId: "graph",
      nodeId: "workflow-group:image",
      typeKey: "workflowGroup.imageRecognition",
      titleKey: "workflowGroup.imageRecognition.title",
      displayAlias: undefined,
      iconKey: "node.imageRecognition",
      category: "vision",
      inputs: [],
      outputs: [],
      disabled: false,
      breakpoint: false,
      unresolved: false,
      workflowGroup: {
        groupId: "image-group",
        kind: "imageRecognition",
        steps: [
          {
            role: "recognizer",
            nodeId: "recognizer",
            typeKey: "vision.templateMatch",
            titleKey: "node.vision.templateMatch.title",
            iconKey: "recognition.template",
          },
        ],
        imageRecognitionParameters: {
          delayMilliseconds: 0,
          delayMode: "beforeRecognition",
          canDelayClick: false,
          matchThreshold: 0.8,
          templateAssetNodeId: "asset",
          templateAssetId: undefined,
          roiNodeId: "region",
          regionEnabled: true,
          region: {
            x: 10,
            y: 20,
            width: 300,
            height: 200,
            referenceWidth: 1080,
            referenceHeight: 1920,
          },
        },
      },
    };
    rerender(
      <TooltipProvider>
        <ReactFlowProvider>
          <RinoNodeView
            {...({
              data: imageData,
              selected: false,
            } as NodeProps<RinoFlowNode>)}
          />
        </ReactFlowProvider>
      </TooltipProvider>,
    );
    const imageRegion = container.querySelector(".rino-workflow-region");
    expect(imageRegion).not.toBeNull();
    expect(
      within(imageRegion as HTMLElement).getByRole("button", {
        name: "从画面选择",
      }),
    ).toBeVisible();
  });

  it("shows only the read value properties for the selected modes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({
            data: readValueData("number", "position"),
            selected: false,
          } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByRole("combobox", { name: "读取内容" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "输出位置" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "读取顺序" })).toBeVisible();
    await user.click(screen.getByText("更多参数"));
    expect(screen.getByRole("combobox", { name: "数字类型" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "第几行" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "第几个" })).toBeVisible();

    rerender(
      <TooltipProvider>
        <ReactFlowProvider>
          <RinoNodeView
            {...({
              data: readValueData("text", "all"),
              selected: false,
            } as NodeProps<RinoFlowNode>)}
          />
        </ReactFlowProvider>
      </TooltipProvider>,
    );

    expect(screen.getByRole("combobox", { name: "读取内容" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "输出位置" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "读取顺序" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "数字类型" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "第几行" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "第几个" })).toBeNull();
  });

  it("restores hidden read value settings without resetting their values", async () => {
    const user = userEvent.setup();
    const { rerender } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({
            data: readValueData("number", "position", {
              numberType: "percentage",
              lineIndex: 7,
              itemIndex: 4,
            }),
            selected: false,
          } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );
    await user.click(screen.getByText("更多参数"));

    rerender(
      <TooltipProvider>
        <ReactFlowProvider>
          <RinoNodeView
            {...({
              data: readValueData("text", "all", {
                numberType: "percentage",
                lineIndex: 7,
                itemIndex: 4,
              }),
              selected: false,
            } as NodeProps<RinoFlowNode>)}
          />
        </ReactFlowProvider>
      </TooltipProvider>,
    );
    expect(screen.queryByRole("textbox", { name: "第几行" })).toBeNull();

    rerender(
      <TooltipProvider>
        <ReactFlowProvider>
          <RinoNodeView
            {...({
              data: readValueData("number", "position", {
                numberType: "percentage",
                lineIndex: 7,
                itemIndex: 4,
              }),
              selected: false,
            } as NodeProps<RinoFlowNode>)}
          />
        </ReactFlowProvider>
      </TooltipProvider>,
    );
    await user.click(screen.getByText("更多参数"));
    expect(screen.getByRole("textbox", { name: "第几行" })).toHaveValue("7");
    expect(screen.getByRole("textbox", { name: "第几个" })).toHaveValue("4");
    expect(
      screen.getByRole("combobox", { name: "数字类型" }),
    ).toHaveTextContent("百分比");
  });

  it("floats only aliases that exceed the node header budget", () => {
    expect(shouldFloatDisplayAlias("短备注")).toBe(false);
    expect(
      shouldFloatDisplayAlias("这是一个会超过节点标题宽度并显示在上方的备注"),
    ).toBe(true);
    expect(shouldFloatDisplayAlias("a concise ASCII note")).toBe(false);
  });

  it("keeps continuation outputs first and recognition actions beside result ports", () => {
    const data: CanvasNodeData = {
      graphId: "graph",
      nodeId: "workflow-group:image-recognition",
      typeKey: "workflowGroup.imageRecognition",
      titleKey: "workflowGroup.imageRecognition.title",
      displayAlias: undefined,
      iconKey: "node.imageRecognition",
      category: "vision",
      inputs: [port("run", "execution")],
      outputs: [
        port("noMatch", "execution"),
        port("next", "execution"),
        port("matched", "data"),
      ],
      disabled: false,
      breakpoint: false,
      unresolved: false,
      workflowGroup: {
        groupId: "image-recognition",
        kind: "imageRecognition",
        steps: [
          {
            role: "recognizer",
            nodeId: "recognizer",
            typeKey: "vision.templateMatch",
            titleKey: "node.vision.templateMatch.title",
            iconKey: "recognition.template",
          },
        ],
        imageRecognitionParameters: {
          delayMilliseconds: 0,
          delayMode: "beforeRecognition",
          canDelayClick: false,
          matchThreshold: 0.7,
          templateAssetNodeId: "template-asset",
          templateAssetId: undefined,
          roiNodeId: "roi",
          regionEnabled: false,
          region: {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            referenceWidth: 1,
            referenceHeight: 1,
          },
        },
      },
    };
    const { container } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );
    const execution = container.querySelector(
      '[data-port-section="execution"]',
    );
    const results = container.querySelector('[data-port-section="data"]');
    const body = container.querySelector(".rino-workflow-group__steps");
    const compactBody = container.querySelector(".rino-node__workflow-body");

    expect(execution).not.toBeNull();
    expect(results).not.toBeNull();
    expect(body).not.toBeNull();
    expect(compactBody).not.toBeNull();
    expect(compactBody).toContainElement(body as HTMLElement);
    expect(compactBody).toContainElement(results as HTMLElement);
    expect(execution?.compareDocumentPosition(results as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const executionOutputs = execution?.querySelector(
      ".rino-node__column--outputs",
    );
    expect(executionOutputs?.firstElementChild).toHaveAttribute(
      "data-port-id",
      "next",
    );
    expect(
      results?.querySelector(
        ".rino-node__column:not(.rino-node__column--outputs)",
      ),
    ).toBeNull();
    expect(body?.compareDocumentPosition(results as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      screen.getByRole("spinbutton", { name: "模板匹配阈值" }),
    ).toHaveValue(0.7);
  });

  it("stacks workflow parameters above localized two-column data ports", () => {
    const data: CanvasNodeData = {
      graphId: "graph",
      nodeId: "workflow-group:text-recognition-layout",
      typeKey: "workflowGroup.textRecognition",
      titleKey: "workflowGroup.textRecognition.title",
      displayAlias: undefined,
      iconKey: "node.ocr",
      category: "vision",
      inputs: [
        port("run", "execution"),
        dataPort(
          "regions",
          "workflowGroup.textRecognition.port.regions",
          "rect[]",
          "spatial",
          "collection",
        ),
      ],
      outputs: [
        port("next", "execution"),
        dataPort(
          "matched",
          "workflowGroup.textRecognition.port.matched",
          "bool",
          "boolean",
        ),
        dataPort(
          "matchValue",
          "workflowGroup.textRecognition.port.matchValue",
          "number",
          "number",
        ),
        dataPort(
          "image",
          "workflowGroup.textRecognition.port.image",
          "imageRef",
          "image",
        ),
      ],
      disabled: false,
      breakpoint: false,
      unresolved: false,
      workflowGroup: {
        groupId: "text-recognition-layout",
        kind: "textRecognition",
        steps: [
          {
            role: "recognizer",
            nodeId: "recognizer",
            typeKey: "vision.ocr",
            titleKey: "node.vision.ocr.title",
            iconKey: "recognition.text",
          },
        ],
        textRecognitionParameters: {
          delayMilliseconds: 0,
          delayMode: "beforeRecognition",
          canDelayClick: false,
          confidenceThreshold: 0.7,
          region: {
            nodeId: "region",
            enabled: true,
            x: 0,
            y: 0,
            width: 200,
            height: 100,
            referenceWidth: 1080,
            referenceHeight: 1920,
          },
        },
      },
    };

    const { container } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    const workflowBody = container.querySelector(".rino-node__workflow-body");
    const parameters = workflowBody?.querySelector(
      ".rino-workflow-group__steps",
    );
    const dataPorts = workflowBody?.querySelector('[data-port-section="data"]');
    const inputColumn = dataPorts?.querySelector(
      ".rino-node__column:not(.rino-node__column--outputs)",
    );
    const outputColumn = dataPorts?.querySelector(
      ".rino-node__column--outputs",
    );
    const executionOutputs = container.querySelector(
      '[data-port-section="execution"] .rino-node__column--outputs',
    );

    expect(workflowBody).not.toBeNull();
    expect(parameters).not.toBeNull();
    expect(dataPorts).not.toBeNull();
    expect(workflowBody?.firstElementChild).toBe(parameters);
    expect(workflowBody?.lastElementChild).toBe(dataPorts);
    expect(inputColumn).toContainElement(
      within(dataPorts as HTMLElement).getByText("多识别区域"),
    );
    expect(outputColumn).toContainElement(
      within(dataPorts as HTMLElement).getByText("是否识别"),
    );
    expect(outputColumn).toContainElement(
      within(dataPorts as HTMLElement).getByText("输出数值"),
    );
    expect(outputColumn).toContainElement(
      within(dataPorts as HTMLElement).getByText("当前画面"),
    );
    expect(container.textContent).not.toContain("[missing:");
    expect(executionOutputs?.firstElementChild).toHaveAttribute(
      "data-port-id",
      "next",
    );
  });

  it("edits an appended node alias from the title without replacing the node name", async () => {
    const user = userEvent.setup();
    const graphId = "f7f4f844-35c4-4750-b109-1df49231a279";
    const nodeId = "a8a729b6-91fb-47f1-b32b-2ae73983e679";
    const document: RinoProjectDocumentV1 = {
      schemaVersion: 1,
      documentId: "52c7b29b-674a-4d29-aa2d-c1a0d3d41f22",
      metadata: {
        name: "Alias editing",
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
      },
      entryGraphId: graphId,
      graphs: [
        {
          graphId,
          name: "Main",
          kind: "entry",
          nodes: [
            {
              nodeId,
              typeKey: "core.time.delay",
              typeVersion: 1,
              position: { x: 0, y: 0 },
              properties: {},
              inputValues: { durationMilliseconds: 500 },
            },
          ],
          edges: [],
        },
      ],
      assets: [],
      requiredCapabilities: [],
    };
    useDocumentStore.getState().openDocument(document);
    useEditorSessionStore.getState().setActiveGraph(graphId);
    const data: CanvasNodeData = {
      graphId,
      nodeId,
      typeKey: "core.time.delay",
      titleKey: "node.core.time.delay.title",
      displayAlias: undefined,
      iconKey: "node.delay",
      category: "timing",
      inputs: [],
      outputs: [],
      disabled: false,
      breakpoint: false,
      unresolved: false,
    };
    const view = (nextData: CanvasNodeData) => (
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data: nextData, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>
    );
    const { rerender } = renderNode(view(data));

    await user.dblClick(screen.getByRole("button", { name: /双击.*等待延迟/ }));
    const aliasInput = screen.getByRole("textbox", {
      name: "等待延迟 的备注名称",
    });
    await user.type(aliasInput, "登录后等待");
    await user.keyboard("{Enter}");

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0]
        ?.displayAlias,
    ).toBe("登录后等待");

    rerender(
      <TooltipProvider>
        {view({ ...data, displayAlias: "登录后等待" })}
      </TooltipProvider>,
    );
    const originalTitle = screen.getByText("等待延迟");
    const visibleAlias = screen.getByText("登录后等待");
    expect(originalTitle).toBeVisible();
    expect(visibleAlias).toBeVisible();
    expect(originalTitle.parentElement).toContainElement(visibleAlias);

    const groupedData: CanvasNodeData = {
      ...data,
      nodeId: "workflow-group:text-recognition",
      typeKey: "workflowGroup.textRecognition",
      titleKey: "workflowGroup.textRecognition.title",
      displayAlias: "登录后等待",
      workflowGroup: {
        groupId: "text-recognition",
        kind: "textRecognition",
        steps: [
          {
            role: "capture",
            nodeId,
            typeKey: "core.time.delay",
            titleKey: "node.core.time.delay.title",
            iconKey: "node.delay",
          },
        ],
      },
    };
    rerender(<TooltipProvider>{view(groupedData)}</TooltipProvider>);
    await user.dblClick(screen.getByRole("button", { name: /双击.*文字识别/ }));
    const groupedAliasInput = screen.getByRole("textbox", {
      name: "文字识别模板 的备注名称",
    });
    await user.clear(groupedAliasInput);
    await user.type(groupedAliasInput, "主界面识别");
    await user.keyboard("{Enter}");

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0]
        ?.displayAlias,
    ).toBe("主界面识别");

    rerender(
      <TooltipProvider>
        {view({ ...groupedData, displayAlias: "主界面识别" })}
      </TooltipProvider>,
    );
    await user.dblClick(screen.getByRole("button", { name: /双击.*文字识别/ }));
    await user.clear(
      screen.getByRole("textbox", { name: "文字识别模板 的备注名称" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "文字识别模板 的备注名称" }),
      "不应保存",
    );
    await user.keyboard("{Escape}");

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0]
        ?.displayAlias,
    ).toBe("主界面识别");
  });

  it("changes a touch action type from the control inside the node", async () => {
    const user = userEvent.setup();
    const graphId = "89d7d0e1-5a91-47d8-b969-65f95a5b36dc";
    const nodeId = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
    const document: RinoProjectDocumentV1 = {
      schemaVersion: 1,
      documentId: "80a43598-f806-477e-840c-345ce1ef1578",
      metadata: {
        name: "Touch action",
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
      },
      entryGraphId: graphId,
      graphs: [
        {
          graphId,
          name: "Main",
          kind: "entry",
          nodes: [
            {
              nodeId,
              typeKey: "automation.touchAction",
              typeVersion: 1,
              position: { x: 0, y: 0 },
              properties: {
                actionType: "click",
                longPressDurationMilliseconds: 1_000,
                swipeDurationMilliseconds: 200,
                secondaryStartDelayMilliseconds: 0,
              },
              inputValues: {},
            },
          ],
          edges: [],
        },
      ],
      assets: [],
      requiredCapabilities: ["automation.touchAction"],
    };
    useDocumentStore.getState().openDocument(document);
    useEditorSessionStore.getState().setActiveGraph(graphId);
    const data: CanvasNodeData = {
      graphId,
      nodeId,
      typeKey: "automation.touchAction",
      titleKey: "node.automation.touchAction.title",
      displayAlias: undefined,
      iconKey: "node.touchAction",
      category: "device",
      inputs: [],
      outputs: [],
      disabled: false,
      breakpoint: false,
      unresolved: false,
    };

    renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({ data, selected: false } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );
    await user.click(screen.getByRole("combobox", { name: "动作类型" }));
    await user.click(screen.getByRole("option", { name: "滑动" }));

    const storedNode =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0];
    expect(storedNode?.properties["actionType"]).toBe("swipe");
    expect(screen.getByText("连接起点和终点，并设置滑动时长。")).toBeVisible();
  });

  it("edits a typed variable binding, name, persistence, and creates same-kind variables", async () => {
    const user = userEvent.setup();
    useDocumentStore.getState().openDocument({
      schemaVersion: 1,
      documentId: "30000000-0000-4000-8000-000000000001",
      metadata: {
        name: "Variables",
        createdAt: "2026-08-16T00:00:00.000Z",
        updatedAt: "2026-08-16T00:00:00.000Z",
      },
      entryGraphId: "variable-graph",
      graphs: [
        {
          graphId: "variable-graph",
          name: "Main",
          kind: "entry",
          nodes: [
            {
              nodeId: "variable-node",
              typeKey: "core.variable.getNumber",
              typeVersion: 1,
              position: { x: 0, y: 0 },
              properties: {
                variableId: "10000000-0000-4000-8000-000000000001",
              },
              inputValues: {},
            },
          ],
          edges: [],
          variables: [
            {
              variableId: "10000000-0000-4000-8000-000000000001",
              name: "score",
              valueKind: "number",
              persistent: false,
            },
            {
              variableId: "10000000-0000-4000-8000-000000000002",
              name: "total",
              valueKind: "number",
              persistent: false,
            },
          ],
        },
      ],
      assets: [],
      requiredCapabilities: [],
    });
    useEditorSessionStore.getState().setActiveGraph("variable-graph");

    const { rerender } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({
            data: variableNodeData(
              "number",
              "10000000-0000-4000-8000-000000000001",
            ),
            selected: false,
          } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByRole("combobox", { name: "变量" })).toHaveTextContent(
      "score",
    );
    expect(screen.getByRole("textbox", { name: "变量名称" })).toHaveValue(
      "score",
    );
    expect(
      screen.getByRole("checkbox", { name: "跨任务运行永久保存" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "新建同类型变量" }),
    ).toBeVisible();

    await user.click(screen.getByRole("combobox", { name: "变量" }));
    await user.click(screen.getByRole("option", { name: "total" }));
    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0]
        ?.properties["variableId"],
    ).toBe("10000000-0000-4000-8000-000000000002");

    rerender(
      <TooltipProvider>
        <ReactFlowProvider>
          <RinoNodeView
            {...({
              data: variableNodeData(
                "number",
                "10000000-0000-4000-8000-000000000002",
              ),
              selected: false,
            } as NodeProps<RinoFlowNode>)}
          />
        </ReactFlowProvider>
      </TooltipProvider>,
    );

    const nameInput = screen.getByRole("textbox", { name: "变量名称" });
    await user.clear(nameInput);
    await user.type(nameInput, "totalScore");
    await user.keyboard("{Enter}");
    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.variables?.[1]
        ?.name,
    ).toBe("totalScore");

    await user.click(
      screen.getByRole("checkbox", { name: "跨任务运行永久保存" }),
    );
    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.variables?.[1]
        ?.persistent,
    ).toBe(true);
  });

  it("shows a recoverable missing binding and hides persistence for image variables", () => {
    const { rerender } = renderNode(
      <ReactFlowProvider>
        <RinoNodeView
          {...({
            data: variableNodeData("number", "missing", true),
            selected: false,
          } as NodeProps<RinoFlowNode>)}
        />
      </ReactFlowProvider>,
    );
    expect(screen.getByText("变量不存在")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "新建同类型变量" }),
    ).toBeVisible();

    rerender(
      <TooltipProvider>
        <ReactFlowProvider>
          <RinoNodeView
            {...({
              data: variableNodeData(
                "imageRef",
                "10000000-0000-4000-8000-000000000003",
              ),
              selected: false,
            } as NodeProps<RinoFlowNode>)}
          />
        </ReactFlowProvider>
      </TooltipProvider>,
    );
    expect(
      screen.queryByRole("checkbox", { name: "跨任务运行永久保存" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "新建同类型变量" }),
    ).toHaveAttribute("title", "新建同类型变量");
  });
});
