import { describe, expect, it } from "vitest";

import {
  constrainFloatingWorkbenchGeometry,
  defaultFloatingWorkbenchGeometry,
  normalizeFloatingWorkbenchGeometry,
} from "./floating-workbench-geometry";

describe("floating workbench geometry", () => {
  it("normalizes invalid persisted geometry", () => {
    expect(
      normalizeFloatingWorkbenchGeometry({
        x: -20,
        y: 100_001,
        width: 9_999,
        height: -1,
      }),
    ).toEqual({
      x: 0,
      y: 100_000,
      width: 720,
      height: 240,
    });
    expect(normalizeFloatingWorkbenchGeometry({ x: NaN })).toEqual({
      ...defaultFloatingWorkbenchGeometry,
    });
  });

  it("keeps the panel and title bar reachable within the viewport", () => {
    expect(
      constrainFloatingWorkbenchGeometry(
        { x: 900, y: 700, width: 600, height: 500 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 200, y: 100, width: 600, height: 500 });
  });

  it("shrinks below normal minimums when the viewport is smaller", () => {
    expect(
      constrainFloatingWorkbenchGeometry(defaultFloatingWorkbenchGeometry, {
        width: 240,
        height: 180,
      }),
    ).toEqual({ x: 0, y: 0, width: 240, height: 180 });
  });

  it("handles invalid viewport dimensions without producing NaN", () => {
    expect(
      constrainFloatingWorkbenchGeometry(defaultFloatingWorkbenchGeometry, {
        width: Number.NaN,
        height: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
