import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../app/App";
import { writeAutosave } from "../graph/project/project-actions";
import { useDocumentStore } from "../graph/store/document-store";
import { closeProjectDocument } from "../graph/store/project-lifecycle";
import { applicationI18n } from "../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import {
  createProjectFromEmptyState,
  installInMemoryProjectService,
  type InMemoryProjectService,
} from "../test/project-transport-double";

let service: InMemoryProjectService;

function topBar() {
  return within(screen.getByRole("banner", { name: "应用工具栏" }));
}

function addNode(): void {
  const document = useDocumentStore.getState().history?.document;
  const graph = document?.graphs[0];
  if (!graph) {
    throw new Error("A project must be open.");
  }
  act(() => {
    const outcome = useDocumentStore.getState().runCommand("test.addNode", {
      kind: "addNode",
      graphId: graph.graphId,
      node: {
        nodeId: "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f",
        typeKey: "core.flow.start",
        typeVersion: 1,
        position: { x: 0, y: 0 },
        properties: {},
        inputValues: {},
      },
    });
    if (!outcome.ok) {
      throw new Error(`The node should have been added: ${outcome.reason}`);
    }
  });
}

describe("the project surface in the application shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    closeProjectDocument();
    service = installInMemoryProjectService();
  });

  it("names the open project and marks it once it has unsaved changes", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    expect(topBar().getByText("示例项目")).toBeInTheDocument();
    expect(topBar().queryByText("有未保存的更改")).not.toBeInTheDocument();

    addNode();

    expect(topBar().getByText("有未保存的更改")).toBeInTheDocument();
  });

  it("saves through the toolbar and clears the unsaved marker", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode();

    await userEvent.click(topBar().getByRole("button", { name: "保存项目" }));

    expect(topBar().queryByText("有未保存的更改")).not.toBeInTheDocument();
    expect(service.writeCount).toBe(2);
  });

  it("asks before an action that would discard unsaved work", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode();

    await userEvent.click(topBar().getByRole("button", { name: "新建项目" }));

    expect(
      await screen.findByText("当前项目有未保存的更改"),
    ).toBeInTheDocument();
    expect(service.writeCount).toBe(1);
  });

  it("keeps the document when the question is cancelled", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode();
    const before = useDocumentStore.getState().history?.document;

    await userEvent.click(topBar().getByRole("button", { name: "新建项目" }));
    await userEvent.click(await screen.findByRole("button", { name: "取消" }));

    expect(useDocumentStore.getState().history?.document).toBe(before);
    expect(topBar().getByText("有未保存的更改")).toBeInTheDocument();
  });

  it("saves first when the user chooses to keep the work", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode();

    await userEvent.click(topBar().getByRole("button", { name: "新建项目" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "保存后继续" }),
    );

    // Two writes: the save that protected the work, then the project that replaced it.
    expect(service.writeCount).toBe(3);
  });

  it("saves with the keyboard", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode();

    await userEvent.keyboard("{Control>}s{/Control}");

    expect(await screen.findByText("示例项目")).toBeInTheDocument();
    expect(topBar().queryByText("有未保存的更改")).not.toBeInTheDocument();
    expect(service.writeCount).toBe(2);
  });

  it("offers recovered work when a project is opened with an unsaved copy", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode();
    await writeAutosave();
    // Saving is deliberately skipped: the edit exists only in the recovery slot.
    act(() => {
      useDocumentStore.getState().undoChange();
    });
    service.storedRecovery = service.autosaved;

    await userEvent.click(topBar().getByRole("button", { name: "打开项目" }));

    expect(await screen.findByText("发现未保存的工作")).toBeInTheDocument();
  });
});
