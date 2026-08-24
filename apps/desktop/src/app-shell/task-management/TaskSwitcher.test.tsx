import type { GraphV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/Tooltip";
import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import {
  openProjectDocument,
  closeProjectDocument,
} from "../../graph/store/project-lifecycle";
import { useDocumentStore } from "../../graph/store/document-store";
import { useEditorSessionStore } from "../../graph/store/editor-session-store";
import { useRuntimeExecutionStore } from "../../ipc/runtime-execution-store";
import { TaskSwitcher } from "./TaskSwitcher";
import { selectTask } from "./task-management-actions";
import { selectTaskMetadataKey } from "./task-metadata";

const FIRST_GRAPH_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_GRAPH_ID = "10000000-0000-4000-8000-000000000002";

function graph(graphId: string, name: string): GraphV1 {
  return { graphId, name, kind: "entry", nodes: [], edges: [] };
}

function documentWithTwoTasks(): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "00000000-0000-4000-8000-000000000001",
    metadata: {
      name: "任务测试项目",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    },
    entryGraphId: FIRST_GRAPH_ID,
    graphs: [graph(FIRST_GRAPH_ID, "主图"), graph(SECOND_GRAPH_ID, "刷金币")],
    assets: [],
    requiredCapabilities: [],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
  void applicationI18n.changeLanguage("zh-CN");
  closeProjectDocument();
  useRuntimeExecutionStore.getState().reset();
  openProjectDocument(documentWithTwoTasks());
});

function renderSwitcher() {
  return render(
    <TooltipProvider>
      <TaskSwitcher />
    </TooltipProvider>,
  );
}

describe("TaskSwitcher", () => {
  it("switches the active task without writing a document history entry", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    const switcher = screen.getByRole("combobox", { name: "切换任务" });
    await user.click(switcher);
    await user.click(screen.getByRole("option", { name: /刷金币/ }));

    expect(useEditorSessionStore.getState().activeGraphId).toBe(
      SECOND_GRAPH_ID,
    );
    expect(useEditorSessionStore.getState().selectedNodeIds).toEqual([]);
    expect(useDocumentStore.getState().history?.undoable).toHaveLength(0);
  });

  it("supports keyboard task selection", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    const switcher = screen.getByRole("combobox", { name: "切换任务" });
    switcher.focus();
    await user.keyboard("{Enter}{ArrowDown}{Enter}");

    expect(useEditorSessionStore.getState().activeGraphId).toBe(
      SECOND_GRAPH_ID,
    );
  });

  it("shows default and running markers in the keyboard-selectable list", async () => {
    const user = userEvent.setup();
    useRuntimeExecutionStore.getState().beginRun(SECOND_GRAPH_ID, 1);
    renderSwitcher();

    await user.click(screen.getByRole("combobox", { name: "切换任务" }));

    expect(screen.getAllByText("默认").length).toBeGreaterThan(0);
    expect(screen.getByText("运行中")).toBeInTheDocument();
  });

  it("disables switching and management while execution is locked", () => {
    useDocumentStore.getState().setExecutionLocked(true);
    renderSwitcher();

    expect(screen.getByRole("combobox", { name: "切换任务" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "管理任务" })).toBeDisabled();
  });

  it("returns focus to the management trigger after closing the dialog", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    const manageButton = screen.getByRole("button", { name: "管理任务" });
    await user.click(manageButton);
    expect(screen.getByRole("dialog", { name: "任务管理" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(document.activeElement).toBe(manageButton);
  });

  it("keeps the task metadata selector stable when only graph structure changes", () => {
    const firstKey = selectTaskMetadataKey(useDocumentStore.getState());
    const document = useDocumentStore.getState().history?.document;
    if (!document) {
      throw new Error("Expected an open document.");
    }
    useDocumentStore.getState().runCommand("test.addNode", {
      kind: "addNode",
      graphId: FIRST_GRAPH_ID,
      node: {
        nodeId: "20000000-0000-4000-8000-000000000001",
        typeKey: "core.flow.start",
        typeVersion: 1,
        position: { x: 0, y: 0 },
        properties: {},
        inputValues: {},
      },
    });

    expect(selectTaskMetadataKey(useDocumentStore.getState())).toBe(firstKey);
  });

  it("reports a stale task selection instead of changing session state", () => {
    const original = useEditorSessionStore.getState().activeGraphId;
    const outcome = selectTask("missing-task");

    expect(outcome).toEqual({ ok: false, reason: "taskMissing" });
    expect(useEditorSessionStore.getState().activeGraphId).toBe(original);
  });
});
