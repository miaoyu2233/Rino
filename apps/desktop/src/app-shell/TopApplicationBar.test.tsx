import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/Tooltip";
import { applicationI18n } from "../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import {
  TopApplicationBar,
  type GraphExecutionControls,
} from "./TopApplicationBar";
import type { ProjectCommands } from "../graph/project/useProjectCommands";
import { useDocumentStore } from "../graph/store/document-store";
import { createEmptyProject } from "../graph/project-factory";

const mockExecution: GraphExecutionControls = {
  cancelRun: vi.fn(),
  canCancel: false,
  canRun: true,
  run: undefined,
  runGraph: vi.fn(),
};

const mockProjectCommands: ProjectCommands = {
  busy: false,
  dirty: false,
  hasDocument: true,
  location: {
    directoryName: "Demo",
    displayPath: "C:\\Projects\\Demo",
  },
  requestNewProject: vi.fn(),
  requestOpenProject: vi.fn(),
  requestCloseProject: vi.fn(),
  save: vi.fn(),
  saveAs: vi.fn(),
  pendingIntent: undefined,
  saveThenContinue: vi.fn(),
  discardThenContinue: vi.fn(),
  cancelPendingIntent: vi.fn(),
  recovery: undefined,
  restoreRecovery: vi.fn(),
  dismissRecovery: vi.fn(),
};

describe("TopApplicationBar", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    const doc = createEmptyProject({
      name: "示例项目",
      entryGraphName: "Main",
      createdAt: "2026-01-01T00:00:00Z",
    });
    useDocumentStore.getState().openDocument(doc);
  });

  it("renders toolbar regions and discloses project location via focusable Tooltip", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <TopApplicationBar
          execution={mockExecution}
          onOpenPalette={vi.fn()}
          onOpenPublishing={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenWorkbench={vi.fn()}
          projectCommands={mockProjectCommands}
          showCompactPanels={false}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Rino")).toBeInTheDocument();

    const projectIdentity = screen
      .getByText("示例项目")
      .closest(".project-identity");
    expect(projectIdentity).not.toBeNull();
    if (!projectIdentity) {
      throw new Error("Project identity element not found");
    }
    expect(projectIdentity).toHaveAttribute("tabindex", "0");

    await user.hover(projectIdentity);
    expect(
      (await screen.findAllByText("项目位置：C:\\Projects\\Demo")).length,
    ).toBeGreaterThan(0);
  });

  it("opens signed package export and publishing from the project action group", async () => {
    const user = userEvent.setup();
    const onOpenPublishing = vi.fn();
    render(
      <TooltipProvider>
        <TopApplicationBar
          execution={mockExecution}
          onOpenPalette={vi.fn()}
          onOpenPublishing={onOpenPublishing}
          onOpenSettings={vi.fn()}
          onOpenWorkbench={vi.fn()}
          projectCommands={mockProjectCommands}
          showCompactPanels={false}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "导出与发布" }));
    expect(onOpenPublishing).toHaveBeenCalledOnce();
  });

  it("opens the screenshot library and exposes project images as draggable canvas assets", async () => {
    const user = userEvent.setup();
    useDocumentStore.getState().runCommand("graph.history.addAsset", {
      kind: "addAsset",
      asset: {
        assetId: "2d87a2f4-37d0-46e8-9f44-1f2db9f97e71",
        displayName: "战斗区域-001",
        contentHash: "a".repeat(64),
        mediaType: "image/png",
        byteLength: 128,
        coordinateSpace: {
          spaceId: "capture-space",
          width: 1280,
          height: 720,
        },
        sourceKind: "regionCapture",
        createdAt: "2026-07-29T12:00:00.000Z",
      },
    });
    render(
      <TooltipProvider>
        <TopApplicationBar
          execution={mockExecution}
          onOpenPalette={vi.fn()}
          onOpenPublishing={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenWorkbench={vi.fn()}
          projectCommands={mockProjectCommands}
          showCompactPanels={false}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "打开截图素材库" }));

    const asset = screen.getByRole("button", { name: /战斗区域-001/ });
    expect(asset).toHaveAttribute("draggable", "true");
    expect(screen.getByText("1280 × 720", { exact: false })).toBeVisible();
  });

  it("renders run and stop controls with appropriate shortcuts and primary variant for executable run", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <TopApplicationBar
          execution={mockExecution}
          onOpenPalette={vi.fn()}
          onOpenPublishing={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenWorkbench={vi.fn()}
          projectCommands={mockProjectCommands}
          showCompactPanels={false}
        />
      </TooltipProvider>,
    );

    const runButton = screen.getByRole("button", { name: "运行图" });
    expect(runButton).toBeEnabled();

    await user.hover(runButton);
    expect((await screen.findAllByText("F5")).length).toBeGreaterThan(0);
  });

  it("renders enabled stop control when execution can be cancelled and calls cancelRun on click", async () => {
    const user = userEvent.setup();
    const cancelRun = vi.fn();
    const canCancelExecution: GraphExecutionControls = {
      ...mockExecution,
      canCancel: true,
      cancelRun,
    };
    render(
      <TooltipProvider>
        <TopApplicationBar
          execution={canCancelExecution}
          onOpenPalette={vi.fn()}
          onOpenPublishing={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenWorkbench={vi.fn()}
          projectCommands={mockProjectCommands}
          showCompactPanels={false}
        />
      </TooltipProvider>,
    );

    const stopButton = screen.getByRole("button", { name: "停止运行" });
    expect(stopButton).toBeEnabled();

    await user.hover(stopButton);
    expect((await screen.findAllByText("停止运行")).length).toBeGreaterThan(0);

    await user.click(stopButton);
    expect(cancelRun).toHaveBeenCalledOnce();
  });

  it("renders disabled stop control with unavailable tooltip when execution cannot be cancelled", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <TopApplicationBar
          execution={mockExecution}
          onOpenPalette={vi.fn()}
          onOpenPublishing={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenWorkbench={vi.fn()}
          projectCommands={mockProjectCommands}
          showCompactPanels={false}
        />
      </TooltipProvider>,
    );

    const stopButton = screen.getByRole("button", { name: "停止运行" });
    expect(stopButton).toBeDisabled();

    const trigger = stopButton.closest(".icon-action__disabled-trigger");
    expect(trigger).not.toBeNull();
    if (!trigger) {
      throw new Error("Trigger element not found");
    }

    await user.hover(trigger);
    expect(
      (await screen.findAllByText("当前没有正在运行的图。")).length,
    ).toBeGreaterThan(0);
  });
});
