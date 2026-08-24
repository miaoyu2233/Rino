import type { NodeV1 } from "@rino/contracts";
import type { NodeChange } from "@xyflow/react";
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../app/App";
import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import { useRegistryStore } from "../registry/registry-store";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../store/project-lifecycle";
import { useConnectionDragStore } from "./connection-drag-store";
import {
  NODE_TYPE_DRAG_FORMAT,
  VARIABLE_DRAG_FORMAT,
  clearDragPayload,
  writeDragPayload,
} from "./canvas-drag";
import { canonicalExecutionInput } from "./smart-connection";
import {
  alignPositionChanges,
  applyTransientNodeChanges,
  nodeRectangle,
} from "./graph-canvas-helpers";
import {
  GraphProjection,
  NODE_WIDTH,
  type RinoFlowNode,
} from "./graph-view-model";
import { snapToGrid } from "./canvas-geometry";
import {
  hasNodeOverlap,
  type NodeOverlapLayoutNode,
} from "./node-overlap-layout";
import { estimateNodeHeight } from "./node-layout-size";
import { useLayoutPreferenceStore } from "../../preferences/layout-preference-store";

import {
  canvasPerformanceProfiles,
  defaultLayoutPreferences,
} from "../../preferences/layout-preferences";
import {
  createProjectFromEmptyState,
  installInMemoryProjectService,
} from "../../test/project-transport-double";

const START = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const COMPARE = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";
const BRANCH = "6a5c9b8f-a3b4-4fc0-9be3-5d6e7f809102";
const OCR = "9a8b7c6d-5e4f-4382-9170-8f7e6d5c4b3a";
const FUNCTION_GRAPH = "7b6c5d4e-3f2a-4190-8e7d-6c5b4a3f2e1d";
const VARIABLE_ID = "8c7d6e5f-4a3b-4291-9f8e-7d6c5b4a3f2e";
const EFFICIENCY_VISIBLE_ELEMENT_THRESHOLD =
  canvasPerformanceProfiles.efficiency.visibleElementThreshold;

function createTransferStub(exposeTypes = true) {
  const values = new Map<string, string>();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    get types() {
      return exposeTypes ? [...values.keys()] : [];
    },
    setData(format: string, value: string) {
      values.set(format, value);
    },
    getData(format: string) {
      return values.get(format) ?? "";
    },
    setDragImage() {
      return;
    },
  };
}

function setCanvasBounds(surface: HTMLElement): void {
  Object.defineProperty(surface, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 548,
      height: 500,
      left: 320,
      right: 1120,
      top: 48,
      width: 800,
      x: 320,
      y: 48,
      toJSON: () => ({}),
    }),
  });
}

function startNode(): NodeV1 {
  return {
    nodeId: START,
    typeKey: "core.flow.start",
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
  };
}

function compareNode(): NodeV1 {
  return {
    nodeId: COMPARE,
    typeKey: "core.logic.numberCompare",
    typeVersion: 1,
    position: { x: 240, y: 120 },
    properties: { operator: "greaterThan" },
    inputValues: { right: 100 },
  };
}

function plainNode(nodeId: string, typeKey: string): NodeV1 {
  return {
    nodeId,
    typeKey,
    typeVersion: 1,
    position: { x: 120, y: 40 },
    properties: {},
    inputValues: {},
  };
}

function activeGraphId(): string {
  const graphId = useEditorSessionStore.getState().activeGraphId;
  if (graphId === undefined) {
    throw new Error("A project must be open.");
  }
  return graphId;
}

function addNode(node: NodeV1): void {
  const outcome = useDocumentStore
    .getState()
    .runCommand("graph.history.insertNode", {
      kind: "addNode",
      graphId: activeGraphId(),
      node,
    });
  if (!outcome.ok) {
    throw new Error(`The node should have been added: ${outcome.reason}`);
  }
}

