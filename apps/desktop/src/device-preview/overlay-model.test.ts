import { describe, expect, it } from "vitest";

import { createFitPreviewTransform } from "./geometry";
import { projectDeviceOverlay } from "./overlay-model";

const transform = createFitPreviewTransform(
  {
    width: 1080,
    height: 1920,
    coordinateSpaceId: "source-space",
    sourceGeneration: 7,
  },
  { width: 540, height: 960 },
);

describe("device preview overlays", () => {
  it("projects current-frame rectangles with the same fit transform", () => {
    expect(
      projectDeviceOverlay(transform, {
        overlayId: "ocr-result-1",
        kind: "recognition",
        coordinateSpaceId: "source-space",
        sourceGeneration: 7,
        rectangle: {
          x: 100,
          y: 200,
          width: 300,
          height: 400,
          coordinateSpaceId: "source-space",
          sourceGeneration: 7,
        },
        confidence: 0.92,
      }),
    ).toEqual({
      overlayId: "ocr-result-1",
      kind: "recognition",
      topLeft: { x: 50, y: 100 },
      width: 150,
      height: 200,
      confidence: 0.92,
    });
  });

  it("rejects stale, foreign, and out-of-bounds overlays", () => {
    const base = {
      overlayId: "selection",
      kind: "roi" as const,
      coordinateSpaceId: "source-space",
      sourceGeneration: 7,
      rectangle: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        coordinateSpaceId: "source-space",
        sourceGeneration: 7,
      },
    };
    expect(
      projectDeviceOverlay(transform, { ...base, sourceGeneration: 6 }),
    ).toBeUndefined();
    expect(
      projectDeviceOverlay(transform, {
        ...base,
        coordinateSpaceId: "other-space",
      }),
    ).toBeUndefined();
    expect(
      projectDeviceOverlay(transform, {
        ...base,
        rectangle: { ...base.rectangle, x: 1000, width: 100 },
      }),
    ).toBeUndefined();
  });
});
