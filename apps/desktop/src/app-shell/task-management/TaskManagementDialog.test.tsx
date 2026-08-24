import type { GraphV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/Tooltip";
import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import { useDocumentStore } from "../../graph/store/document-store";
import { useEditorSessionStore } from "../../graph/store/editor-session-store";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../../graph/store/project-lifecycle";
import { TaskManagementDialog } from "./TaskManagementDialog";

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
      name: "任务管理测试",
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
  openProjectDocument(documentWithTwoTasks());
});

function renderDialog() {
  return render(
    <TooltipProvider>
      <TaskManagementDialog
        open
        onOpenChange={() => undefined}
        restoreFocus={() => undefined}
      />
    </TooltipProvider>,
  );
}

describe("TaskManagementDialog", () => {
  it("creates an empty task and makes it active", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("新建任务"), "刷钻石");
    await user.click(screen.getByRole("button", { name: /新建/ }));

    expect(
      useDocumentStore
        .getState()
        .history?.document.graphs.map((task) => task.name),
    ).toContain("刷钻石");
    expect(useEditorSessionStore.getState().activeGraphId).not.toBe(
      FIRST_GRAPH_ID,
    );
  });

  it("duplicates and renames tasks through command-backed actions", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "复制任务：主图" }));
    expect(
      useDocumentStore
        .getState()
        .history?.document.graphs.map((task) => task.name),
    ).toContain("主图 副本");

    await user.click(
      screen.getByRole("button", { name: "重命名任务：刷金币" }),
    );
    const renameInput = screen.getByRole("textbox", {
      name: "重命名任务：刷金币",
    });
    await user.clear(renameInput);
    await user.type(renameInput, "刷金币-夜间");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(
      useDocumentStore
        .getState()
        .history?.document.graphs.map((task) => task.name),
    ).toContain("刷金币-夜间");
  });

  it("requires delete confirmation and moves to the fallback when deleting active task", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "刷金币" }));
    await user.click(screen.getByRole("button", { name: "删除任务：刷金币" }));
    expect(screen.getByRole("alert")).toHaveTextContent("确定删除");

    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(
      useDocumentStore
        .getState()
        .history?.document.graphs.map((task) => task.name),
    ).not.toContain("刷金币");
    expect(useEditorSessionStore.getState().activeGraphId).toBe(FIRST_GRAPH_ID);
  });

  it("sets the default task and rejects an invalid name inline", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "设为默认" }));
    expect(useDocumentStore.getState().history?.document.entryGraphId).toBe(
      SECOND_GRAPH_ID,
    );

    await user.click(screen.getByRole("button", { name: /新建/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("任务名称不能为空");
    expect(useDocumentStore.getState().history?.document.graphs).toHaveLength(
      2,
    );
  });

  it("disables deleting the only task and localizes the dialog in English", async () => {
    openProjectDocument({
      ...documentWithTwoTasks(),
      graphs: [graph(FIRST_GRAPH_ID, "Main")],
      entryGraphId: FIRST_GRAPH_ID,
    });
    await applicationI18n.changeLanguage("en-US");
    renderDialog();

    expect(
      screen.getByRole("button", { name: "Delete task: Main" }),
    ).toBeDisabled();
    expect(screen.getByText("Task management")).toBeInTheDocument();
    expect(screen.getByText(/must keep at least one task/)).toBeInTheDocument();
  });

  it("disables the form while the document is execution locked", () => {
    useDocumentStore.getState().setExecutionLocked(true);
    renderDialog();

    expect(screen.getByRole("status")).toHaveTextContent("任务正在运行");
    expect(screen.getByLabelText("新建任务")).toBeDisabled();
  });
});
