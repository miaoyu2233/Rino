import { describe, expect, it } from "vitest";

import {
  CANVAS_GRID_SIZE,
  canvasToScreenPosition,
  centerOnPointer,
  pointerOrCanvasCenter,
  screenToCanvasPosition,
  snapToGrid,
  type CanvasViewport,
} from "./canvas-geometry";

const BOUNDS = { left: 240, top: 48 };

describe("screen and canvas conversion", () => {
  it("subtracts the canvas origin at the identity viewport", () => {
    expect(
      screenToCanvasPosition({ clientX: 340, clientY: 148 }, BOUNDS, {
        x: 0,
        y: 0,
        zoom: 1,
      }),
    ).toEqual({ x: 100, y: 100 });
  });

  it("accounts for pan and zoom", () => {
    const viewport: CanvasViewport = { x: -120, y: 60, zoom: 2 };

    expect(
      screenToCanvasPosition({ clientX: 640, clientY: 348 }, BOUNDS, viewport),
    ).toEqual({ x: 260, y: 120 });
  });

  it("round-trips a position through both conversions", () => {
    const viewport: CanvasViewport = { x: 37, y: -84, zoom: 1.75 };
    const position = { x: 412, y: -96 };

    const screen = canvasToScreenPosition(position, BOUNDS, viewport);

    expect(screenToCanvasPosition(screen, BOUNDS, viewport)).toEqual(position);
  });
});

describe("grid alignment", () => {
  it("rounds to the nearest grid intersection", () => {
    expect(snapToGrid({ x: 11, y: -3 })).toEqual({ x: 8, y: -0 });
    expect(snapToGrid({ x: 12, y: 20 })).toEqual({ x: 16, y: 24 });
  });

  it("leaves a position that is already aligned untouched", () => {
    const aligned = { x: CANVAS_GRID_SIZE * 5, y: CANVAS_GRID_SIZE * -2 };

    expect(snapToGrid(aligned)).toEqual(aligned);
  });
});

describe("pointer centring", () => {
  it("places the pointer on the node header rather than its corner", () => {
    expect(centerOnPointer({ x: 400, y: 300 }, 220, 32)).toEqual({
      x: 290,
      y: 284,
    });
  });

  it("keeps a valid desktop drag coordinate", () => {
    expect(
      pointerOrCanvasCenter(
        { clientX: 720, clientY: 280 },
        { left: 320, top: 48, width: 800, height: 500 },
      ),
    ).toEqual({ clientX: 720, clientY: 280 });
  });

  it("falls back to the visible centre for a missing desktop drag coordinate", () => {
    expect(
      pointerOrCanvasCenter(
        { clientX: 0, clientY: 0 },
        { left: 320, top: 48, width: 800, height: 500 },
      ),
    ).toEqual({ clientX: 720, clientY: 298 });
  });
});
