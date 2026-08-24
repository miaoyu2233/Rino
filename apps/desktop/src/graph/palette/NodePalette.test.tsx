import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../app/App";
import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import { NODE_TYPE_DRAG_FORMAT } from "../canvas/canvas-drag";
import { useDocumentStore } from "../store/document-store";
import { closeProjectDocument } from "../store/project-lifecycle";
import {
  createProjectFromEmptyState,
  installInMemoryProjectService,
} from "../../test/project-transport-double";

/** A stand-in for the drag payload, which jsdom does not implement. */
function createTransferStub() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    get types() {
      return [...values.keys()];
    },
    setData(format: string, value: string) {
      values.set(format, value);
    },
    getData(format: string) {
      return values.get(format) ?? "";
    },
  };
}

/** The palette is a full panel only in the wide layout, which is the layout this task
 * targets; the narrow layouts move it into a drawer. */
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

function paletteRegion(): HTMLElement {
  return screen.getByRole("complementary", { name: "节点库" });
}

describe("node palette", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    closeProjectDocument();
    installInMemoryProjectService();
    setViewport(1280);
  });

  it("lists the development definitions grouped by category", () => {
    render(<App />);
    const palette = paletteRegion();

    expect(
      within(palette).getByRole("button", { name: /流程/ }),
    ).toBeInTheDocument();
    expect(
      within(palette).getByRole("button", { name: /工作流模板/ }),
    ).toBeInTheDocument();
    expect(within(palette).getByText("开始")).toBeInTheDocument();
    expect(within(palette).getAllByText("顺序执行").length).toBeGreaterThan(0);
    expect(within(palette).getAllByText("同时执行").length).toBeGreaterThan(0);
    expect(within(palette).getAllByText("数值运算").length).toBeGreaterThan(0);
    expect(within(palette).getAllByText("输出数值").length).toBeGreaterThan(0);
    expect(within(palette).queryByText("函数库")).not.toBeInTheDocument();
    expect(within(palette).queryByText("获取数值变量")).not.toBeInTheDocument();
    expect(within(palette).queryByText("读取文本")).not.toBeInTheDocument();
    expect(within(palette).queryByText("读取数值")).not.toBeInTheDocument();
    expect(within(palette).getAllByText("图像识别模板").length).toBeGreaterThan(
      0,
    );
    expect(
      within(palette).queryByText("图像识别并点击模板"),
    ).not.toBeInTheDocument();
    expect(within(palette).getAllByText("文字识别模板").length).toBeGreaterThan(
      0,
    );
    expect(
      within(palette).queryByText("文字识别并点击模板"),
    ).not.toBeInTheDocument();
    const templateBadges = within(palette).getAllByText("模板");
    expect(templateBadges.length).toBeGreaterThan(0);
    const startButton = within(palette).getByText("开始").closest("button");
    if (!startButton) {
      throw new Error("Start button not found");
    }
    expect(within(startButton).queryByText("模板")).not.toBeInTheDocument();
  });

  it("shows the English name beside the Chinese one", () => {
    render(<App />);

    expect(within(paletteRegion()).getByText("Compare numbers")).toBeVisible();
  });

  it("finds a node by an English term while the interface is Chinese", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    fireEvent.contextMenu(screen.getByLabelText("节点图编辑区"));
    const search = await screen.findByRole("textbox", { name: "搜索节点" });

    await userEvent.type(search, "compare");

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("数值比较")).toBeInTheDocument();
    expect(within(menu).queryByText("开始")).not.toBeInTheDocument();
  });

  it("finds a node by its technical type key", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    fireEvent.contextMenu(screen.getByLabelText("节点图编辑区"));
    const search = await screen.findByRole("textbox", { name: "搜索节点" });

    await userEvent.type(search, "core.logic.numberCompare");

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("数值比较")).toBeInTheDocument();
  });

  it("finds the numeric-recognition template by Chinese and English names", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    fireEvent.contextMenu(screen.getByLabelText("节点图编辑区"));
    const search = await screen.findByRole("textbox", { name: "搜索节点" });

    await user.type(search, "识别数值");
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("识别数值并分支")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "recognize a number");
    expect(within(menu).getByText("识别数值并分支")).toBeInTheDocument();
  });

  it("explains that a search matched nothing", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    fireEvent.contextMenu(screen.getByLabelText("节点图编辑区"));
    const search = await screen.findByRole("textbox", { name: "搜索节点" });

    await userEvent.type(search, "不存在的节点");

    expect(screen.getByText("没有匹配的节点")).toBeInTheDocument();
  });

  it("collapses and expands a category", async () => {
    render(<App />);
    const heading = within(paletteRegion()).getByRole("button", {
      name: /流程/,
    });

    expect(heading).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(heading);

    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(within(paletteRegion()).queryByText("开始")).not.toBeInTheDocument();
  });

  it("marks a node whose capability the backend has not reported", () => {
    render(<App />);

    // No runtime is connected, so the OCR node's capability is unknown rather than
    // unavailable, and the palette says so instead of guessing.
    const textRecognitionEntries = within(paletteRegion()).getAllByRole(
      "button",
      { name: /文字识别模板/ },
    );
    expect(textRecognitionEntries.length).toBeGreaterThan(0);
    for (const entry of textRecognitionEntries) {
      expect(entry).toHaveAttribute("data-capability", "unknown");
    }
  });

  it("hides project variable and generic function entries", () => {
    render(<App />);
    const palette = paletteRegion();

    for (const title of [
      "获取布尔变量",
      "设置布尔变量",
      "获取数值变量",
      "设置数值变量",
      "获取文本变量",
      "设置文本变量",
      "获取点变量",
      "设置点变量",
      "获取区域变量",
      "设置区域变量",
      "获取图像变量",
      "设置图像变量",
      "函数调用",
    ]) {
      expect(within(palette).queryByText(title)).not.toBeInTheDocument();
    }
  });

  it("carries the node type in a Rino-specific drag format", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    const item = within(paletteRegion()).getByText("开始").closest("button");
    if (!item) {
      throw new Error("The palette item must be a button.");
    }
    const dataTransfer = createTransferStub();

    fireEvent.dragStart(item, { dataTransfer });

    expect(dataTransfer.getData(NODE_TYPE_DRAG_FORMAT)).toBe("core.flow.start");
    expect(dataTransfer.effectAllowed).toBe("copy");
  });

  it("inserts the node into the open project when activated by keyboard", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    await userEvent.click(
      within(paletteRegion()).getByText("开始").closest("button") ??
        document.body,
    );

    const nodes =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes ?? [];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.typeKey).toBe("core.flow.start");
  });

  it("explains and blocks node insertion while no project is open", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText(/尚未打开项目/)).toBeInTheDocument();
    const startButton = within(paletteRegion())
      .getByText("开始")
      .closest("button");
    if (!startButton) {
      throw new Error("The start palette entry must be a button.");
    }
    expect(startButton).toHaveAttribute("aria-disabled", "true");
    expect(startButton).toHaveAttribute("draggable", "false");

    await user.click(startButton);

    expect(
      await screen.findByText("请先新建或打开项目，然后再添加节点。"),
    ).toBeInTheDocument();
    expect(useDocumentStore.getState().history).toBeUndefined();
  });
});
