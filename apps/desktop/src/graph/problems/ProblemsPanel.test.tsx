import type { EdgeV1, NodeV1 } from "@rino/contracts";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../app/App";
import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import { defaultLayoutPreferences } from "../../preferences/layout-preferences";
import { useLayoutPreferenceStore } from "../../preferences/layout-preference-store";
import { useDiagnosticStore } from "../../diagnostics/diagnostic-store";
import type { GraphCommand } from "../commands/graph-commands";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import { closeProjectDocument } from "../store/project-lifecycle";
import {
  createProjectFromEmptyState,
  installInMemoryProjectService,
} from "../../test/project-transport-double";

const START = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const COMPARE = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";
const SELF_EDGE = "8b7a6c5d-4e3f-4291-8071-6d5c4b3a2918";

function compareNode(): NodeV1 {
  return {
    nodeId: COMPARE,
    typeKey: "core.logic.numberCompare",
    typeVersion: 1,
    position: { x: 240, y: 120 },
    properties: { operator: "greaterThan" },
    inputValues: {},
  };
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

/** A connection whose two ends are the same node. It cannot be drawn on the canvas, which
 * is exactly why a document can still contain one and the panel has to report it. */
function selfConnection(): EdgeV1 {
  return {
    edgeId: SELF_EDGE,
    edgeKind: "data",
    sourceNodeId: COMPARE,
    sourcePortId: "result",
    targetNodeId: COMPARE,
    targetPortId: "left",
  };
}

function activeGraphId(): string {
  const graphId = useEditorSessionStore.getState().activeGraphId;
  if (graphId === undefined) {
    throw new Error("A project must be open.");
  }
  return graphId;
}

function run(command: GraphCommand): void {
  act(() => {
    const outcome = useDocumentStore
      .getState()
      .runCommand("graph.history.insertNode", command);
    if (!outcome.ok) {
      throw new Error(`The command should have applied: ${outcome.reason}`);
    }
  });
}

function problemsPanel() {
  return within(screen.getByLabelText("图诊断"));
}

/** The activatable row whose text names the given element. */
function problemRow(text: string): HTMLElement {
  const row = problemsPanel()
    .getAllByRole("button")
    .find((candidate) => candidate.textContent.includes(text));
  if (!row) {
    throw new Error(`No problem row mentions ${text}.`);
  }
  return row;
}

describe("problems panel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    closeProjectDocument();
    installInMemoryProjectService();
    useDiagnosticStore.setState({ problems: [], notifications: [] });
    useLayoutPreferenceStore.setState({
      layout: { ...defaultLayoutPreferences },
    });
  });

  it("reports nothing to fix until the graph gives it something", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    expect(problemsPanel().getByText("当前项目没有发现问题。")).toBeVisible();
  });

  it("lists graph diagnostics with their severity, location, and code", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    run({ kind: "addNode", graphId: activeGraphId(), node: compareNode() });

    const panel = problemsPanel();
    expect(panel.getByText("图中缺少开始节点")).toBeVisible();
    expect(
      panel.getAllByText("必填输入既没有连线也没有内联值").length,
    ).toBeGreaterThan(0);
    expect(panel.getAllByText("错误").length).toBeGreaterThan(0);
    expect(panel.getByText("存在错误，运行前需要先修复。")).toBeVisible();
    expect(panel.getAllByText("NODE_REQUIRED_INPUT_MISSING")).toHaveLength(2);
    // The location reads as the graph, then the node, then the port.
    expect(problemRow("左值").textContent).toContain("数值比较");
  });

  it("selects the node and focuses the field a problem names", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    run({ kind: "addNode", graphId: activeGraphId(), node: compareNode() });

    await user.click(problemRow("左值"));

    expect(useEditorSessionStore.getState().selectedNodeIds).toEqual([COMPARE]);
    expect(useLayoutPreferenceStore.getState().layout.activeRightTab).toBe(
      "inspector",
    );
    expect(screen.getByRole("textbox", { name: "左值" })).toHaveFocus();
  });

  it("selects the connection an edge problem names", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    run({ kind: "addNode", graphId: activeGraphId(), node: compareNode() });
    run({ kind: "addEdge", graphId: activeGraphId(), edge: selfConnection() });

    await user.click(problemRow("连线的两端指向同一个节点"));

    expect(useEditorSessionStore.getState().selectedEdgeIds).toEqual([
      SELF_EDGE,
    ]);
    expect(useEditorSessionStore.getState().selectedNodeIds).toEqual([]);
  });

  it("revalidates after an edit and drops the problem the edit resolved", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    run({ kind: "addNode", graphId: activeGraphId(), node: compareNode() });

    expect(problemsPanel().getByText("图中缺少开始节点")).toBeVisible();

    run({ kind: "addNode", graphId: activeGraphId(), node: startNode() });

    expect(
      problemsPanel().queryByText("图中缺少开始节点"),
    ).not.toBeInTheDocument();

    await user.click(problemRow("左值"));
    await user.type(screen.getByRole("textbox", { name: "左值" }), "12");
    await user.tab();

    expect(
      problemsPanel().getAllByText("NODE_REQUIRED_INPUT_MISSING"),
    ).toHaveLength(1);
  });

  it("keeps a problem that names nothing on the canvas out of navigation", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    act(() => {
      const history = useDocumentStore.getState().history;
      if (!history) {
        throw new Error("A project must be open.");
      }
      // An entry graph the document points at but does not contain is a document-scoped
      // problem: there is no element to reveal.
      useDocumentStore.getState().openDocument({
        ...history.document,
        entryGraphId: "00000000-0000-4000-8000-000000000000",
      });
    });

    const panel = problemsPanel();
    expect(panel.getByText("项目指向的入口图不存在")).toBeVisible();
    expect(
      panel
        .queryAllByRole("button")
        .some((row) => row.textContent.includes("项目指向的入口图不存在")),
    ).toBe(false);
  });
});
