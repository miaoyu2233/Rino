import type { GraphV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../app/App";
import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import { useLayoutPreferenceStore } from "../../preferences/layout-preference-store";
import { defaultLayoutPreferences } from "../../preferences/layout-preferences";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../store/project-lifecycle";
import {
  createProjectFromEmptyState,
  installInMemoryProjectService,
} from "../../test/project-transport-double";

function setViewport(width: number, height = 800): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

function functionDocument(): RinoProjectDocumentV1 {
  const entry: GraphV1 = {
    graphId: "entry-graph",
    name: "主图",
    kind: "entry",
    nodes: [],
    edges: [],
  };
  const functionGraph: GraphV1 = {
    graphId: "function-graph",
    name: "计算函数",
    kind: "function",
    functionSignature: { inputs: [], outputs: [] },
    nodes: [],
    edges: [],
  };
  return {
    schemaVersion: 1,
    documentId: "signature-document",
    metadata: {
      name: "签名编辑测试",
      createdAt: "2026-08-22T00:00:00Z",
      updatedAt: "2026-08-22T00:00:00Z",
    },
    entryGraphId: entry.graphId,
    graphs: [entry, functionGraph],
    assets: [],
    requiredCapabilities: [],
  };
}

function signaturePanel(): HTMLElement {
  return screen.getByRole("region", { name: "函数签名" });
}

describe("function signature editor", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    closeProjectDocument();
    installInMemoryProjectService();
    useLayoutPreferenceStore.setState({
      layout: { ...defaultLayoutPreferences, activeRightTab: "inspector" },
    });
    setViewport(1280);
  });

  it("shows without a node selection and edits name, parameters, type, and removal", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    act(() => {
      openProjectDocument(functionDocument());
      useEditorSessionStore.getState().setActiveGraph("function-graph");
    });

    const panel = signaturePanel();
    expect(within(panel).getAllByText("暂无参数")).toHaveLength(2);

    const graphName = within(panel).getByRole("textbox", { name: "函数名称" });
    await user.clear(graphName);
    await user.type(graphName, "新的计算函数");
    await user.keyboard("{Enter}");
    expect(useDocumentStore.getState().history?.document.graphs[1]?.name).toBe(
      "新的计算函数",
    );

    await user.click(within(panel).getByRole("button", { name: "添加输入" }));
    const name = within(panel).getByRole("textbox", {
      name: /输入: 输入 1 参数名称/u,
    });
    await user.clear(name);
    await user.type(name, "数量");
    await user.keyboard("{Enter}");

    expect(
      useDocumentStore.getState().history?.document.graphs[1]?.functionSignature
        ?.inputs[0]?.name,
    ).toBe("数量");

    const type = within(panel).getByRole("combobox", {
      name: /输入: 数量 参数类型/u,
    });
    await user.click(type);
    await user.click(screen.getByRole("option", { name: "数值" }));
    expect(type).toHaveAttribute("data-value", "number");

    await user.click(
      within(panel).getByRole("button", {
        name: /删除 输入: 数量 参数/u,
      }),
    );
    expect(
      useDocumentStore.getState().history?.document.graphs[1]?.functionSignature
        ?.inputs,
    ).toEqual([]);
  });

  it("disables every signature edit while execution is locked", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    act(() => {
      openProjectDocument(functionDocument());
      useEditorSessionStore.getState().setActiveGraph("function-graph");
      useDocumentStore.getState().setExecutionLocked(true);
    });

    const panel = signaturePanel();
    expect(
      within(panel).getByRole("textbox", { name: "函数名称" }),
    ).toBeDisabled();
    expect(
      within(panel).getByRole("button", { name: "添加输入" }),
    ).toBeDisabled();
    expect(
      within(panel).getByRole("button", { name: "添加输出" }),
    ).toBeDisabled();
  });
});
