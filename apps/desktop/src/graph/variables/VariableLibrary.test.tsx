import type { RinoProjectDocumentV1 } from "@rino/contracts";
import {
  act,
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
import { VARIABLE_DRAG_FORMAT } from "../canvas/canvas-drag";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import {
  createProjectFromEmptyState,
  installInMemoryProjectService,
} from "../../test/project-transport-double";
import { useDocumentStore } from "../store/document-store";
import { useLayoutPreferenceStore } from "../../preferences/layout-preference-store";
import { defaultLayoutPreferences } from "../../preferences/layout-preferences";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../store/project-lifecycle";
import { insertVariableNode } from "./variable-commands";

function dragTransfer(): {
  effectAllowed: string;
  getData: (format: string) => string;
  setData: (format: string, value: string) => void;
} {
  const values = new Map<string, string>();
  return {
    effectAllowed: "",
    getData: (format: string) => values.get(format) ?? "",
    setData: (format: string, value: string) => {
      values.set(format, value);
    },
  };
}
function variableLibrary(): HTMLElement {
  return screen.getByRole("complementary", { name: "整个项目共享变量" });
}

describe("VariableLibrary", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    closeProjectDocument();
    useLayoutPreferenceStore.setState({
      layout: { ...defaultLayoutPreferences },
    });
    installInMemoryProjectService();
  });

  it("creates a project variable from the independent workbench page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    await user.click(
      within(
        screen.getByRole("complementary", { name: "打开工作台" }),
      ).getByRole("button", { name: "整个项目共享变量" }),
    );

    const page = variableLibrary();
    expect(
      within(page).queryByRole("heading", {
        name: "整个项目共享变量",
        level: 3,
      }),
    ).not.toBeInTheDocument();
    await user.type(
      within(page).getByRole("textbox", { name: "新变量名称" }),
      "score",
    );
    await user.click(within(page).getByRole("button", { name: "新建变量" }));

    await waitFor(() => {
      expect(useDocumentStore.getState().history?.document.variables).toEqual([
        expect.objectContaining({
          name: "score",
          valueKind: "string",
          persistent: false,
        }),
      ]);
    });
    expect(useDocumentStore.getState().history?.undoable.at(-1)?.label).toBe(
      "graph.history.setVariable",
    );
  });

  it("shows a prominent delete action and confirms removal", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    await user.click(
      within(
        screen.getByRole("complementary", {
          name: "\u6253\u5f00\u5de5\u4f5c\u53f0",
        }),
      ).getByRole("button", {
        name: "\u6574\u4e2a\u9879\u76ee\u5171\u4eab\u53d8\u91cf",
      }),
    );
    const page = variableLibrary();

    await user.type(
      within(page).getByRole("textbox", {
        name: "\u65b0\u53d8\u91cf\u540d\u79f0",
      }),
      "score",
    );
    await user.click(
      within(page).getByRole("button", { name: "\u65b0\u5efa\u53d8\u91cf" }),
    );
    await user.click(
      within(page).getByRole("button", { name: "\u5220\u9664\u53d8\u91cf" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "\u5220\u9664\u53d8\u91cf\u201cscore\u201d\uff1f",
    });
    expect(
      within(dialog).getByText(
        "\u8be5\u5171\u4eab\u53d8\u91cf\u5c06\u4ece\u9879\u76ee\u4e2d\u5220\u9664\u3002\u6b64\u64cd\u4f5c\u53ef\u64a4\u9500\u3002",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "\u5220\u9664\u53d8\u91cf" }),
    );

    await waitFor(() => {
      expect(useDocumentStore.getState().history?.document.variables).toEqual(
        [],
      );
    });
  });

  it("drags the selected variable and protects editor controls", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    await user.click(
      within(
        screen.getByRole("complementary", { name: "打开工作台" }),
      ).getByRole("button", { name: "整个项目共享变量" }),
    );
    const page = variableLibrary();

    await user.type(
      within(page).getByRole("textbox", { name: "新变量名称" }),
      "score",
    );
    await user.click(within(page).getByRole("button", { name: "新建变量" }));

    await waitFor(() => {
      expect(
        useDocumentStore.getState().history?.document.variables,
      ).toHaveLength(1);
    });
    const variableId =
      useDocumentStore.getState().history?.document.variables?.[0]?.variableId;
    if (variableId === undefined) {
      throw new Error("Expected the created variable to have an identifier.");
    }

    const editor = within(page).getByRole("article", {
      name: "当前项目共享变量",
    });
    expect(editor).toHaveAttribute("draggable", "true");

    const dataTransfer = dragTransfer();
    fireEvent.dragStart(editor, { dataTransfer });
    expect(dataTransfer.getData(VARIABLE_DRAG_FORMAT)).toContain(variableId);
    fireEvent.dragEnd(editor, { dataTransfer });

    const nameInput = within(editor).getByRole("textbox", {
      name: "变量名称",
    });
    const controlTransfer = dragTransfer();
    fireEvent.dragStart(nameInput, { dataTransfer: controlTransfer });
    expect(controlTransfer.getData(VARIABLE_DRAG_FORMAT)).toBe("");

    act(() => {
      useDocumentStore.getState().setExecutionLocked(true);
    });
    expect(editor).toHaveAttribute("draggable", "false");
  });
  it("shows variables from an unnormalized active graph", async () => {
    const user = userEvent.setup();
    const graphId = "62000000-0000-4000-8000-000000000006";
    openProjectDocument({
      schemaVersion: 1,
      documentId: "62000000-0000-4000-8000-000000000001",
      metadata: {
        name: "旧项目",
        createdAt: "2026-08-23T00:00:00Z",
        updatedAt: "2026-08-23T00:00:00Z",
      },
      entryGraphId: graphId,
      graphs: [
        {
          graphId,
          name: "旧任务",
          kind: "entry",
          nodes: [],
          edges: [],
          variables: [
            {
              variableId: "62000000-0000-4000-8000-000000000007",
              name: "legacyCount",
              valueKind: "number",
              persistent: false,
            },
          ],
        },
      ],
      assets: [],
      requiredCapabilities: [],
    } satisfies RinoProjectDocumentV1);
    render(<App />);
    await user.click(
      within(
        screen.getByRole("complementary", { name: "打开工作台" }),
      ).getByRole("button", { name: "整个项目共享变量" }),
    );

    expect(
      within(variableLibrary()).getByText("legacyCount"),
    ).toBeInTheDocument();
  });

  it("prevents changing type or deleting a variable after inserting a getter", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    await user.click(
      within(
        screen.getByRole("complementary", { name: "打开工作台" }),
      ).getByRole("button", { name: "整个项目共享变量" }),
    );
    const page = variableLibrary();

    await user.type(
      within(page).getByRole("textbox", { name: "新变量名称" }),
      "score",
    );
    await user.click(within(page).getByRole("button", { name: "新建变量" }));

    const variableId =
      useDocumentStore.getState().history?.document.variables?.[0]?.variableId;
    if (variableId === undefined) {
      throw new Error("Expected the created variable to have an identifier.");
    }
    act(() => {
      expect(
        insertVariableNode(variableId, "getter", { x: 0, y: 0 }),
      ).toBeDefined();
    });
    expect(
      within(page).queryByRole("button", { name: "插入获取变量" }),
    ).not.toBeInTheDocument();
    expect(
      within(page).queryByRole("button", { name: "插入设置变量" }),
    ).not.toBeInTheDocument();

    expect(
      within(page).getByRole("combobox", { name: "变量类型" }),
    ).toBeDisabled();
    expect(
      within(page).getByText("该变量已被任务或函数节点引用，不能更改类型。"),
    ).toBeInTheDocument();
    expect(
      within(page).getByRole("button", { name: "删除变量" }),
    ).toBeDisabled();
    expect(
      useDocumentStore
        .getState()
        .history?.document.graphs[0]?.nodes.some(
          (node) => node.typeKey === "core.variable.getString",
        ),
    ).toBe(true);
  });
});
