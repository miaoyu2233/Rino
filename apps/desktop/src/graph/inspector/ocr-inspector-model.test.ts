import type { RuntimeValueSummaryV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import type { NodeExecutionView } from "../../ipc/runtime-execution-store";
import {
  resolveEffectiveConfidenceThreshold,
  resolveOcrPresentation,
} from "./ocr-inspector-model";

function summary(
  portId: string,
  kind: RuntimeValueSummaryV1["kind"],
  preview: string,
  options: Pick<RuntimeValueSummaryV1, "truncated" | "itemCount"> = {
    truncated: false,
  },
): RuntimeValueSummaryV1 {
  return { portId, generation: 1, kind, preview, ...options };
}

function execution(
  state: NodeExecutionView["state"],
  valueSummaries: readonly RuntimeValueSummaryV1[] = [],
  errorCode?: string,
): NodeExecutionView {
  return {
    state,
    runSequence: 4,
    tokenId: 2,
    activationId: 3,
    valueSummaries,
    errorCode,
  };
}

describe("OCR inspector presentation", () => {
  it("distinguishes idle, running, and failed execution", () => {
    expect(resolveOcrPresentation(undefined)).toEqual({ state: "idle" });
    expect(resolveOcrPresentation(execution("running"))).toEqual({
      state: "running",
    });
    expect(
      resolveOcrPresentation(execution("failed", [], "OCR_BACKEND_FAILED")),
    ).toEqual({ state: "failed", errorCode: "OCR_BACKEND_FAILED" });
  });

  it("resolves a match by stable port identifiers in arbitrary order", () => {
    expect(
      resolveOcrPresentation(
        execution("succeeded", [
          summary("unrelated", "string", "ignored"),
          summary("bestRect", "rect", "12, 24, 80 x 32"),
          summary("bestText", "string", "生命值 42"),
          summary("result", "ocrResult", "生命值 42", {
            truncated: false,
            itemCount: 3,
          }),
          summary("matched", "bool", "true"),
        ]),
      ),
    ).toEqual({
      state: "matched",
      candidateCount: 3,
      bestText: "生命值 42",
      bestTextTruncated: false,
      bestRect: "12, 24, 80 x 32",
    });
  });

  it("keeps a truncated best text and permits a missing optional rectangle", () => {
    expect(
      resolveOcrPresentation(
        execution("succeeded", [
          summary("matched", "bool", "true"),
          summary("bestText", "string", "a bounded preview", {
            truncated: true,
          }),
          summary("result", "ocrResult", "a bounded preview", {
            truncated: true,
            itemCount: 1,
          }),
        ]),
      ),
    ).toEqual({
      state: "matched",
      candidateCount: 1,
      bestText: "a bounded preview",
      bestTextTruncated: true,
      bestRect: undefined,
    });
  });

  it("resolves an explicit no-match without inventing a candidate count", () => {
    expect(
      resolveOcrPresentation(
        execution("succeeded", [summary("matched", "bool", "false")]),
      ),
    ).toEqual({ state: "noMatch", candidateCount: undefined });
  });

  it.each([
    ["missing matched", [summary("bestText", "string", "42")]],
    ["wrong matched kind", [summary("matched", "string", "true")]],
    ["unknown bool preview", [summary("matched", "bool", "TRUE")]],
    [
      "missing result count",
      [summary("matched", "bool", "true"), summary("bestText", "string", "42")],
    ],
    [
      "missing best text",
      [
        summary("matched", "bool", "true"),
        summary("result", "ocrResult", "", {
          truncated: false,
          itemCount: 1,
        }),
      ],
    ],
  ])("reports incomplete summaries for %s", (_name, summaries) => {
    expect(
      resolveOcrPresentation(execution("succeeded", summaries)),
    ).toMatchObject({ state: "incomplete" });
  });
});

describe("OCR confidence summary", () => {
  it("prefers a valid stored value and otherwise uses a valid default", () => {
    expect(resolveEffectiveConfidenceThreshold(0.75, 0.3)).toBe(0.75);
    expect(resolveEffectiveConfidenceThreshold(undefined, 0.3)).toBe(0.3);
  });

  it("does not conceal an invalid stored value with the default", () => {
    expect(resolveEffectiveConfidenceThreshold(2, 0.3)).toBeUndefined();
    expect(
      resolveEffectiveConfidenceThreshold(Number.NaN, 0.3),
    ).toBeUndefined();
    expect(resolveEffectiveConfidenceThreshold(undefined, -1)).toBeUndefined();
  });
});
