import { describe, expect, it } from "vitest";

import { NODE_HEADER_HEIGHT } from "./graph-view-model";
import { estimateNodeHeight } from "./node-layout-size";

describe("estimateNodeHeight", () => {
  it("provides a conservative finite base for an unmeasured node", () => {
    const height = estimateNodeHeight({});

    expect(height).toBeGreaterThan(NODE_HEADER_HEIGHT);
    expect(height % 16).toBe(0);
    expect(Number.isFinite(height)).toBe(true);
  });

  it("grows with projected ports and common property fields", () => {
    const base = estimateNodeHeight({});
    const expanded = estimateNodeHeight({
      inputs: [
        { portKind: "execution" },
        { portKind: "data" },
        { portKind: "data" },
      ],
      outputs: [{ portKind: "execution" }, { portKind: "data" }],
      propertyFields: [{}, {}, {}, {}],
    });

    expect(expanded).toBeGreaterThan(base);
  });

  it("reserves an extra row for repeat execution and its enabled wait input", () => {
    const disabled = estimateNodeHeight({
      workflowGroup: {
        steps: [],
        recognitionRepeat: { enabled: false },
      },
    });
    const enabled = estimateNodeHeight({
      workflowGroup: {
        steps: [],
        recognitionRepeat: { enabled: true },
      },
    });

    expect(enabled).toBeGreaterThan(disabled);
  });

  it("includes log, coordinate, sequence, and workflow content within a bound", () => {
    const height = estimateNodeHeight({
      typeKey: "core.geometry.rectangle",
      logControl: { segmentKinds: Array.from({ length: 16 }, () => "text") },
      sequenceControl: { stepCount: 16 },
      workflowGroup: {
        steps: Array.from({ length: 64 }, () => ({})),
        imageRecognitionParameters: {},
      },
    });

    expect(height).toBeGreaterThan(500);
    expect(height).toBeLessThanOrEqual(1_000_000);
    expect(height % 16).toBe(0);
    expect(Number.isFinite(height)).toBe(true);
  });
});