function denseNodes(count: number): NodeV1[] {
  return Array.from({ length: count }, (_, index) =>
    plainNode(
      `70000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
      "core.logic.branch",
    ),
  );
}

function replaceActiveGraphNodes(nodes: readonly NodeV1[]): void {
  const document = useDocumentStore.getState().history?.document;
  const graph = document?.graphs[0];
  if (document === undefined || graph === undefined) {
    throw new Error("A project must be open.");
  }
  openProjectDocument({
    ...document,
    graphs: document.graphs.map((candidate) =>
      candidate.graphId === graph.graphId
        ? { ...candidate, nodes: [...nodes] }
        : candidate,
    ),
  });
}

function projectedGraphRectangles(): NodeOverlapLayoutNode[] {
  const document = useDocumentStore.getState().history?.document;
  const graph = document?.graphs[0];
  const registry = useRegistryStore.getState().snapshot;
  if (graph === undefined || registry === undefined) {
    throw new Error("The project graph and registry must be available.");
  }
  const nodes = new GraphProjection().projectNodes(graph, registry);
  return nodes.map((node) => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: NODE_WIDTH,
    height: estimateNodeHeight(node.data),
  }));
}

function overlapCommandCount(): number {
  return (
    useDocumentStore
      .getState()
      .history?.undoable.filter(
        (entry) => entry.label === "graph.history.resolveNodeOverlaps",
      ).length ?? 0
  );
}

describe("graph canvas", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    closeProjectDocument();
    clearDragPayload();
    installInMemoryProjectService();
    useConnectionDragStore.getState().endDrag();
    useLayoutPreferenceStore
      .getState()
      .replaceLayout({ ...defaultLayoutPreferences });
  });

  it("offers to create a project and then shows the graph surface", async () => {
    render(<App />);

    expect(screen.getByText("从一个项目开始")).toBeInTheDocument();

    await createProjectFromEmptyState();

    expect(screen.getByLabelText("节点图")).toBeInTheDocument();
    expect(useDocumentStore.getState().history).toBeDefined();
  });

  it("renders a node with its localized title, ports, and inline value", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    addNode(compareNode());

    // Scoped to the canvas: the problems panel names the same node and ports when it
    // reports what the graph is still missing.
    const canvas = within(screen.getByLabelText("节点图"));
    expect(await canvas.findByText("数值比较")).toBeInTheDocument();
    expect(canvas.getByText("左值")).toBeInTheDocument();
    expect(canvas.getByText("右值")).toBeInTheDocument();
    expect(canvas.getByText("结果")).toBeInTheDocument();
    // The unconnected literal input is an editable field holding the value that will be
    // used at run time.
    expect(canvas.getByDisplayValue("100")).toBeInTheDocument();
  });

  it("enters a function graph when its call node is double-clicked", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    const opened = useDocumentStore.getState().history?.document;
    const entryGraph = opened?.graphs[0];
    if (opened === undefined || entryGraph === undefined) {
      throw new Error("The project graph must be available.");
    }
    const functionGraphId = "function-graph";
    const functionGraph: typeof entryGraph = {
      graphId: functionGraphId,
      name: "评分函数",
      kind: "function",
      functionSignature: {
        inputs: [],
        outputs: [],
      },
      nodes: [],
      edges: [],
    };
    openProjectDocument({
      ...opened,
      graphs: [
        {
          ...entryGraph,
          nodes: [plainNode("function-call", "core.function.call")].map(
            (node) => ({
              ...node,
              properties: { functionGraphId },
            }),
          ),
        },
        functionGraph,
      ],
      entryGraphId: entryGraph.graphId,
    });

    const canvas = screen.getByLabelText("节点图");
    const callNode = await waitFor(() => {
      const node = canvas.querySelector<HTMLElement>(
        '[data-type-key="core.function.call"]',
      );
      if (node === null) {
        throw new Error("The function call node is not projected yet.");
      }
      return node;
    });
    fireEvent.doubleClick(callNode);

    await waitFor(() => {
      expect(useEditorSessionStore.getState().activeGraphId).toBe(
        functionGraphId,
      );
      expect(useEditorSessionStore.getState().graphNavigationStack).toEqual([
        entryGraph.graphId,
      ]);
    });
  });

  it("does not navigate into a function while execution is locked", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    const opened = useDocumentStore.getState().history?.document;
    const entryGraph = opened?.graphs[0];
    if (opened === undefined || entryGraph === undefined) {
      throw new Error("The project graph must be available.");
    }
    const functionGraphId = "locked-function-graph";
    openProjectDocument({
      ...opened,
      graphs: [
        {
          ...entryGraph,
          nodes: [
            {
              ...plainNode("locked-function-call", "core.function.call"),
              properties: { functionGraphId },
            },
          ],
        },
        {
          ...entryGraph,
          graphId: functionGraphId,
          name: "Locked function",
          kind: "function",
          functionSignature: { inputs: [], outputs: [] },
          nodes: [],
          edges: [],
        },
      ],
      entryGraphId: entryGraph.graphId,
    });
    useDocumentStore.getState().setExecutionLocked(true);

    const canvas = screen.getByLabelText("节点图");
    const callNode = await waitFor(() => {
      const node = canvas.querySelector<HTMLElement>(
        '[data-type-key="core.function.call"]',
      );
      if (node === null) {
        throw new Error("The function call node is not projected yet.");
      }
      return node;
    });
    fireEvent.doubleClick(callNode);

    expect(useEditorSessionStore.getState().activeGraphId).toBe(
      entryGraph.graphId,
    );
  });

  it("creates a start node when it is dragged from the palette onto the canvas", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();

    await user.click(screen.getByRole("button", { name: "打开节点库" }));
    const palette = screen.getByRole("complementary", { name: "节点库" });
    const paletteItem = within(palette).getByText("开始").closest("button");
    const surface = screen.getByLabelText("节点图编辑区");
    if (paletteItem === null) {
      throw new Error("The start palette item must be a button.");
    }
    Object.defineProperty(surface, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 548,
        height: 500,
        left: 320,
        right: 1120,
        top: 48,
        width: 800,
        x: 320,
        y: 48,
        toJSON: () => ({}),
      }),
    });
    // WebView2 can retain custom data while omitting its MIME type from `types` during
    // the same-window drag. The in-process drag session must preserve that insertion.
    const dataTransfer = createTransferStub(false);

    fireEvent.dragStart(paletteItem, { dataTransfer });
    expect(dataTransfer.getData(NODE_TYPE_DRAG_FORMAT)).toBe("core.flow.start");
    fireEvent.dragOver(surface, {
      clientX: 720,
      clientY: 280,
      dataTransfer,
    });
    fireEvent.drop(surface, {
      clientX: 720,
      clientY: 280,
      dataTransfer,
    });

    const nodes =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes ?? [];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.typeKey).toBe("core.flow.start");
    expect(nodes[0]?.position).toEqual({ x: 288, y: 232 });
    expect(
      await within(screen.getByLabelText("节点图")).findByText("开始"),
    ).toBeInTheDocument();
  });

  it("inserts a function call at the snapped drop position", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    const opened = useDocumentStore.getState().history?.document;
    const entryGraph = opened?.graphs[0];
    if (opened === undefined || entryGraph === undefined) {
      throw new Error("The project graph must be available.");
    }
    openProjectDocument({
      ...opened,
      graphs: [
        entryGraph,
        {
          ...entryGraph,
          graphId: FUNCTION_GRAPH,
          name: "评分函数",
          kind: "function",
          functionSignature: { inputs: [], outputs: [] },
          nodes: [],
          edges: [],
        },
      ],
    });

    const surface = screen.getByLabelText("节点图编辑区");
    setCanvasBounds(surface);
    const dataTransfer = createTransferStub();
    writeDragPayload(dataTransfer, {
      kind: "function",
      functionGraphId: FUNCTION_GRAPH,
    });

    fireEvent.drop(surface, {
      clientX: 720,
      clientY: 280,
      dataTransfer,
    });

    const nodes =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes ?? [];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      typeKey: "core.function.call",
      position: { x: 288, y: 232 },
      properties: { functionGraphId: FUNCTION_GRAPH },
    });
  });

  it("opens a variable role menu and inserts the selected role at the drop position", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    const opened = useDocumentStore.getState().history?.document;
    if (opened === undefined) {
      throw new Error("The project document must be available.");
    }
    openProjectDocument({
      ...opened,
      variables: [
        {
          variableId: VARIABLE_ID,
          name: "score",
          valueKind: "number",
          persistent: false,
        },
      ],
    });

    const surface = screen.getByLabelText("节点图编辑区");
    setCanvasBounds(surface);
    const firstTransfer = createTransferStub();
    writeDragPayload(firstTransfer, {
      kind: "variable",
      variableId: VARIABLE_ID,
    });
    fireEvent.drop(surface, {
      clientX: 720,
      clientY: 280,
      dataTransfer: firstTransfer,
    });

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes,
    ).toHaveLength(0);
    const firstMenu = await screen.findByRole("menu", {
      name: "选择变量节点",
    });
    fireEvent.click(
      within(firstMenu).getByRole("menuitem", { name: "插入获取变量" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("menu", { name: "选择变量节点" }),
      ).not.toBeInTheDocument();
      expect(
        useDocumentStore.getState().history?.document.graphs[0]?.nodes,
      ).toHaveLength(1);
    });

    const secondTransfer = createTransferStub();
    writeDragPayload(secondTransfer, {
      kind: "variable",
      variableId: VARIABLE_ID,
    });
    const secondDrop = createEvent.drop(surface, {
      dataTransfer: secondTransfer,
    });
    Object.defineProperties(secondDrop, {
      clientX: { configurable: true, value: 1050 },
      clientY: { configurable: true, value: 400 },
    });
    fireEvent(surface, secondDrop);
    const secondMenu = await screen.findByRole("menu", {
      name: "选择变量节点",
    });
    fireEvent.click(
      within(secondMenu).getByRole("menuitem", { name: "插入设置变量" }),
    );

    const nodes =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes ?? [];
    expect(nodes).toHaveLength(2);
    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          typeKey: "core.variable.getNumber",
          position: { x: 288, y: 232 },
          properties: { variableId: VARIABLE_ID },
        }),
        expect.objectContaining({
          typeKey: "core.variable.setNumber",
          position: { x: 624, y: 336 },
          properties: { variableId: VARIABLE_ID },
        }),
      ]),
    );
  });

  it("closes a variable drop menu with Escape and rejects a deleted variable", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    const opened = useDocumentStore.getState().history?.document;
    if (opened === undefined) {
      throw new Error("The project document must be available.");
    }
    openProjectDocument({
      ...opened,
      variables: [
        {
          variableId: VARIABLE_ID,
          name: "score",
          valueKind: "number",
          persistent: false,
        },
      ],
    });

    const surface = screen.getByLabelText("节点图编辑区");
    setCanvasBounds(surface);
    const transfer = createTransferStub();
    writeDragPayload(transfer, {
      kind: "variable",
      variableId: VARIABLE_ID,
    });
    fireEvent.drop(surface, {
      clientX: 720,
      clientY: 280,
      dataTransfer: transfer,
    });
    const menu = await screen.findByRole("menu", {
      name: "选择变量节点",
    });
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(
      screen.queryByRole("menu", { name: "选择变量节点" }),
    ).not.toBeInTheDocument();

    const invalidTransfer = createTransferStub();
    invalidTransfer.setData(
      VARIABLE_DRAG_FORMAT,
      JSON.stringify({
        kind: "variable",
        variableId: FUNCTION_GRAPH,
      }),
    );
    fireEvent.drop(surface, {
      clientX: 720,
      clientY: 280,
      dataTransfer: invalidTransfer,
    });
    expect(
      screen.queryByRole("menu", { name: "选择变量节点" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("无法将变量节点插入当前图。"),
    ).toBeInTheDocument();
    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes,
    ).toHaveLength(0);
  });

  it("centres a drop whose desktop event omits pointer coordinates", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();

    await user.click(screen.getByRole("button", { name: "打开节点库" }));
    const palette = screen.getByRole("complementary", { name: "节点库" });
    const paletteItem = within(palette).getByText("开始").closest("button");
    const surface = screen.getByLabelText("节点图编辑区");
    if (paletteItem === null) {
      throw new Error("The start palette item must be a button.");
    }
    Object.defineProperty(surface, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 548,
        height: 500,
        left: 320,
        right: 1120,
        top: 48,
        width: 800,
        x: 320,
        y: 48,
        toJSON: () => ({}),
      }),
    });
    const dataTransfer = createTransferStub(false);

    fireEvent.dragStart(paletteItem, { dataTransfer });
    fireEvent.drop(surface, { clientX: 0, clientY: 0, dataTransfer });

    const node =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0];
    expect(node?.position).toEqual({ x: 288, y: 232 });
  });

  it("keeps a non-grid row on release and undoes it as one move", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode({ ...startNode(), position: { x: 0, y: 143 } });
    addNode({
      ...plainNode(BRANCH, "core.logic.branch"),
      position: { x: 260, y: 150 },
    });

    const graph = useDocumentStore.getState().history?.document.graphs[0];
    const registry = useRegistryStore.getState().snapshot;
    if (graph === undefined || registry === undefined) {
      throw new Error("The graph and registry should be available.");
    }
    const projectedNodes = new GraphProjection().projectNodes(graph, registry);
    const rawRelease: NodeChange<RinoFlowNode> = {
      id: START,
      type: "position",
      dragging: false,
      position: { x: 16, y: 143 },
    };
    const aligned = alignPositionChanges(
      [{ ...rawRelease, position: snapToGrid({ x: 16, y: 143 }) }],
      projectedNodes,
      1,
    );
    const alignedPosition = aligned[0];
    if (
      alignedPosition?.type !== "position" ||
      alignedPosition.position === undefined
    ) {
      throw new Error("The release position should be aligned.");
    }
    expect(alignedPosition.position).toEqual({ x: 16, y: 150 });

    const outcome = useDocumentStore
      .getState()
      .runCommand("graph.history.moveNode", {
        kind: "moveNode",
        graphId: graph.graphId,
        nodeId: START,
        position: alignedPosition.position,
      });
    if (!outcome.ok) {
      throw new Error("The aligned move should be accepted.");
    }
    expect(
      useDocumentStore
        .getState()
        .history?.document.graphs[0]?.nodes.find(
          (node) => node.nodeId === START,
        )?.position,
    ).toEqual({ x: 16, y: 150 });

    useDocumentStore.getState().undoChange();
    expect(
      useDocumentStore
        .getState()
        .history?.document.graphs[0]?.nodes.find(
          (node) => node.nodeId === START,
        )?.position,
    ).toEqual({ x: 0, y: 143 });
  });

  it("does not align a node while its drag is still in progress", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode({ ...startNode(), position: { x: 0, y: 143 } });
    addNode({
      ...plainNode(BRANCH, "core.logic.branch"),
      position: { x: 260, y: 150 },
    });

    const graph = useDocumentStore.getState().history?.document.graphs[0];
    const registry = useRegistryStore.getState().snapshot;
    if (graph === undefined || registry === undefined) {
      throw new Error("The graph and registry should be available.");
    }
    const projectedNodes = new GraphProjection().projectNodes(graph, registry);
    const dragging: NodeChange<RinoFlowNode> = {
      id: BRANCH,
      type: "position",
      dragging: true,
      position: { x: 276, y: 143 },
    };
    const release: NodeChange<RinoFlowNode> = {
      id: START,
      type: "position",
      dragging: false,
      position: { x: 16, y: 143 },
    };

    const aligned = alignPositionChanges(
      [dragging, release],
      projectedNodes,
      1,
    );
    const alignedDragging = aligned[0];
    const alignedRelease = aligned[1];

    expect(alignedDragging).toBe(dragging);
    if (alignedDragging?.type !== "position") {
      throw new Error("The dragging change should remain a position change.");
    }
    expect(alignedDragging.position).toEqual({ x: 276, y: 143 });
    if (alignedRelease?.type !== "position") {
      throw new Error("The release change should remain a position change.");
    }
    expect(alignedRelease.position).toEqual({ x: 16, y: 150 });
  });

  it("flushes consecutive transient drag batches through the internal sink", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(startNode());

    const graph = useDocumentStore.getState().history?.document.graphs[0];
    const registry = useRegistryStore.getState().snapshot;
    if (graph === undefined || registry === undefined) {
      throw new Error("The graph and registry should be available.");
    }
    let internalNodes = new GraphProjection().projectNodes(graph, registry);
    let internalFlushes = 0;
    const outerRenders = 0;
    const flush = (change: NodeChange<RinoFlowNode>) => {
      internalNodes = applyTransientNodeChanges(
        [change],
        internalNodes,
        (nextNodes) => {
          internalNodes = nextNodes;
          internalFlushes += 1;
        },
      );
    };

    flush({
      id: START,
      type: "position",
      dragging: true,
      position: { x: 16, y: 32 },
    });
    flush({
      id: START,
      type: "position",
      dragging: true,
      position: { x: 32, y: 48 },
    });

    expect(internalFlushes).toBe(2);
    expect(outerRenders).toBe(0);
    expect(internalNodes[0]?.position).toEqual({ x: 32, y: 48 });
  });

  it("names every port for assistive technology, including its type", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    addNode(startNode());

    expect(
      await screen.findByLabelText("开始 的输出端口 下一步，类型 执行"),
    ).toBeInTheDocument();
  });

  it("writes the type beside a port whose colour covers a family of types", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    addNode(plainNode(OCR, "vision.ocr"));

    // The structured OCR result has no dedicated colour, so the port states its type in
    // writing as well, using product language rather than the protocol identifier.
    expect(await screen.findByText("识别结果")).toBeInTheDocument();
    expect(screen.getAllByText("识别结果")).toHaveLength(1);
    expect(screen.queryByText("ocrResult")).not.toBeInTheDocument();
    // A boolean output has a colour of its own and stays uncluttered.
    expect(screen.queryByText("bool")).not.toBeInTheDocument();
  });

  it("marks the ports a connection being dragged may land on", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(startNode());
    addNode(plainNode(BRANCH, "core.logic.branch"));

    const graph = useDocumentStore.getState().history?.document.graphs[0];
    const registry = useRegistryStore.getState().snapshot;
    if (!graph || !registry) {
      throw new Error("A project and a registry must be available.");
    }
    act(() => {
      useConnectionDragStore.getState().beginDrag(graph, registry, {
        nodeId: START,
        portId: "next",
        handleType: "source",
      });
    });

    const executionInput = await screen.findByLabelText(
      "判断分支 的输入端口 执行，类型 执行",
    );
    const dataInput = screen.getByLabelText(
      "判断分支 的输入端口 条件，类型 布尔",
    );
    expect(executionInput.closest(".rino-port")).toHaveAttribute(
      "data-connection",
      "compatible",
    );
    expect(dataInput.closest(".rino-port")).not.toHaveAttribute(
      "data-connection",
    );

    act(() => {
      useConnectionDragStore.getState().endDrag();
    });

    expect(executionInput.closest(".rino-port")).not.toHaveAttribute(
      "data-connection",
    );
  });

  it("resolves a node body to its single execution input for loopback drops", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(plainNode(BRANCH, "core.logic.branch"));
    const graph = useDocumentStore.getState().history?.document.graphs[0];
    const registry = useRegistryStore.getState().snapshot;

    if (graph === undefined || registry === undefined) {
      throw new Error("The open project and registry must be available.");
    }
    expect(canonicalExecutionInput(graph, registry, BRANCH)).toEqual({
      nodeId: BRANCH,
      portId: "run",
    });
  });

  it("deletes the selection through an undoable command", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(startNode());
    useEditorSessionStore.getState().setSelection([START], []);

    fireEvent.keyDown(screen.getByLabelText("节点图"), { key: "Delete" });

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes,
    ).toHaveLength(0);

    fireEvent.keyDown(screen.getByLabelText("节点图"), {
      key: "z",
      ctrlKey: true,
    });

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes,
    ).toHaveLength(1);
  });

  it("deletes a selected wire through the same undoable shortcut", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(startNode());
    addNode(plainNode(BRANCH, "core.logic.branch"));
    const graphId = activeGraphId();
    const edgeId = "9d7f5e3c-1b0a-4c2d-8e6f-1029384756ab";
    const outcome = useDocumentStore
      .getState()
      .runCommand("graph.history.connect", {
        kind: "addEdge",
        graphId,
        edge: {
          edgeId,
          edgeKind: "execution",
          sourceNodeId: START,
          sourcePortId: "next",
          targetNodeId: BRANCH,
          targetPortId: "run",
        },
      });
    if (!outcome.ok) {
      throw new Error("The test wire should be added.");
    }
    useEditorSessionStore.getState().setSelection([], [edgeId]);

    fireEvent.keyDown(screen.getByLabelText("节点图"), { key: "Delete" });

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.edges,
    ).toEqual([]);
  });

  it("disconnects every wire on a port with Alt plus left click", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(startNode());
    addNode(plainNode(BRANCH, "core.logic.branch"));
    const graphId = activeGraphId();
    const outcome = useDocumentStore
      .getState()
      .runCommand("graph.history.connect", {
        kind: "addEdge",
        graphId,
        edge: {
          edgeId: "9d7f5e3c-1b0a-4c2d-8e6f-1029384756ac",
          edgeKind: "execution",
          sourceNodeId: START,
          sourcePortId: "next",
          targetNodeId: BRANCH,
          targetPortId: "run",
        },
      });
    if (!outcome.ok) {
      throw new Error("The test wire should be added.");
    }

    fireEvent.pointerDown(
      await screen.findByLabelText("开始 的输出端口 下一步，类型 执行"),
      { button: 0, altKey: true },
    );

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.edges,
    ).toEqual([]);
  });

  it("creates an editable area comment around selected nodes with C", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(startNode());
    useEditorSessionStore.getState().setSelection([START], []);
    await within(screen.getByLabelText("节点图")).findByText("开始");

    fireEvent.keyDown(screen.getByLabelText("节点图"), { key: "c" });

    const comment =
      useDocumentStore.getState().history?.document.graphs[0]?.editorMetadata
        ?.comments?.[0];
    expect(comment).toMatchObject({
      text: "备注",
      position: { x: -32, y: -32 },
      size: { width: 284, height: 96 },
    });
    expect(screen.getByRole("textbox", { name: "区域备注内容" })).toBeVisible();
  });

  it("enters and cancels drag-to-comment mode with C and Escape", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    const surface = screen.getByLabelText("节点图编辑区");

    fireEvent.keyDown(surface, { key: "c" });
    expect(surface).toHaveAttribute("data-comment-mode", "true");

    fireEvent.keyDown(surface, { key: "Escape" });
    expect(surface).not.toHaveAttribute("data-comment-mode");
  });

  it("does not act on a shortcut typed into a text field or during composition", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(startNode());
    useEditorSessionStore.getState().setSelection([START], []);

    const field = document.createElement("input");
    screen.getByLabelText("节点图").append(field);
    fireEvent.keyDown(field, { key: "Delete" });
    fireEvent.keyDown(screen.getByLabelText("节点图"), {
      key: "Delete",
      isComposing: true,
    });

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes,
    ).toHaveLength(1);
  });

  it("opens quick add from the graph surface and inserts the chosen node", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    const surface = screen.getByLabelText("节点图编辑区");

    fireEvent.keyDown(surface, { key: "Tab", target: surface });

    const search = await screen.findByRole("textbox", { name: "搜索节点" });
    expect(search.closest(".quick-add")).toHaveClass("nowheel");
    fireEvent.wheel(search, { deltaY: 80 });
    await userEvent.type(search, "数值比较{Enter}");

    const nodes =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes ?? [];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.typeKey).toBe("core.logic.numberCompare");
  });

  it("leaves Tab alone when focus is on a control inside the canvas", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    const control = document.createElement("button");
    screen.getByLabelText("节点图编辑区").append(control);

    fireEvent.keyDown(control, { key: "Tab" });

    expect(
      screen.queryByRole("textbox", { name: "搜索节点" }),
    ).not.toBeInTheDocument();
  });

  it("offers a hierarchical create menu on the canvas", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    fireEvent.contextMenu(screen.getByLabelText("节点图编辑区"));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("添加节点")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "流程" }),
    ).toBeInTheDocument();
    // Nothing is selected, so the destructive entry is offered but not usable.
    expect(
      within(menu).getByRole("menuitem", { name: "删除所选内容" }),
    ).toHaveAttribute("data-disabled");
    expect(
      within(menu).getByRole("menuitem", { name: "整理重叠节点" }),
    ).toHaveAttribute("data-disabled");
  });

  it("resolves overlapping nodes as one undoable canvas action", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    addNode(plainNode(START, "core.flow.start"));
    addNode(plainNode(BRANCH, "core.logic.branch"));

    const canvas = screen.getByLabelText("节点图编辑区");
    fireEvent.contextMenu(canvas);
    const menu = await screen.findByRole("menu");
    const resolveItem = within(menu).getByRole("menuitem", {
      name: "整理重叠节点",
    });
    expect(resolveItem).not.toHaveAttribute("data-disabled");
    await user.click(resolveItem);

    const movedNodes =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes ?? [];
    expect(movedNodes[0]?.position).toEqual({ x: 128, y: 48 });
    expect(movedNodes[1]?.position).not.toEqual({ x: 120, y: 40 });

    useDocumentStore.getState().undoChange();
    const undoneNodes =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes ?? [];
    expect(undoneNodes[0]?.position).toEqual({ x: 120, y: 40 });
    expect(undoneNodes[1]?.position).toEqual({ x: 120, y: 40 });
  });

  it("uses bounded estimates to arrange a large unmeasured graph", async () => {
    useLayoutPreferenceStore.getState().replaceLayout({
      ...defaultLayoutPreferences,
      performanceProfile: "efficiency",
    });
    render(<App />);
    await createProjectFromEmptyState();

    for (
      let index = 0;
      index < EFFICIENCY_VISIBLE_ELEMENT_THRESHOLD;
      index += 1
    ) {
      addNode(
        plainNode(
          `70000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
          "core.logic.branch",
        ),
      );
    }

    await waitFor(() => {
      const nodes =
        useDocumentStore.getState().history?.document.graphs[0]?.nodes ?? [];
      expect(
        nodes.some((node) => node.position.x !== 120 || node.position.y !== 40),
      ).toBe(true);
    });
  });

  it("uses estimates at the efficiency virtualization threshold", async () => {
    useLayoutPreferenceStore.getState().replaceLayout({
      ...defaultLayoutPreferences,
      performanceProfile: "efficiency",
    });
    render(<App />);
    await createProjectFromEmptyState();

    act(() => {
      replaceActiveGraphNodes(denseNodes(EFFICIENCY_VISIBLE_ELEMENT_THRESHOLD));
    });

    await waitFor(() => {
      expect(overlapCommandCount()).toBe(1);
      expect(
        hasNodeOverlap(projectedGraphRectangles(), {
          horizontalGap: 0,
          verticalGap: 0,
        }),
      ).toBe(false);
    });
  });

  it("uses bounded dimensions at the efficiency virtualization threshold", async () => {
    useLayoutPreferenceStore.getState().replaceLayout({
      ...defaultLayoutPreferences,
      performanceProfile: "efficiency",
    });
    render(<App />);
    await createProjectFromEmptyState();
    act(() => {
      replaceActiveGraphNodes(denseNodes(EFFICIENCY_VISIBLE_ELEMENT_THRESHOLD));
    });
    await screen.findByLabelText("节点图");

    const document = useDocumentStore.getState().history?.document;
    const graph = document?.graphs[0];
    const registry = useRegistryStore.getState().snapshot;
    if (graph === undefined || registry === undefined) {
      throw new Error("The opened graph and registry must be available.");
    }
    const projected = new GraphProjection().projectNodes(graph, registry)[0];
    if (projected === undefined) {
      throw new Error("The opened graph should project its first node.");
    }
    const rectangle = nodeRectangle(
      { ...projected, measured: { width: 0, height: 0 } },
      null,
      false,
      true,
      false,
    );
    expect(rectangle?.width).toBe(NODE_WIDTH);
    expect(rectangle?.height).toBeGreaterThan(0);
  });

  it("does not repeat automatic layout after incremental loading or later insertion", async () => {
    useLayoutPreferenceStore.getState().replaceLayout({
      ...defaultLayoutPreferences,
      performanceProfile: "efficiency",
    });
    render(<App />);
    await createProjectFromEmptyState();

    for (const node of denseNodes(EFFICIENCY_VISIBLE_ELEMENT_THRESHOLD)) {
      addNode(node);
    }

    await waitFor(() => {
      expect(overlapCommandCount()).toBe(1);
      expect(
        hasNodeOverlap(projectedGraphRectangles(), {
          horizontalGap: 0,
          verticalGap: 0,
        }),
      ).toBe(false);
    });
    const commandCount = overlapCommandCount();

    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
    expect(overlapCommandCount()).toBe(commandCount);

    addNode(
      plainNode(
        `70000000-0000-4000-8000-${(EFFICIENCY_VISIBLE_ELEMENT_THRESHOLD + 1)
          .toString()
          .padStart(12, "0")}`,
        "core.logic.branch",
      ),
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
    expect(overlapCommandCount()).toBe(commandCount);
  });

  it("waits through an execution lock and lays out after the lock is released", async () => {
    useLayoutPreferenceStore.getState().replaceLayout({
      ...defaultLayoutPreferences,
      performanceProfile: "efficiency",
    });
    render(<App />);
    await createProjectFromEmptyState();

    act(() => {
      replaceActiveGraphNodes(denseNodes(EFFICIENCY_VISIBLE_ELEMENT_THRESHOLD));
      useDocumentStore.getState().setExecutionLocked(true);
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
    expect(overlapCommandCount()).toBe(0);
    expect(
      hasNodeOverlap(projectedGraphRectangles(), {
        horizontalGap: 0,
        verticalGap: 0,
      }),
    ).toBe(true);

    act(() => {
      useDocumentStore.getState().setExecutionLocked(false);
    });
    await waitFor(() => {
      expect(overlapCommandCount()).toBe(1);
      expect(
        hasNodeOverlap(projectedGraphRectangles(), {
          horizontalGap: 0,
          verticalGap: 0,
        }),
      ).toBe(false);
    });
  });

  it("does not change or fit the graph when the layout command is rejected", async () => {
    useLayoutPreferenceStore.getState().replaceLayout({
      ...defaultLayoutPreferences,
      performanceProfile: "efficiency",
    });
    render(<App />);
    await createProjectFromEmptyState();

    const originalRunCommand = useDocumentStore.getState().runCommand;
    useDocumentStore.setState({
      runCommand: () => ({ ok: false, reason: "graphMissing" }),
    });
    act(() => {
      replaceActiveGraphNodes(denseNodes(EFFICIENCY_VISIBLE_ELEMENT_THRESHOLD));
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });

    expect(overlapCommandCount()).toBe(0);
    expect(
      hasNodeOverlap(projectedGraphRectangles(), {
        horizontalGap: 0,
        verticalGap: 0,
      }),
    ).toBe(true);

    useDocumentStore.setState({ runCommand: originalRunCommand });
    await waitFor(() => {
      expect(overlapCommandCount()).toBe(1);
      expect(
        hasNodeOverlap(projectedGraphRectangles(), {
          horizontalGap: 0,
          verticalGap: 0,
        }),
      ).toBe(false);
    });
  });

  it("keeps a stationary right click available for the canvas menu", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    const surface = screen.getByLabelText("节点图编辑区");

    fireEvent.pointerDown(surface, {
      button: 2,
      pointerId: 17,
      clientX: 240,
      clientY: 180,
    });
    fireEvent.pointerUp(surface, {
      button: 2,
      pointerId: 17,
      clientX: 240,
      clientY: 180,
    });
    fireEvent.contextMenu(surface, { clientX: 240, clientY: 180 });

    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("promotes a right-button drag to a frame-coalesced pan", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    const surface = screen.getByLabelText("节点图编辑区");
    const pointer = { button: 2, pointerId: 18, clientX: 240, clientY: 180 };

    fireEvent.pointerDown(surface, pointer);
    fireEvent.pointerMove(surface, {
      ...pointer,
      clientX: pointer.clientX + 2,
      clientY: pointer.clientY + 2,
    });
    expect(surface).not.toHaveAttribute("data-panning");

    fireEvent.pointerMove(surface, {
      ...pointer,
      clientX: pointer.clientX + 12,
      clientY: pointer.clientY + 8,
    });
    expect(surface).toHaveAttribute("data-panning", "true");

    fireEvent.pointerUp(surface, {
      ...pointer,
      clientX: pointer.clientX + 12,
      clientY: pointer.clientY + 8,
    });
    expect(surface).not.toHaveAttribute("data-panning");
  });

  it("copies and pastes a selection as one undoable step", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(compareNode());
    useEditorSessionStore.getState().setSelection([COMPARE], []);

    const canvas = screen.getByLabelText("节点图");
    fireEvent.keyDown(canvas, { key: "c", ctrlKey: true });
    fireEvent.keyDown(canvas, { key: "v", ctrlKey: true });

    const nodes =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes ?? [];
    expect(nodes).toHaveLength(2);
    expect(nodes[1]?.nodeId).not.toBe(COMPARE);
    expect(nodes[1]?.position).toEqual({ x: 272, y: 152 });

    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });

    expect(
      useDocumentStore.getState().history?.document.graphs[0]?.nodes,
    ).toHaveLength(1);
  });
});
