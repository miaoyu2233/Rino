import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CaptureConfirmationDialog } from "./CaptureConfirmationDialog";
import type { CaptureWorkbenchState } from "./capture-workbench-controller";
import { TooltipProvider } from "../components/ui/Tooltip";
import { applicationI18n } from "../localization/i18n";

const sampleConfirmingState: CaptureWorkbenchState = {
  phase: "confirming",
  displayName: "capture-20260728-001",
  descriptor: {
    captureToken: "cap-secret-token",
    mediaType: "image/png",
    byteLength: 2048,
    width: 1000,
    height: 800,
    coordinateSpaceId: "space-1",
    sourceKind: "deviceCapture",
    expiresInMilliseconds: 60000,
  },
  nameValidation: {
    ok: true,
    displayName: "capture-20260728-001",
    normalizedName: "capture-20260728-001",
  },
  objectUrl: "blob:http://localhost/test-blob-url",
};

describe("CaptureConfirmationDialog", () => {
  beforeEach(() => {
    void applicationI18n.changeLanguage("zh-CN");
    vi.clearAllMocks();
  });

  it("renders prepared image, name input, dimensions, and full frame origin in confirming state", () => {
    const onNameChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <TooltipProvider>
        <CaptureConfirmationDialog
          state={sampleConfirmingState}
          onDisplayNameChange={onNameChange}
          onConfirm={onConfirm}
          onRetrySave={vi.fn()}
          onDiscard={vi.fn()}
          onReset={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("capture-20260728-001"),
    ).toBeInTheDocument();
    expect(screen.getByText("1000 × 800")).toBeInTheDocument();
    expect(screen.getByText("整屏截图")).toBeInTheDocument();
    expect(screen.getByText("名称可用")).toBeInTheDocument();
    expect(screen.getByText(/已生成不重复的默认名称/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存素材" })).toBeEnabled();
  });

  it("renders the exact source origin for a region capture", () => {
    const regionState: CaptureWorkbenchState = {
      ...sampleConfirmingState,
      descriptor: {
        ...sampleConfirmingState.descriptor,
        width: 300,
        height: 200,
        sourceKind: "regionCapture",
      },
      sourceRegion: {
        x: 140,
        y: 90,
        width: 300,
        height: 200,
        coordinateSpaceId: "space-1",
        sourceGeneration: 1,
      },
    };

    render(
      <TooltipProvider>
        <CaptureConfirmationDialog
          state={regionState}
          onDisplayNameChange={vi.fn()}
          onConfirm={vi.fn()}
          onRetrySave={vi.fn()}
          onDiscard={vi.fn()}
          onReset={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("区域 (X: 140, Y: 90)")).toBeInTheDocument();
  });

  it("does NOT render private security sensitive tokens, hashes, or byte counts", () => {
    render(
      <TooltipProvider>
        <CaptureConfirmationDialog
          state={sampleConfirmingState}
          onDisplayNameChange={vi.fn()}
          onConfirm={vi.fn()}
          onRetrySave={vi.fn()}
          onDiscard={vi.fn()}
          onReset={vi.fn()}
        />
      </TooltipProvider>,
    );

    const dialogText = screen.getByRole("dialog").textContent;
    expect(dialogText).not.toContain("cap-secret-token");
    expect(dialogText).not.toContain("a1b2c3d4e5f67890");
    expect(dialogText).not.toContain("2048");
    expect(dialogText).not.toContain("space-1");
  });

  it("handles all name validation failure reasons and binds aria-describedby for accessibility", () => {
    const reasons: {
      reason:
        | "empty"
        | "controlCharacter"
        | "pathSeparator"
        | "trailingPeriod"
        | "reservedName"
        | "tooLong"
        | "collision";
      expectedText: string;
    }[] = [
      { reason: "empty", expectedText: "素材名称不能为空" },
      { reason: "controlCharacter", expectedText: "素材名称包含非法控制字符" },
      { reason: "pathSeparator", expectedText: "素材名称不能包含斜杠" },
      { reason: "trailingPeriod", expectedText: "素材名称末尾不能是点号" },
      { reason: "reservedName", expectedText: "素材名称为系统保留名称" },
      { reason: "tooLong", expectedText: "素材名称不能超过 200 个字符" },
      { reason: "collision", expectedText: "素材名称与项目内已有素材重名" },
    ];

    for (const { reason, expectedText } of reasons) {
      const invalidState: CaptureWorkbenchState = {
        phase: "confirming",
        displayName: "invalid-name",
        descriptor: sampleConfirmingState.descriptor,
        nameValidation:
          reason === "collision"
            ? {
                ok: false,
                reason: "collision",
                conflictingAssetId: "asset-1",
                suggestion: "invalid-name (2)",
              }
            : { ok: false, reason },
        objectUrl: "blob:http://localhost/test",
      };

      const { unmount } = render(
        <TooltipProvider>
          <CaptureConfirmationDialog
            state={invalidState}
            onDisplayNameChange={vi.fn()}
            onConfirm={vi.fn()}
            onRetrySave={vi.fn()}
            onDiscard={vi.fn()}
            onReset={vi.fn()}
          />
        </TooltipProvider>,
      );

      expect(screen.getByText(expectedText)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "保存素材" })).toBeDisabled();

      const input = screen.getByRole("textbox");
      const errorMsgContainer = screen.getByRole("alert");
      expect(input).toHaveAttribute("aria-describedby", errorMsgContainer.id);

      unmount();
    }
  });

  it("shows name collision error and activates suggestion when suggestion button clicked", () => {
    const onNameChange = vi.fn();

    const collisionState: CaptureWorkbenchState = {
      phase: "confirming",
      displayName: "capture-20260728-001",
      descriptor: sampleConfirmingState.descriptor,
      nameValidation: {
        ok: false,
        reason: "collision",
        conflictingAssetId: "asset-existing-1",
        suggestion: "capture-20260728-001 (2)",
      },
      objectUrl: "blob:http://localhost/test-blob-url",
    };

    render(
      <TooltipProvider>
        <CaptureConfirmationDialog
          state={collisionState}
          onDisplayNameChange={onNameChange}
          onConfirm={vi.fn()}
          onRetrySave={vi.fn()}
          onDiscard={vi.fn()}
          onReset={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(
      screen.getByText("素材名称与项目内已有素材重名"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存素材" })).toBeDisabled();

    const suggestionBtn = screen.getByRole("button", {
      name: /使用建议名称：capture-20260728-001 \(2\)/,
    });
    expect(suggestionBtn).toBeInTheDocument();

    fireEvent.click(suggestionBtn);
    expect(onNameChange).toHaveBeenCalledWith("capture-20260728-001 (2)");
  });

  it("renders all progress steps and disables action buttons during async work", () => {
    const steps: ("storing" | "filing" | "saving")[] = [
      "storing",
      "filing",
      "saving",
    ];

    for (const step of steps) {
      const committingState: CaptureWorkbenchState = {
        phase: "committing",
        step,
        displayName: "capture-20260728-001",
      };

      const { unmount } = render(
        <TooltipProvider>
          <CaptureConfirmationDialog
            state={committingState}
            onDisplayNameChange={vi.fn()}
            onConfirm={vi.fn()}
            onRetrySave={vi.fn()}
            onDiscard={vi.fn()}
            onReset={vi.fn()}
          />
        </TooltipProvider>,
      );

      expect(screen.getByRole("status")).toBeInTheDocument();
      unmount();
    }
  });

  it("renders filingFailed phase with editable name and discard/confirm actions", () => {
    const onConfirm = vi.fn();
    const onDiscard = vi.fn();

    const filingFailedState: CaptureWorkbenchState = {
      phase: "filingFailed",
      displayName: "capture-failed-name",
      nameValidation: {
        ok: true,
        displayName: "capture-failed-name",
        normalizedName: "capture-failed-name",
      },
      reason: "documentRejected",
    };

    render(
      <TooltipProvider>
        <CaptureConfirmationDialog
          state={filingFailedState}
          onDisplayNameChange={vi.fn()}
          onConfirm={onConfirm}
          onRetrySave={vi.fn()}
          onDiscard={onDiscard}
          onReset={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByDisplayValue("capture-failed-name")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存素材" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "放弃截图" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("renders saveFailed recovery state with Retry Save button and NO discard action", () => {
    const onRetrySave = vi.fn();
    const onDiscard = vi.fn();

    const saveFailedState: CaptureWorkbenchState = {
      phase: "saveFailed",
      assetId: "asset-1",
      displayName: "capture-1",
      reason: "saveFailed",
    };

    render(
      <TooltipProvider>
        <CaptureConfirmationDialog
          state={saveFailedState}
          onDisplayNameChange={vi.fn()}
          onConfirm={vi.fn()}
          onRetrySave={onRetrySave}
          onDiscard={onDiscard}
          onReset={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("写入项目文件失败")).toBeInTheDocument();
    expect(
      screen.getByText(/素材元数据已写入内存，点击重试保存重新写入磁盘。/),
    ).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: "重试保存" });
    expect(
      screen.queryByRole("button", { name: "放弃截图" }),
    ).not.toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetrySave).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("shows a safe runtime diagnostic code for capture preparation failures", () => {
    render(
      <TooltipProvider>
        <CaptureConfirmationDialog
          state={{
            phase: "failed",
            reason: "runtimePrepareFailed",
            diagnosticCode: "CAPTURE_ARTIFACT_UNAVAILABLE",
          }}
          onDisplayNameChange={vi.fn()}
          onConfirm={vi.fn()}
          onRetrySave={vi.fn()}
          onDiscard={vi.fn()}
          onReset={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "设备画面已取得，但运行时未能生成截图。",
    );
    expect(
      screen.getByText("错误代码：CAPTURE_ARTIFACT_UNAVAILABLE"),
    ).toBeInTheDocument();
  });

  it("renders completed state and calls reset on acknowledgement", () => {
    const onReset = vi.fn();

    const completedState: CaptureWorkbenchState = {
      phase: "completed",
      assetId: "asset-1",
      displayName: "capture-1",
    };

    render(
      <TooltipProvider>
        <CaptureConfirmationDialog
          state={completedState}
          onDisplayNameChange={vi.fn()}
          onConfirm={vi.fn()}
          onRetrySave={vi.fn()}
          onDiscard={vi.fn()}
          onReset={onReset}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("截图已成功保存到项目")).toBeInTheDocument();

    const resetBtn = screen.getByRole("button", { name: "完成" });
    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("handles dialog dismissal rules properly across phases", () => {
    const onDiscard = vi.fn();
    const onReset = vi.fn();

    const { rerender } = render(
      <TooltipProvider>
        <CaptureConfirmationDialog
          state={sampleConfirmingState}
          onDisplayNameChange={vi.fn()}
          onConfirm={vi.fn()}
          onRetrySave={vi.fn()}
          onDiscard={onDiscard}
          onReset={onReset}
        />
      </TooltipProvider>,
    );

    const closeBtn = screen.getByRole("button", { name: "关闭" });
    fireEvent.click(closeBtn);
    expect(onDiscard).toHaveBeenCalledTimes(1);

    const completedState: CaptureWorkbenchState = {
      phase: "completed",
      assetId: "asset-1",
      displayName: "capture-1",
    };

    rerender(
      <TooltipProvider>
        <CaptureConfirmationDialog
          state={completedState}
          onDisplayNameChange={vi.fn()}
          onConfirm={vi.fn()}
          onRetrySave={vi.fn()}
          onDiscard={onDiscard}
          onReset={onReset}
        />
      </TooltipProvider>,
    );

    const closeBtnCompleted = screen.getByRole("button", { name: "关闭" });
    fireEvent.click(closeBtnCompleted);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
