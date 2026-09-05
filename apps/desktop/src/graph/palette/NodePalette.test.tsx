import {
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
import {
  createProjectFromEmptyState,
  installInMemoryProjectService,
} from "../../test/project-transport-double";
import { NODE_TYPE_DRAG_FORMAT } from "../canvas/canvas-drag";
import { useDocumentStore } from "../store/document-store";
import { closeProjectDocument } from "../store/project-lifecycle";

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

function openCategory(buttonName: RegExp, categoryName: string): HTMLElement {
  const heading = within(paletteRegion()).getByRole("button", {
    name: buttonName,
  });
  fireEvent.pointerEnter(heading);
  return screen.getByRole("region", { name: categoryName });
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

  it("shows categories first and opens their nodes in a separate hover flyout", () => {
    render(<App />);
    const palette = paletteRegion();

    expect(
      within(palette).getByRole("button", { name: /流程/ }),
    ).toBeInTheDocument();
    expect(
      within(palette).getByRole("button", { name: /工作流模板/ }),
    ).toBeInTheDocument();
    expect(within(palette).queryByText("开始")).not.toBeInTheDocument();

    const flowFlyout = openCategory(/流程/, "流程");
    expect(within(flowFlyout).getByText("开始")).toBeInTheDocument();
    expect(within(flowFlyout).getAllByText("顺序执行").length).toBeGreaterThan(
      0,
    );
    expect(within(flowFlyout).getAllByText("同时执行").length).toBeGreaterThan(
      0,
    );
    const timingFlyout = openCategory(/时间/, "时间");
    expect(within(timingFlyout).getByText("限时重复尝试")).toBeInTheDocument();
    expect(
      applicationI18n.t("node.core.flow.boundedRetry.description"),
    ).toContain("开始尝试");

    const visionFlyout = openCategory(/视觉识别/, "视觉识别");
    expect(
      within(visionFlyout).getAllByText("图像识别模板").length,
    ).toBeGreaterThan(0);
    expect(
      within(visionFlyout).queryByText("图像识别并点击模板"),
    ).not.toBeInTheDocument();
    expect(
      within(visionFlyout).getAllByText("文字识别模板").length,
    ).toBeGreaterThan(0);
    expect(
      within(visionFlyout).queryByText("文字识别并点击模板"),
    ).not.toBeInTheDocument();

    const templateFlyout = openCategory(/工作流模板/, "工作流模板");
    expect(
      within(templateFlyout).getByText("识别数值并分支"),
    ).toBeInTheDocument();
    expect(within(templateFlyout).getAllByText("模板").length).toBeGreaterThan(
      0,
    );
  });

  it("opens a category from the keyboard and returns focus with Escape", async () => {
    render(<App />);
    const heading = within(paletteRegion()).getByRole("button", {
      name: /流程/,
    });

    expect(heading).toHaveAttribute("aria-expanded", "false");
    heading.focus();
    fireEvent.keyDown(heading, { key: "ArrowRight" });

    const flyout = screen.getByRole("region", { name: "流程" });
    const firstEntry = within(flyout).getAllByRole("button")[0];
    await waitFor(() => {
      expect(firstEntry).toHaveFocus();
    });
    expect(heading).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(flyout, { key: "Escape" });

    expect(
      screen.queryByRole("region", { name: "流程" }),
    ).not.toBeInTheDocument();
    expect(heading).toHaveFocus();
  });

  it("shows the English name beside the Chinese one", () => {
    render(<App />);

    expect(
      within(openCategory(/逻辑/, "逻辑")).getByText("Compare numbers"),
    ).toBeVisible();
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

  it("marks a node whose capability the backend has not reported", () => {
    render(<App />);

    const textRecognitionEntries = within(
      openCategory(/视觉识别/, "视觉识别"),
    ).getAllByRole("button", { name: /文字识别模板/ });
    expect(textRecognitionEntries.length).toBeGreaterThan(0);
    for (const entry of textRecognitionEntries) {
      expect(entry).toHaveAttribute("data-capability", "unknown");
    }
  });

  it("hides project variable and generic function entries", () => {
    render(<App />);
    const valueFlyout = openCategory(/数值/, "数值");

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
      expect(within(valueFlyout).queryByText(title)).not.toBeInTheDocument();
    }
  });

  it("carries the node type in a Rino-specific drag format", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    const item = within(openCategory(/流程/, "流程"))
      .getByText("开始")
      .closest("button");
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
      within(openCategory(/流程/, "流程"))
        .getByText("开始")
        .closest("button") ?? document.body,
    );

    const nodes =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes ?? [];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.typeKey).toBe("core.flow.start");
    expect(
      screen.queryByRole("region", { name: "流程" }),
    ).not.toBeInTheDocument();
  });

  it("explains and blocks node insertion while no project is open", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText(/尚未打开项目/)).toBeInTheDocument();
    const startButton = within(openCategory(/流程/, "流程"))
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
