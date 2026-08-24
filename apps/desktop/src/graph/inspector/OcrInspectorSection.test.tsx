import type { RuntimeValueSummaryV1 } from "@rino/contracts";
import axe from "axe-core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useRuntimeExecutionStore } from "../../ipc/runtime-execution-store";
import type { RuntimeEvent } from "../../ipc/runtime-contract";
import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import {
  installMatchingMediaQueries,
  REDUCED_MOTION_QUERY,
} from "../../test/media-queries";
import { OcrInspectorSection } from "./OcrInspectorSection";

const GRAPH_ID = "70000000-0000-4000-8000-000000000001";
const RUN_ID = "70000000-0000-4000-8000-000000000002";
const NODE_ID = "70000000-0000-4000-8000-000000000003";

function summary(
  portId: string,
  kind: RuntimeValueSummaryV1["kind"],
  preview: string,
  itemCount?: number,
): RuntimeValueSummaryV1 {
  const value: RuntimeValueSummaryV1 = {
    portId,
    generation: 1,
    kind,
    preview,
    truncated: false,
  };
  return itemCount === undefined ? value : { ...value, itemCount };
}

function applyExecution(
  state: "running" | "succeeded" | "failed",
  valueSummaries: readonly RuntimeValueSummaryV1[] = [],
  errorCode?: string,
): void {
  const event: RuntimeEvent = {
    generation: 1,
    messageType: "node.stateChanged",
    eventId: "70000000-0000-4000-8000-000000000004",
    sequence: 1,
    runId: RUN_ID,
    nodeId: NODE_ID,
    payload: {
      state,
      runSequence: 1,
      tokenId: 1,
      activationId: 1,
      valueSummaries,
      errorCode,
    },
  };
  act(() => {
    const store = useRuntimeExecutionStore.getState();
    store.beginRun(GRAPH_ID, 1);
    store.acceptRun(
      {
        accepted: true,
        runId: RUN_ID,
        graphId: GRAPH_ID,
        registryVersion: "1.0.0",
      },
      1,
    );
    store.applyEvent(event);
  });
}

function renderSection(
  overrides: Partial<{
    roiConnected: boolean;
    effectiveConfidenceThreshold: number | undefined;
  }> = {},
) {
  return render(
    <OcrInspectorSection
      graphId={GRAPH_ID}
      nodeId={NODE_ID}
      roiConnected={overrides.roiConnected ?? false}
      effectiveConfidenceThreshold={
        Object.hasOwn(overrides, "effectiveConfidenceThreshold")
          ? overrides.effectiveConfidenceThreshold
          : 0.3
      }
    />,
  );
}

describe("OCR inspector section", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    installMatchingMediaQueries([REDUCED_MOTION_QUERY]);
    useRuntimeExecutionStore.getState().reset();
  });

  it("shows fixed method, ROI source, confidence, and an idle result", async () => {
    renderSection();
    const section = screen.getByRole("region", { name: "文字识别概览" });

    expect(within(section).getByText("中英文常用文字")).toBeVisible();
    expect(within(section).getByText("完整画面")).toBeVisible();
    expect(within(section).getByText("30%")).toBeVisible();
    expect(
      within(section).getByRole("meter", { name: "最低置信度" }),
    ).toHaveAttribute("aria-valuenow", "30");
    await waitFor(() => {
      expect(within(section).getByText("尚未运行")).toBeVisible();
    });
  });

  it("states a connected ROI and leaves invalid confidence visibly unavailable", () => {
    renderSection({
      roiConnected: true,
      effectiveConfidenceThreshold: undefined,
    });
    const section = screen.getByRole("region", { name: "文字识别概览" });

    expect(within(section).getByText("由 ROI 连线提供")).toBeVisible();
    expect(within(section).getByText("配置不可用")).toBeVisible();
    expect(within(section).queryByRole("meter")).not.toBeInTheDocument();
  });

  it("uses a polite status only while OCR is running", () => {
    renderSection();
    applyExecution("running");

    const status = screen.getByRole("status", { name: "正在识别文字" });
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows only the bounded selected result rather than a candidate list", async () => {
    renderSection();
    applyExecution("succeeded", [
      summary("bestRect", "rect", "10, 20, 120 x 32"),
      summary("result", "ocrResult", "金币 128", 4),
      summary("matched", "bool", "true"),
      summary("bestText", "string", "金币 128"),
    ]);
    const result = screen.getByRole("group", { name: "识别到文字" });

    await waitFor(() => {
      expect(within(result).getByText("4")).toBeVisible();
      expect(within(result).getByText("金币 128")).toBeVisible();
      expect(within(result).getByText("10, 20, 120 x 32")).toBeVisible();
    });
    expect(within(result).queryAllByText("金币 128")).toHaveLength(1);
  });

  it("distinguishes no match, incomplete summaries, and execution failure", async () => {
    renderSection();
    applyExecution("succeeded", [summary("matched", "bool", "false")]);
    await waitFor(() => expect(screen.getByText("未识别到文字")).toBeVisible());

    applyExecution("succeeded", [summary("matched", "bool", "true")]);
    await waitFor(() =>
      expect(screen.getByText("结果摘要不完整")).toBeVisible(),
    );

    applyExecution("failed", [], "OCR_BACKEND_FAILED");
    const alert = screen.getByRole("alert", { name: "文字识别失败" });
    expect(alert).toHaveTextContent("OCR_BACKEND_FAILED");
  });

  it("has no detectable structural accessibility violation", async () => {
    const { container } = renderSection({ roiConnected: true });
    applyExecution("succeeded", [
      summary("matched", "bool", "true"),
      summary("bestText", "string", "关卡完成"),
      summary("result", "ocrResult", "关卡完成", 1),
    ]);

    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
