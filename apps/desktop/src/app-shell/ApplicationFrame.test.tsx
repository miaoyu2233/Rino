import axe from "axe-core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { installInMemoryProjectService } from "../test/project-transport-double";
import { App } from "../app/App";
import { applicationI18n } from "../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import { useLayoutPreferenceStore } from "../preferences/layout-preference-store";
import { defaultLayoutPreferences } from "../preferences/layout-preferences";

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

describe("ApplicationFrame", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    installInMemoryProjectService();
    useLayoutPreferenceStore.setState({
      layout: { ...defaultLayoutPreferences },
    });
    setViewport(1280);
  });

  it("renders the five application regions without fabricated runtime data", () => {
    render(<App />);

    expect(
      screen.getByRole("complementary", { name: "节点库" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("main", { name: "图编辑画布" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "工作台" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "调试" })).toBeInTheDocument();
    expect(screen.getAllByText("设备后端未配置").length).toBeGreaterThan(0);
    // The palette lists the development node definitions, which are real registry
    // content rather than invented runtime state.
    expect(screen.getByRole("button", { name: /流程/ })).toBeInTheDocument();
  });

  it("opens and filters the shortcut reference with user interactions", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    const dialog = screen.getByRole("dialog", { name: "设置" });
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole("tab", { name: "快捷键" }));
    expect(within(dialog).getByText("快捷键参考")).toBeInTheDocument();

    await user.type(
      within(dialog).getByPlaceholderText("搜索快捷键"),
      "单步跳过",
    );
    expect(within(dialog).getByText("单步跳过")).toBeInTheDocument();
    expect(within(dialog).queryByText("保存项目")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("button", { name: "打开设置" })).toHaveFocus();
  });

  it("dispatches active shortcuts and preserves text input behavior", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "打开设置" }));
    const dialog = screen.getByRole("dialog", { name: "设置" });
    await user.click(within(dialog).getByRole("tab", { name: "快捷键" }));
    const searchInput = within(dialog).getByPlaceholderText("搜索快捷键");

    fireEvent.keyDown(searchInput, { key: "/", ctrlKey: true });
    expect(within(dialog).getByText("快捷键参考")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "关闭" }));
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();
  });

  it("supports collapsible and narrow-window panel access", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    const palette = screen.getByRole("complementary", { name: "节点库" });

    await user.click(within(palette).getByRole("button", { name: "折叠" }));
    expect(useLayoutPreferenceStore.getState().layout.paletteCollapsed).toBe(
      true,
    );
    expect(
      screen.getByRole("button", { name: "打开节点库" }),
    ).toBeInTheDocument();

    unmount();
    useLayoutPreferenceStore.setState({
      layout: { ...defaultLayoutPreferences },
    });
    setViewport(800, 700);
    render(<App />);

    expect(document.querySelector(".application-frame")).toHaveAttribute(
      "data-layout-mode",
      "narrow",
    );
    await user.click(screen.getByRole("button", { name: "打开节点库" }));
    expect(screen.getByRole("dialog", { name: "节点库" })).toBeInTheDocument();
  });

  it("switches between workbench and inspector via persistent right rail buttons", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Initially active tab is device ("工作台")
    expect(
      screen.getByRole("complementary", { name: "工作台" }),
    ).toBeInTheDocument();

    // Click the 2nd button on the right rail ("属性")
    const workbenchRail = screen.getByRole("complementary", {
      name: "打开工作台",
    });
    const inspectorRailButton = within(workbenchRail).getByRole("button", {
      name: "属性",
    });
    await user.click(inspectorRailButton);

    expect(useLayoutPreferenceStore.getState().layout.activeRightTab).toBe(
      "inspector",
    );
    expect(
      screen.getByRole("complementary", { name: "属性" }),
    ).toBeInTheDocument();

    const functionRailButton = within(workbenchRail).getByRole("button", {
      name: "函数库",
    });
    await user.click(functionRailButton);
    expect(useLayoutPreferenceStore.getState().layout.activeRightTab).toBe(
      "functions",
    );
    expect(
      screen.getByRole("complementary", { name: "函数库" }),
    ).toBeInTheDocument();

    const variablesRailButton = within(workbenchRail).getByRole("button", {
      name: "整个项目共享变量",
    });
    await user.click(variablesRailButton);
    expect(useLayoutPreferenceStore.getState().layout.activeRightTab).toBe(
      "variables",
    );
    expect(
      screen.getByRole("complementary", { name: "整个项目共享变量" }),
    ).toBeInTheDocument();

    // Click the active rail button again to collapse
    await user.click(variablesRailButton);
    expect(useLayoutPreferenceStore.getState().layout.rightCollapsed).toBe(
      true,
    );
    expect(
      screen.queryByRole("complementary", { name: "属性" }),
    ).not.toBeInTheDocument();

    // Click 1st rail button ("工作台") to expand device workbench again
    const workbenchRailButton = screen.getByRole("button", { name: "工作台" });
    await user.click(workbenchRailButton);
    expect(useLayoutPreferenceStore.getState().layout.rightCollapsed).toBe(
      false,
    );
    expect(useLayoutPreferenceStore.getState().layout.activeRightTab).toBe(
      "device",
    );
    expect(
      screen.getByRole("complementary", { name: "工作台" }),
    ).toBeInTheDocument();
  });

  it("floats and restores the workbench while preserving the active tab", async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.contextMenu(
      screen.getByRole("complementary", { name: "工作台" }),
      { clientX: 1180, clientY: 160 },
    );
    await user.click(screen.getByRole("menuitem", { name: "浮动工作台" }));

    expect(useLayoutPreferenceStore.getState().layout.rightWorkbenchMode).toBe(
      "floating",
    );
    expect(
      document.querySelector(".floating-workbench-panel"),
    ).toBeInTheDocument();

    const rail = screen.getByRole("complementary", {
      name: "打开工作台",
    });
    await user.click(within(rail).getByRole("button", { name: "函数库" }));
    expect(useLayoutPreferenceStore.getState().layout.activeRightTab).toBe(
      "functions",
    );
    expect(useLayoutPreferenceStore.getState().layout.rightCollapsed).toBe(
      false,
    );

    const floatingPanel = document.querySelector<HTMLElement>(
      ".floating-workbench-panel",
    );
    expect(floatingPanel).not.toBeNull();
    fireEvent.contextMenu(floatingPanel as HTMLElement, {
      clientX: 1180,
      clientY: 160,
    });
    await user.click(screen.getByRole("menuitem", { name: "工作台归位" }));
    expect(useLayoutPreferenceStore.getState().layout.rightWorkbenchMode).toBe(
      "docked",
    );
    expect(
      document.querySelector(".floating-workbench-panel"),
    ).not.toBeInTheDocument();
  });

  it("has no detectable structural accessibility violations", async () => {
    render(<App />);

    const result = await axe.run(document.body, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });
    expect(result.violations).toEqual([]);
  });
});
