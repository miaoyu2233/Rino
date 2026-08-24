import { describe, expect, it } from "vitest";

import {
  acceleratedPanDelta,
  settleViewportZoomAtPointer,
  stepViewportSpring,
  zoomViewportAtPointer,
} from "./canvas-interaction";

describe("canvas interaction response", () => {
  it("maps a normal mouse notch to a useful anchored zoom", () => {
    const viewport = { x: -120, y: 40, zoom: 1 };
    const pointer = { clientX: 500, clientY: 300 };
    const bounds = { left: 100, top: 50, width: 800, height: 600 };

    const next = zoomViewportAtPointer(
      viewport,
      pointer,
      bounds,
      -100,
      0,
      0.2,
      2,
      1.35,
    );

    const localX = pointer.clientX - bounds.left;
    const localY = pointer.clientY - bounds.top;
    expect(next.zoom).toBeGreaterThan(1.14);
    expect(next.zoom).toBeLessThan(1.2);
    expect((localX - next.x) / next.zoom).toBeCloseTo(
      (localX - viewport.x) / viewport.zoom,
    );
    expect((localY - next.y) / next.zoom).toBeCloseTo(
      (localY - viewport.y) / viewport.zoom,
    );
  });

  it("clamps zoom and applies a restrained middle-drag gain", () => {
    expect(
      zoomViewportAtPointer(
        { x: 0, y: 0, zoom: 1.9 },
        { clientX: 200, clientY: 200 },
        { left: 0, top: 0, width: 400, height: 400 },
        -1000,
        0,
        0.2,
        2,
      ).zoom,
    ).toBe(2);
    expect(acceleratedPanDelta(100)).toBe(135);
    expect(acceleratedPanDelta(-20)).toBe(-27);
  });

  it("uses the selected response profile as a real zoom sensitivity", () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    const pointer = { clientX: 200, clientY: 200 };
    const bounds = { left: 0, top: 0, width: 400, height: 400 };
    const balanced = zoomViewportAtPointer(
      viewport,
      pointer,
      bounds,
      -40,
      0,
      0.2,
      2,
      1,
    );
    const responsive = zoomViewportAtPointer(
      viewport,
      pointer,
      bounds,
      -40,
      0,
      0.2,
      2,
      1.35,
    );

    expect(responsive.zoom).toBeGreaterThan(balanced.zoom);
  });

  it("starts between the current and target viewport without a jump", () => {
    const current = { x: 0, y: 0, zoom: 1 };
    const target = { x: -120, y: -80, zoom: 1.5 };
    const first = stepViewportSpring(
      current,
      target,
      { x: 0, y: 0, zoom: 0 },
      1 / 60,
      24,
    );

    expect(first.settled).toBe(false);
    expect(first.viewport.x).toBeGreaterThan(target.x);
    expect(first.viewport.x).toBeLessThan(current.x);
    expect(first.viewport.y).toBeGreaterThan(target.y);
    expect(first.viewport.y).toBeLessThan(current.y);
    expect(first.viewport.zoom).toBeGreaterThan(current.zoom);
    expect(first.viewport.zoom).toBeLessThan(target.zoom);
  });

  it("produces nearly the same result at 60 Hz and 120 Hz", () => {
    const current = { x: 0, y: 0, zoom: 1 };
    const target = { x: -120, y: -80, zoom: 1.5 };
    const run = (frameSeconds: number, frameCount: number) => {
      let viewport = current;
      let velocity = { x: 0, y: 0, zoom: 0 };
      for (let index = 0; index < frameCount; index += 1) {
        const next = stepViewportSpring(
          viewport,
          target,
          velocity,
          frameSeconds,
          24,
        );
        viewport = next.viewport;
        velocity = next.velocity;
      }
      return viewport;
    };

    const at60Hz = run(1 / 60, 30);
    const at120Hz = run(1 / 120, 60);
    expect(at60Hz.x).toBeCloseTo(at120Hz.x, 3);
    expect(at60Hz.y).toBeCloseTo(at120Hz.y, 3);
    expect(at60Hz.zoom).toBeCloseTo(at120Hz.zoom, 4);
  });

  it("settles after repeated steps and lands on the exact target", () => {
    const target = { x: -120, y: -80, zoom: 1.5 };
    let viewport = { x: 0, y: 0, zoom: 1 };
    let velocity = { x: 0, y: 0, zoom: 0 };
    let settled = false;
    for (let index = 0; index < 240 && !settled; index += 1) {
      const next = stepViewportSpring(viewport, target, velocity, 1 / 60, 24);
      viewport = next.viewport;
      velocity = next.velocity;
      settled = next.settled;
    }
    expect(settled).toBe(true);
    expect(viewport).toEqual(target);
    expect(velocity).toEqual({ x: 0, y: 0, zoom: 0 });
  });

  it("uses one response for x, y, and zoom so the pointer anchor stays fixed", () => {
    const viewport = { x: -80, y: 25, zoom: 1.1 };
    const pointer = { clientX: 500, clientY: 320 };
    const bounds = { left: 100, top: 40, width: 900, height: 640 };
    const target = zoomViewportAtPointer(
      viewport,
      pointer,
      bounds,
      -100,
      0,
      0.2,
      2,
      1,
    );
    const next = stepViewportSpring(
      viewport,
      target,
      { x: 0, y: 0, zoom: 0 },
      1 / 60,
      24,
    ).viewport;
    const localX = pointer.clientX - bounds.left;
    const localY = pointer.clientY - bounds.top;
    expect((localX - next.x) / next.zoom).toBeCloseTo(
      (localX - viewport.x) / viewport.zoom,
      8,
    );
    expect((localY - next.y) / next.zoom).toBeCloseTo(
      (localY - viewport.y) / viewport.zoom,
      8,
    );
  });

  it("keeps abnormal elapsed values finite", () => {
    const current = { x: 0, y: 0, zoom: 1 };
    const target = { x: -120, y: -80, zoom: 1.5 };
    for (const elapsed of [Number.NaN, Number.POSITIVE_INFINITY, -1, 10]) {
      const next = stepViewportSpring(
        current,
        target,
        { x: 0, y: 0, zoom: 0 },
        elapsed,
        24,
      );
      expect(Object.values(next.viewport).every(Number.isFinite)).toBe(true);
      expect(Object.values(next.velocity).every(Number.isFinite)).toBe(true);
    }
  });

  it("settles continuous zoom onto a clear level without moving the pointed graph position", () => {
    const viewport = { x: -80, y: 25, zoom: 1.43 };
    const pointer = { clientX: 500, clientY: 320 };
    const bounds = { left: 100, top: 40, width: 900, height: 640 };

    const next = settleViewportZoomAtPointer(viewport, pointer, bounds, 0.2, 2);

    const localX = pointer.clientX - bounds.left;
    const localY = pointer.clientY - bounds.top;
    expect(next.zoom).toBe(1.5);
    expect((localX - next.x) / next.zoom).toBeCloseTo(
      (localX - viewport.x) / viewport.zoom,
    );
    expect((localY - next.y) / next.zoom).toBeCloseTo(
      (localY - viewport.y) / viewport.zoom,
    );
  });
});
