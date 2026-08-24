import type { RinoProjectDocumentV1 } from "@rino/contracts";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { createEmptyProject } from "../graph/project-factory";
import { applicationI18n } from "../localization/i18n";
import { useProblemFocusStore } from "../graph/problems/problem-focus";
import { useRegistryStore } from "../graph/registry/registry-store";
import { openProjectDocument } from "../graph/store/project-lifecycle";
import { useRuntimeExecutionStore } from "../ipc/runtime-execution-store";
import { RuntimeExecutionPanel } from "./RuntimeExecutionPanel";

const GRAPH_ID = "graph-test-101";
const NODE_1 = "node-11111111-2222-3333-4444-555555555555";
const NODE_2 = "node-66666666-7777-8888-9999-000000000000";

function createTestDocument(): RinoProjectDocumentV1 {
  const doc = createEmptyProject({
    name: "测试项目",
    entryGraphName: "主图",
    createdAt: "2026-07-28T00:00:00.000Z",
  });
  const graph = doc.graphs[0];
  if (!graph) {
    throw new Error("Entry graph is missing");
  }
  const customGraph = {
    ...graph,
    graphId: GRAPH_ID,
    nodes: [
      {
        nodeId: NODE_1,
        typeKey: "core.logic.numberCompare",
        typeVersion: 1,
        position: { x: 0, y: 0 },
        properties: {},
        inputValues: {},
      },
      {
        nodeId: NODE_2,
        typeKey: "core.logic.branch",
        typeVersion: 1,
        position: { x: 100, y: 0 },
        properties: {},
        inputValues: {},
        displayAlias: "条件判断别名",
      },
    ],
    edges: [],
  };

  return {
    ...doc,
    entryGraphId: GRAPH_ID,
    graphs: [customGraph],
  };
}

