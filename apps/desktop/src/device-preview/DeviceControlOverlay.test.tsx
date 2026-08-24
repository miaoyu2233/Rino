import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeviceControlOverlay } from "./DeviceControlOverlay";
import type { PreviewTransform } from "./geometry";

const transform: PreviewTransform = {
  source: {
    width: 1000,
    height: 800,
    coordinateSpaceId: "space-1",
    sourceGeneration: 4,
  },
  viewport: { width: 500, height: 400 },
  scale: 0.4,
  offsetX: 50,
  offsetY: 40,
  renderedWidth: 400,
  renderedHeight: 320,
};

function dispatchPointer(
  target: HTMLElement,
  type: "pointerDown" | "pointerMove" | "pointerUp",
  options: {
    clientX: number;
    clientY: number;
    pointerId?: number;
    timeStamp: number;
  },
): void {
  const event = createEvent[type](target, {
    button: 0,
    clientX: options.clientX,
    clientY: options.clientY,
    pointerId: options.pointerId ?? 1,
  });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    timeStamp: { value: options.timeStamp },
  });
  fireEvent(target, event);
}

describe("DeviceControlOverlay", () => {
  it("covers the complete preview surface for direct pointer control", () => {
    render(
      <DeviceControlOverlay
        active
        disabled={false}
        label="Device controls"
        transform={transform}
        onInteraction={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("application", { name: "Device controls" }),
    ).toHaveStyle({
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      touchAction: "none",
    });
  });

  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => true);
  });

  it("maps click, long press, and swipe gestures to the source frame", () => {
    const onInteraction = vi.fn();
    render(
      <DeviceControlOverlay
        active
        disabled={false}
        label="控制设备"
        transform={transform}
        onInteraction={onInteraction}
      />,
    );
    const surface = screen.getByRole("application", { name: "控制设备" });

    dispatchPointer(surface, "pointerDown", {
      clientX: 90,
      clientY: 80,
      timeStamp: 100,
    });
    dispatchPointer(surface, "pointerUp", {
      clientX: 90,
      clientY: 80,
      timeStamp: 200,
    });
    expect(onInteraction).toHaveBeenLastCalledWith({
      kind: "click",
      point: {
        x: 100,
        y: 100,
        coordinateSpaceId: "space-1",
        sourceGeneration: 4,
      },
    });

    dispatchPointer(surface, "pointerDown", {
      clientX: 90,
      clientY: 80,
      timeStamp: 300,
    });
    dispatchPointer(surface, "pointerUp", {
      clientX: 90,
      clientY: 80,
      timeStamp: 900,
    });
    expect(onInteraction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "longPress",
        durationMilliseconds: 600,
      }),
    );

    dispatchPointer(surface, "pointerDown", {
      clientX: 90,
      clientY: 80,
      timeStamp: 1000,
    });
    dispatchPointer(surface, "pointerMove", {
      clientX: 170,
      clientY: 160,
      timeStamp: 1100,
    });
    dispatchPointer(surface, "pointerUp", {
      clientX: 170,
      clientY: 160,
      timeStamp: 1300,
    });
    expect(onInteraction).toHaveBeenLastCalledWith({
      kind: "swipe",
      start: {
        x: 100,
        y: 100,
        coordinateSpaceId: "space-1",
        sourceGeneration: 4,
      },
      end: {
        x: 300,
        y: 300,
        coordinateSpaceId: "space-1",
        sourceGeneration: 4,
      },
      durationMilliseconds: 300,
    });
  });

  it("accepts a mouse pointer when the WebView does not mark it primary", () => {
    const onInteraction = vi.fn();
    render(
      <DeviceControlOverlay
        active
        disabled={false}
        label="控制设备"
        transform={transform}
        onInteraction={onInteraction}
      />,
    );
    const surface = screen.getByRole("application", { name: "控制设备" });
    const pointerDown = createEvent.pointerDown(surface, {
      button: 0,
      clientX: 90,
      clientY: 80,
      pointerId: 1,
      pointerType: "mouse",
    });
    const pointerUp = createEvent.pointerUp(surface, {
      button: 0,
      clientX: 90,
      clientY: 80,
      pointerId: 1,
      pointerType: "mouse",
    });
    Object.defineProperty(pointerDown, "isPrimary", { value: false });
    Object.defineProperty(pointerUp, "isPrimary", { value: false });

    fireEvent(surface, pointerDown);
    fireEvent(surface, pointerUp);

    expect(onInteraction).toHaveBeenCalledWith({
      kind: "click",
      point: {
        x: 100,
        y: 100,
        coordinateSpaceId: "space-1",
        sourceGeneration: 4,
      },
    });
  });

  it("maps pointer input correctly when the rendered surface is scaled", () => {
    const onInteraction = vi.fn();
    render(
      <DeviceControlOverlay
        active
        disabled={false}
        label="控制设备"
        transform={transform}
        onInteraction={onInteraction}
      />,
    );
    const surface = screen.getByRole("application", { name: "控制设备" });
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      x: 30,
      y: 20,
      left: 30,
      top: 20,
      right: 780,
      bottom: 620,
      width: 750,
      height: 600,
      toJSON: () => ({}),
    });

    dispatchPointer(surface, "pointerDown", {
      clientX: 165,
      clientY: 140,
      timeStamp: 100,
    });
    dispatchPointer(surface, "pointerUp", {
      clientX: 165,
      clientY: 140,
      timeStamp: 200,
    });

    expect(onInteraction).toHaveBeenCalledWith({
      kind: "click",
      point: {
        x: 100,
        y: 100,
        coordinateSpaceId: "space-1",
        sourceGeneration: 4,
      },
    });
  });

  it("rejects letterboxing and disabled input", () => {
    const onInteraction = vi.fn();
    const { rerender } = render(
      <DeviceControlOverlay
        active
        disabled={false}
        label="控制设备"
        transform={transform}
        onInteraction={onInteraction}
      />,
    );
    const surface = screen.getByRole("application", { name: "控制设备" });
    dispatchPointer(surface, "pointerDown", {
      clientX: 20,
      clientY: 100,
      timeStamp: 10,
    });
    dispatchPointer(surface, "pointerUp", {
      clientX: 20,
      clientY: 100,
      timeStamp: 20,
    });
    expect(onInteraction).not.toHaveBeenCalled();

    rerender(
      <DeviceControlOverlay
        active
        disabled
        label="控制设备"
        transform={transform}
        onInteraction={onInteraction}
      />,
    );
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(onInteraction).not.toHaveBeenCalled();
  });

  it("supports precise keyboard movement and activation", () => {
    const onInteraction = vi.fn();
    render(
      <DeviceControlOverlay
        active
        disabled={false}
        label="控制设备"
        transform={transform}
        onInteraction={onInteraction}
      />,
    );
    const surface = screen.getByRole("application", { name: "控制设备" });
    fireEvent.keyDown(surface, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(surface, { key: "ArrowUp" });
    fireEvent.keyDown(surface, { key: "Enter" });

    expect(onInteraction).toHaveBeenCalledWith({
      kind: "click",
      point: {
        x: 510,
        y: 399,
        coordinateSpaceId: "space-1",
        sourceGeneration: 4,
      },
    });
  });
});
