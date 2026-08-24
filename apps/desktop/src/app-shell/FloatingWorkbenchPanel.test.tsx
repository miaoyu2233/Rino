import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import { TooltipProvider } from "../components/ui/Tooltip";
import { applicationI18n } from "../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import {
  FloatingWorkbenchPanel,
  WorkbenchContextMenu,
} from "./FloatingWorkbenchPanel";
import type { FloatingWorkbenchGeometry } from "./floating-workbench-geometry";

vi.mock("./RightWorkbench", () => ({
  RightWorkbench: ({ activeTab }: { activeTab: string }) => (
    <div data-testid="mock-right-workbench">{activeTab}</div>
  ),
}));

const viewport = { width: 1280, height: 800, scaleFactor: 1 };
const geometry: FloatingWorkbenchGeometry = {
  x: 24,
  y: 64,
  width: 360,
  height: 520,
};

function renderWithI18n(ui: ReactElement) {
  return render(
    <TooltipProvider>
      <I18nextProvider i18n={applicationI18n}>{ui}</I18nextProvider>
    </TooltipProvider>,
  );
}

describe("WorkbenchContextMenu", () => {
  beforeEach(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
  });

  it("floats a docked workbench and does not intercept form controls", () => {
    const onFloat = vi.fn();
    renderWithI18n(
      <WorkbenchContextMenu mode="docked" onFloat={onFloat}>
        <div data-testid="target">
          <input aria-label="编辑" />
        </div>
      </WorkbenchContextMenu>,
    );

    fireEvent.contextMenu(screen.getByLabelText("编辑"), {
      clientX: 120,
      clientY: 80,
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId("target"), {
      clientX: 120,
      clientY: 80,
    });
    expect(
      screen.getByRole("menuitem", { name: "浮动工作台" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "浮动工作台" }));
    expect(onFloat).toHaveBeenCalledTimes(1);
  });

  it("offers a keyboard-operable dock action for a floating workbench", async () => {
    const user = userEvent.setup();
    const onDock = vi.fn();
    renderWithI18n(
      <WorkbenchContextMenu mode="floating" onDock={onDock}>
        <div data-testid="target" />
      </WorkbenchContextMenu>,
    );

    fireEvent.contextMenu(screen.getByTestId("target"), {
      clientX: 1279,
      clientY: 799,
    });
    const menuItem = screen.getByRole("menuitem", { name: "工作台归位" });
    expect(menuItem).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onDock).toHaveBeenCalledTimes(1);
  });
});

describe("FloatingWorkbenchPanel", () => {
  beforeEach(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
  });

  it("commits drag and resize geometry only when the pointer interaction ends", () => {
    const onGeometryCommit = vi.fn();
    renderWithI18n(
      <FloatingWorkbenchPanel
        activeTab="device"
        geometry={geometry}
        metrics={viewport}
        onActiveTabChange={vi.fn()}
        onDock={vi.fn()}
        onGeometryCommit={onGeometryCommit}
        onPreviewRatioChange={vi.fn()}
        previewRatio={0.5}
      />,
    );

    const header = screen.getByLabelText("拖动工作台");
    fireEvent.pointerDown(header, {
      button: 0,
      clientX: 40,
      clientY: 80,
    });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 120 });
    expect(onGeometryCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 80, clientY: 120 });
    expect(onGeometryCommit).toHaveBeenLastCalledWith({
      ...geometry,
      x: 64,
      y: 104,
    });

    onGeometryCommit.mockClear();
    const resizeHandles = screen.getAllByRole("separator", {
      name: "调整工作台大小",
    });
    const resizeHandle = resizeHandles[2];
    if (resizeHandle === undefined) {
      throw new Error("The corner resize handle is missing.");
    }
    fireEvent.pointerDown(resizeHandle, {
      button: 0,
      clientX: 384,
      clientY: 584,
    });
    fireEvent.pointerMove(window, { clientX: 434, clientY: 634 });
    fireEvent.pointerUp(window, { clientX: 434, clientY: 634 });
    expect(onGeometryCommit).toHaveBeenLastCalledWith({
      ...geometry,
      x: 64,
      y: 104,
      width: 410,
      height: 570,
    });
  });

  it("reclamps persisted geometry when the window becomes smaller", async () => {
    const onGeometryCommit = vi.fn();
    const { rerender } = renderWithI18n(
      <FloatingWorkbenchPanel
        activeTab="device"
        geometry={{ ...geometry, x: 800, y: 500, width: 600, height: 700 }}
        metrics={viewport}
        onActiveTabChange={vi.fn()}
        onDock={vi.fn()}
        onGeometryCommit={onGeometryCommit}
        onPreviewRatioChange={vi.fn()}
        previewRatio={0.5}
      />,
    );

    rerender(
      <TooltipProvider>
        <I18nextProvider i18n={applicationI18n}>
          <FloatingWorkbenchPanel
            activeTab="device"
            geometry={{ ...geometry, x: 800, y: 500, width: 600, height: 700 }}
            metrics={{ width: 500, height: 400, scaleFactor: 1 }}
            onActiveTabChange={vi.fn()}
            onDock={vi.fn()}
            onGeometryCommit={onGeometryCommit}
            onPreviewRatioChange={vi.fn()}
            previewRatio={0.5}
          />
        </I18nextProvider>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(onGeometryCommit).toHaveBeenLastCalledWith({
        x: 0,
        y: 0,
        width: 500,
        height: 400,
      });
    });
  });
});
