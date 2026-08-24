import type { RuntimeValueSummaryV1 } from "@rino/contracts";

import type { NodeExecutionView } from "../../ipc/runtime-execution-store";

interface OcrResultDetails {
  candidateCount: number | undefined;
  bestText: string | undefined;
  bestTextTruncated: boolean;
  bestRect: string | undefined;
}

export type OcrPresentation =
  | { state: "idle" }
  | { state: "running" }
  | ({ state: "matched"; candidateCount: number; bestText: string } & Omit<
      OcrResultDetails,
      "candidateCount" | "bestText"
    >)
  | ({ state: "noMatch" } & Pick<OcrResultDetails, "candidateCount">)
  | ({ state: "incomplete" } & OcrResultDetails)
  | { state: "failed"; errorCode: string | undefined };

function summaryByPort(
  summaries: readonly RuntimeValueSummaryV1[],
): ReadonlyMap<string, RuntimeValueSummaryV1> {
  const indexed = new Map<string, RuntimeValueSummaryV1>();
  for (const summary of summaries) {
    indexed.set(summary.portId, summary);
  }
  return indexed;
}

function resultDetails(
  indexed: ReadonlyMap<string, RuntimeValueSummaryV1>,
): OcrResultDetails {
  const result = indexed.get("result");
  const text = indexed.get("bestText");
  const rect = indexed.get("bestRect");
  return {
    candidateCount:
      result?.kind === "ocrResult" &&
      Number.isSafeInteger(result.itemCount) &&
      (result.itemCount ?? -1) >= 0
        ? result.itemCount
        : undefined,
    bestText: text?.kind === "string" ? text.preview : undefined,
    bestTextTruncated: text?.kind === "string" && text.truncated,
    bestRect: rect?.kind === "rect" ? rect.preview : undefined,
  };
}

/** Resolves bounded runtime summaries into the states the OCR inspector can prove.
 *
 * Port identifiers, kinds, and exact boolean previews are validated here so the view
 * never guesses from array order or presents malformed boundary data as a real match.
 */
export function resolveOcrPresentation(
  execution: NodeExecutionView | undefined,
): OcrPresentation {
  if (execution === undefined) {
    return { state: "idle" };
  }
  if (execution.state === "running") {
    return { state: "running" };
  }
  if (execution.state === "failed") {
    return { state: "failed", errorCode: execution.errorCode };
  }

  const indexed = summaryByPort(execution.valueSummaries);
  const matched = indexed.get("matched");
  const details = resultDetails(indexed);

  if (matched?.kind !== "bool") {
    return { state: "incomplete", ...details };
  }
  if (matched.preview === "false") {
    return { state: "noMatch", candidateCount: details.candidateCount };
  }
  if (
    matched.preview === "true" &&
    details.bestText !== undefined &&
    details.candidateCount !== undefined &&
    details.candidateCount >= 1
  ) {
    return {
      state: "matched",
      candidateCount: details.candidateCount,
      bestText: details.bestText,
      bestTextTruncated: details.bestTextTruncated,
      bestRect: details.bestRect,
    };
  }
  return { state: "incomplete", ...details };
}

function boundedConfidence(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : undefined;
}

/** Applies a registry default only when no stored value exists.
 *
 * An invalid stored value stays unavailable instead of being hidden by a plausible
 * default; the generic property editor remains responsible for repairing it.
 */
export function resolveEffectiveConfidenceThreshold(
  storedValue: unknown,
  defaultValue: unknown,
): number | undefined {
  return storedValue === undefined
    ? boundedConfidence(defaultValue)
    : boundedConfidence(storedValue);
}