describe("RuntimeExecutionPanel component tests", () => {
  beforeEach(async () => {
    await applicationI18n.changeLanguage("zh-CN");
    useRuntimeExecutionStore.getState().reset();
    useProblemFocusStore.getState().clearFocus();

    useRegistryStore.setState({
      snapshot: {
        schemaVersion: 1,
        registryVersion: "test-v1",
        definitions: [
          {
            typeKey: "core.logic.numberCompare",
            typeVersion: 1,
            category: "logic",
            titleKey: "node.core.logic.numberCompare.title",
            descriptionKey: "node.core.logic.numberCompare.description",
            iconKey: "category.logic",
            runtimeKind: "pure",
            sideEffect: "none",
            ports: [],
          },
          {
            typeKey: "core.logic.branch",
            typeVersion: 1,
            category: "logic",
            titleKey: "node.core.logic.branch.title",
            descriptionKey: "node.core.logic.branch.description",
            iconKey: "category.logic",
            runtimeKind: "pure",
            sideEffect: "none",
            ports: [],
          },
        ],
      },
      source: "development",
      runtimeGeneration: undefined,
    });

    openProjectDocument(createTestDocument());
  });

  it("shows empty state when no run is active", () => {
    render(<RuntimeExecutionPanel mode="execution" />);
    expect(screen.getByText("暂无执行记录")).toBeInTheDocument();
  });

  it("renders run summary with steps, tokens, cache hits, and safe terminal error code", () => {
    useRuntimeExecutionStore.getState().beginRun(GRAPH_ID, 1);
    useRuntimeExecutionStore.getState().acceptRun(
      {
        accepted: true,
        runId: "run-1",
        graphId: GRAPH_ID,
        registryVersion: "test-v1",
      },
      1,
    );

    useRuntimeExecutionStore.getState().applyEvent({
      eventId: "evt-1",
      runId: "run-1",
      generation: 1,
      sequence: 1,
      messageType: "run.stateChanged",
      payload: {
        graphId: GRAPH_ID,
        state: "failed",
        stepCount: 12,
        tokensCreated: 34,
        pureCacheHits: 5,
        terminalError: {
          code: "ERR_TIMEOUT",
          messageKey: "internal.secret.error",
        },
      },
    });

    render(<RuntimeExecutionPanel mode="execution" />);

    expect(screen.getByText("已失败")).toBeInTheDocument();
    expect(screen.getByText("12 步")).toBeInTheDocument();
    expect(screen.getByText("34 代币")).toBeInTheDocument();
    expect(screen.getByText("缓存命中 5 次")).toBeInTheDocument();
    expect(screen.getByText("错误代码：ERR_TIMEOUT")).toBeInTheDocument();
    expect(screen.queryByText("internal.secret.error")).toBeNull();
  });

  it("preserves source order and distinguishes repeated activations of the same node", () => {
    useRuntimeExecutionStore.getState().beginRun(GRAPH_ID, 1);
    useRuntimeExecutionStore.getState().acceptRun(
      {
        accepted: true,
        runId: "run-1",
        graphId: GRAPH_ID,
        registryVersion: "test-v1",
      },
      1,
    );

    useRuntimeExecutionStore.getState().applyEvents([
      {
        eventId: "evt-1",
        runId: "run-1",
        generation: 1,
        sequence: 1,
        messageType: "node.stateChanged",
        nodeId: NODE_1,
        payload: {
          runSequence: 1,
          tokenId: 1,
          activationId: 10,
          state: "succeeded",
        },
      },
      {
        eventId: "evt-2",
        runId: "run-1",
        generation: 1,
        sequence: 2,
        messageType: "node.stateChanged",
        nodeId: NODE_1,
        payload: {
          runSequence: 2,
          tokenId: 1,
          activationId: 11,
          state: "running",
        },
      },
    ]);

    render(<RuntimeExecutionPanel mode="execution" />);

    const buttons = screen.getAllByRole("button", { name: /数值比较/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent("1");
    expect(buttons[1]).toHaveTextContent("2");
    expect(buttons[1]).toHaveAttribute("aria-current", "step");
  });

  it("updates an existing activation row in place on completion event", () => {
    useRuntimeExecutionStore.getState().beginRun(GRAPH_ID, 1);
    useRuntimeExecutionStore.getState().acceptRun(
      {
        accepted: true,
        runId: "run-1",
        graphId: GRAPH_ID,
        registryVersion: "test-v1",
      },
      1,
    );

    useRuntimeExecutionStore.getState().applyEvent({
      eventId: "evt-1",
      runId: "run-1",
      generation: 1,
      sequence: 1,
      messageType: "node.stateChanged",
      nodeId: NODE_1,
      payload: {
        runSequence: 1,
        tokenId: 1,
        activationId: 10,
        state: "running",
      },
    });

    const { rerender } = render(<RuntimeExecutionPanel mode="execution" />);
    expect(screen.getByRole("button", { name: /数值比较/ })).toHaveAttribute(
      "aria-current",
      "step",
    );

    act(() => {
      useRuntimeExecutionStore.getState().applyEvent({
        eventId: "evt-2",
        runId: "run-1",
        generation: 1,
        sequence: 2,
        messageType: "node.stateChanged",
        nodeId: NODE_1,
        payload: {
          runSequence: 1,
          tokenId: 1,
          activationId: 10,
          state: "succeeded",
        },
      });
    });

    rerender(<RuntimeExecutionPanel mode="execution" />);
    const button = screen.getByRole("button", { name: /数值比较/ });
    expect(button).not.toHaveAttribute("aria-current");
    expect(button).toHaveTextContent("执行成功");
  });

  it("triggers focus reveal boundary when clicking an available node row", async () => {
    const user = userEvent.setup();
    useRuntimeExecutionStore.getState().beginRun(GRAPH_ID, 1);
    useRuntimeExecutionStore.getState().acceptRun(
      {
        accepted: true,
        runId: "run-1",
        graphId: GRAPH_ID,
        registryVersion: "test-v1",
      },
      1,
    );

    useRuntimeExecutionStore.getState().applyEvent({
      eventId: "evt-1",
      runId: "run-1",
      generation: 1,
      sequence: 1,
      messageType: "node.stateChanged",
      nodeId: NODE_2,
      payload: {
        runSequence: 1,
        tokenId: 1,
        activationId: 10,
        state: "running",
      },
    });

    render(<RuntimeExecutionPanel mode="execution" />);

    const rowBtn = screen.getByRole("button", { name: /条件判断别名/ });
    await user.click(rowBtn);

    const focusReq = useProblemFocusStore.getState().request;
    expect(focusReq).toBeDefined();
    expect(focusReq?.graphId).toBe(GRAPH_ID);
    expect(focusReq?.nodeId).toBe(NODE_2);
  });

  it("disables reveal action for a missing node row but keeps it readable", () => {
    const missingNodeId = "node-missing-0000-0000";
    useRuntimeExecutionStore.getState().beginRun(GRAPH_ID, 1);
    useRuntimeExecutionStore.getState().acceptRun(
      {
        accepted: true,
        runId: "run-1",
        graphId: GRAPH_ID,
        registryVersion: "test-v1",
      },
      1,
    );

    useRuntimeExecutionStore.getState().applyEvent({
      eventId: "evt-1",
      runId: "run-1",
      generation: 1,
      sequence: 1,
      messageType: "node.stateChanged",
      nodeId: missingNodeId,
      payload: {
        runSequence: 1,
        tokenId: 1,
        activationId: 10,
        state: "succeeded",
      },
    });

    render(<RuntimeExecutionPanel mode="execution" />);

    const button = screen.getByRole("button", { name: /未知节点/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "节点在当前图中已不存在，无法定位");
  });

  it("renders plain text logs without interpreting html or markdown", () => {
    useRuntimeExecutionStore.getState().beginRun(GRAPH_ID, 1);
    useRuntimeExecutionStore.getState().acceptRun(
      {
        accepted: true,
        runId: "run-1",
        graphId: GRAPH_ID,
        registryVersion: "test-v1",
      },
      1,
    );

    useRuntimeExecutionStore.getState().applyEvent({
      eventId: "evt-1",
      runId: "run-1",
      generation: 1,
      sequence: 1,
      messageType: "runtime.logCreated",
      nodeId: NODE_1,
      payload: {
        logSequence: 1,
        activationId: 10,
        level: "warning",
        message: "<strong>HTML</strong> & *Markdown*",
      },
    });

    render(<RuntimeExecutionPanel mode="logs" />);

    const msg = screen.getByText("<strong>HTML</strong> & *Markdown*");
    expect(msg).toBeInTheDocument();
    expect(msg.tagName.toLowerCase()).toBe("span");
  });

  it("renders values with empty preview, truncation, dimensions, and item count", () => {
    useRuntimeExecutionStore.getState().beginRun(GRAPH_ID, 1);
    useRuntimeExecutionStore.getState().acceptRun(
      {
        accepted: true,
        runId: "run-1",
        graphId: GRAPH_ID,
        registryVersion: "test-v1",
      },
      1,
    );

    useRuntimeExecutionStore.getState().applyEvent({
      eventId: "evt-1",
      runId: "run-1",
      generation: 1,
      sequence: 1,
      messageType: "node.stateChanged",
      nodeId: NODE_1,
      payload: {
        runSequence: 1,
        tokenId: 1,
        activationId: 10,
        state: "succeeded",
        valueSummaries: [
          {
            portId: "img",
            generation: 1,
            kind: "image",
            preview: "",
            width: 1920,
            height: 1080,
            truncated: false,
          },
          {
            portId: "txt",
            generation: 1,
            kind: "string",
            preview: "Hello World",
            itemCount: 3,
            truncated: true,
          },
        ],
      },
    });

    const { container } = render(<RuntimeExecutionPanel mode="values" />);

    expect(screen.getByText("1920 × 1080")).toBeInTheDocument();
    expect(screen.getByText(/Hello World/)).toBeInTheDocument();
    expect(screen.getByText("3 项")).toBeInTheDocument();
    expect(screen.getByText("（已截断）")).toBeInTheDocument();
    expect(
      container.querySelector(".runtime-panel__preview:empty"),
    ).toBeInTheDocument();
  });

  it("supports 200-item paging and Show Earlier button", async () => {
    const user = userEvent.setup();
    useRuntimeExecutionStore.getState().beginRun(GRAPH_ID, 1);
    useRuntimeExecutionStore.getState().acceptRun(
      {
        accepted: true,
        runId: "run-1",
        graphId: GRAPH_ID,
        registryVersion: "test-v1",
      },
      1,
    );

    const logsEvents = Array.from({ length: 250 }, (_, i) => ({
      eventId: `evt-${String(i + 1)}`,
      runId: "run-1",
      generation: 1,
      sequence: i + 1,
      messageType: "runtime.logCreated" as const,
      nodeId: NODE_1,
      payload: {
        logSequence: i + 1,
        activationId: 10,
        level: "info" as const,
        message: `Log message ${String(i + 1)}`,
      },
    }));

    useRuntimeExecutionStore.getState().applyEvents(logsEvents);

    render(<RuntimeExecutionPanel mode="logs" />);

    expect(screen.getByText("显示更早的 50 条记录")).toBeInTheDocument();
    expect(screen.queryByText("Log message 1")).toBeNull();
    expect(screen.getByText("Log message 250")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /显示更早/ }));

    expect(screen.getByText("Log message 1")).toBeInTheDocument();
    expect(screen.queryByText(/显示更早/)).toBeNull();
  });

  it("resets page limit when a new run starts", () => {
    useRuntimeExecutionStore.getState().beginRun(GRAPH_ID, 1);
    useRuntimeExecutionStore.getState().acceptRun(
      {
        accepted: true,
        runId: "run-1",
        graphId: GRAPH_ID,
        registryVersion: "test-v1",
      },
      1,
    );

    const logsEvents = Array.from({ length: 250 }, (_, i) => ({
      eventId: `evt-${String(i + 1)}`,
      runId: "run-1",
      generation: 1,
      sequence: i + 1,
      messageType: "runtime.logCreated" as const,
      nodeId: NODE_1,
      payload: {
        logSequence: i + 1,
        activationId: 10,
        level: "info" as const,
        message: `Log message ${String(i + 1)}`,
      },
    }));
    useRuntimeExecutionStore.getState().applyEvents(logsEvents);

    const { rerender } = render(<RuntimeExecutionPanel mode="logs" />);
    expect(screen.getByText("显示更早的 50 条记录")).toBeInTheDocument();

    act(() => {
      useRuntimeExecutionStore.getState().beginRun(GRAPH_ID, 2);
      useRuntimeExecutionStore.getState().acceptRun(
        {
          accepted: true,
          runId: "run-2",
          graphId: GRAPH_ID,
          registryVersion: "test-v1",
        },
        2,
      );
    });

    rerender(<RuntimeExecutionPanel mode="logs" />);
    expect(screen.queryByText(/显示更早/)).toBeNull();
  });

  it("handles narrow width and reduced motion accessibility requirements", () => {
    useRuntimeExecutionStore.getState().beginRun(GRAPH_ID, 1);
    useRuntimeExecutionStore.getState().acceptRun(
      {
        accepted: true,
        runId: "run-1",
        graphId: GRAPH_ID,
        registryVersion: "test-v1",
      },
      1,
    );

    useRuntimeExecutionStore.getState().applyEvent({
      eventId: "evt-1",
      runId: "run-1",
      generation: 1,
      sequence: 1,
      messageType: "node.stateChanged",
      nodeId: NODE_1,
      payload: {
        runSequence: 1,
        tokenId: 1,
        activationId: 10,
        state: "succeeded",
      },
    });

    const { container } = render(<RuntimeExecutionPanel mode="execution" />);
    const panel = container.querySelector(".runtime-panel");
    expect(panel).toBeInTheDocument();
  });
});
