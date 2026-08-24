import { describe, expect, it } from "vitest";

import {
  clientPointToPreview,
  createFitPreviewTransform,
  oneToOneZoom,
  previewDragToSourceRectangle,
  previewPointToSource,
  sourcePointToPreview,
} from "./geometry";

const portraitSource = {
  width: 1080,
  height: 1920,
  coordinateSpaceId: "space-portrait",
  sourceGeneration: 7,
};

describe("device preview coordinate transforms", () => {
  it("fits portrait content with horizontal letterboxing", () => {
    const transform = createFitPreviewTransform(portraitSource, {
      width: 600,
      height: 600,
    });

    expect(transform.scale).toBeCloseTo(0.3125);
    expect(transform.renderedWidth).toBeCloseTo(337.5);
    expect(transform.offsetX).toBeCloseTo(131.25);
    expect(previewPointToSource(transform, { x: 10, y: 300 })).toBeUndefined();
    expect(previewPointToSource(transform, { x: 300, y: 300 })).toEqual({
      x: 540,
      y: 960,
      coordinateSpaceId: "space-portrait",
      sourceGeneration: 7,
    });
  });

  it("round-trips source pixels across fit, zoom, and pan", () => {
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 1280, height: 720 },
      { width: 801, height: 601 },
    ]) {
      const transform = createFitPreviewTransform(
        portraitSource,
        viewport,
        1.75,
        { x: 23.5, y: -11.25 },
      );
      for (const point of [
        { x: 0, y: 0 },
        { x: 123, y: 456 },
        { x: 1079, y: 1919 },
      ]) {
        const rendered = sourcePointToPreview(transform, {
          x: point.x + 0.25,
          y: point.y + 0.25,
        });
        expect(previewPointToSource(transform, rendered)).toMatchObject(point);
      }
    }
  });

  it("clips a drag to the image and preserves exact source metadata", () => {
    const transform = createFitPreviewTransform(portraitSource, {
      width: 600,
      height: 600,
    });
    expect(
      previewDragToSourceRectangle(
        transform,
        { x: 0, y: -10 },
        { x: 300, y: 300 },
      ),
    ).toEqual({
      x: 0,
      y: 0,
      width: 540,
      height: 960,
      coordinateSpaceId: "space-portrait",
      sourceGeneration: 7,
    });
  });

  it("computes the zoom that maps one source pixel to one CSS pixel", () => {
    const transform = createFitPreviewTransform(portraitSource, {
      width: 600,
      height: 600,
    });
    const oneToOne = createFitPreviewTransform(
      portraitSource,
      transform.viewport,
      oneToOneZoom(transform),
    );
    expect(oneToOne.scale).toBeCloseTo(1);
  });

  it("normalizes client coordinates into preview units after display scaling", () => {
    const transform = createFitPreviewTransform(portraitSource, {
      width: 600,
      height: 600,
    });

    expect(
      clientPointToPreview(
        transform,
        { left: 120, top: 45, width: 900, height: 900 },
        { x: 570, y: 495 },
      ),
    ).toEqual({ x: 300, y: 300 });
  });

  it("rejects client mapping when the rendered surface has no area", () => {
    const transform = createFitPreviewTransform(portraitSource, {
      width: 600,
      height: 600,
    });

    expect(
      clientPointToPreview(
        transform,
        { left: 0, top: 0, width: 0, height: 600 },
        { x: 0, y: 0 },
      ),
    ).toBeUndefined();
  });
});
