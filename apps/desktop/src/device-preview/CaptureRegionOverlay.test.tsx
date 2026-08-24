import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CaptureRegionOverlay } from "./CaptureRegionOverlay";
import type { PreviewTransform, SourceRectangle } from "./geometry";
import { applicationI18n } from "../localization/i18n";

const sampleTransform: PreviewTransform = {
  source: {
    width: 1000,
    height: 800,
    coordinateSpaceId: "space-1",
    sourceGeneration: 1,
  },
  viewport: {
    width: 500,
    height: 400,
  },
  scale: 0.5,
  offsetX: 0,
  offsetY: 0,
  renderedWidth: 500,
  renderedHeight: 400,
};

describe("CaptureRegionOverlay", () => {
  beforeEach(() => {
    void applicationI18n.changeLanguage("zh-CN");
    vi.clearAllMocks();
  });

  it("renders overlay surface with accessible role, name, instructions, and auto-focus when active", () => {
    const onAccept = vi.fn();
    const onCancel = vi.fn();

    render(
      <CaptureRegionOverlay
        transform={sampleTransform}
        active={true}
        onAcceptRegion={onAccept}
        onCancel={onCancel}
      />,
    );

    const surface = screen.getByRole("application");
    expect(surface).toBeInTheDocument();
    expect(surface).toHaveAttribute("tabIndex", "0");
    expect(surface).toHaveFocus();
    expect(
      screen.getByText(/拖拽或使用键盘方向键框选截图区域/),
    ).toBeInTheDocument();
  });

  it("handles primary-pointer drag, animation-frame coalescing, and commits valid source rectangle on release", () => {
    const onAccept = vi.fn();
    const onError = vi.fn();

    const { container } = render(
      <CaptureRegionOverlay
        transform={sampleTransform}
        active={true}
        onAcceptRegion={onAccept}
        onCancel={vi.fn()}
        onError={onError}
      />,
    );

    const surface = screen.getByRole("application");

    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 500,
      height: 400,
      right: 500,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 1,
      clientX: 50,
      clientY: 50,
    });

    // Coalesce multiple move events
    fireEvent.pointerMove(surface, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 1,
      clientX: 200,
      clientY: 150,
    });

    fireEvent.pointerUp(surface, {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 150,
    });

    expect(onAccept).toHaveBeenCalledWith({
      x: 100,
      y: 100,
      width: 300,
      height: 200,
      coordinateSpaceId: "space-1",
      sourceGeneration: 1,
    });
    expect(onError).not.toHaveBeenCalled();
    expect(
      container.querySelector(".capture-region-overlay__badge"),
    ).toBeInTheDocument();
  });

  it("keeps region coordinates stable when the rendered surface is scaled", () => {
    const onAccept = vi.fn();
    render(
      <CaptureRegionOverlay
        transform={sampleTransform}
        active={true}
        onAcceptRegion={onAccept}
        onCancel={vi.fn()}
      />,
    );
    const surface = screen.getByRole("application");
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 30,
      top: 20,
      width: 750,
      height: 600,
      right: 780,
      bottom: 620,
      x: 30,
      y: 20,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 1,
      clientX: 105,
      clientY: 95,
    });
    fireEvent.pointerUp(surface, {
      button: 0,
      pointerId: 1,
      clientX: 330,
      clientY: 245,
    });

    expect(onAccept).toHaveBeenCalledWith({
      x: 100,
      y: 100,
      width: 300,
      height: 200,
      coordinateSpaceId: "space-1",
      sourceGeneration: 1,
    });
  });

  it("keeps the pointer-down coordinate transform for the complete drag", () => {
    const onAccept = vi.fn();
    const props = {
      active: true,
      onAcceptRegion: onAccept,
      onCancel: vi.fn(),
    };
    const { rerender } = render(
      <CaptureRegionOverlay transform={sampleTransform} {...props} />,
    );
    const surface = screen.getByRole("application");

    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 8,
      clientX: 100,
      clientY: 100,
    });
    rerender(
      <CaptureRegionOverlay
        transform={{
          ...sampleTransform,
          viewport: { width: 1000, height: 800 },
          scale: 0.8,
          offsetX: 100,
          offsetY: 80,
          renderedWidth: 800,
          renderedHeight: 640,
        }}
        {...props}
      />,
    );
    fireEvent.pointerUp(surface, {
      button: 0,
      pointerId: 8,
      clientX: 250,
      clientY: 200,
    });

    expect(onAccept).toHaveBeenCalledWith({
      x: 200,
      y: 200,
      width: 300,
      height: 200,
      coordinateSpaceId: "space-1",
      sourceGeneration: 1,
    });
  });

  it("ignores secondary buttons, additional pointers, stale pointer events, and letterbox clicks", () => {
    const onAccept = vi.fn();

    const letterboxTransform: PreviewTransform = {
      ...sampleTransform,
      offsetX: 50,
      renderedWidth: 400,
    };

    render(
      <CaptureRegionOverlay
        transform={letterboxTransform}
        active={true}
        onAcceptRegion={onAccept}
        onCancel={vi.fn()}
      />,
    );

    const surface = screen.getByRole("application");
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 500,
      height: 400,
      right: 500,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Right click ignored
    fireEvent.pointerDown(surface, {
      button: 2,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });

    // Letterbox click ignored
    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 1,
      clientX: 20,
      clientY: 100,
    });

    // Valid primary start
    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });

    // Additional second pointer down while gesture active is ignored
    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 2,
      clientX: 150,
      clientY: 150,
    });

    // Stale pointer move from pointerId 2 ignored
    fireEvent.pointerMove(surface, {
      pointerId: 2,
      clientX: 250,
      clientY: 250,
    });

    // Pointer up from stale pointer 2 ignored
    fireEvent.pointerUp(surface, {
      button: 0,
      pointerId: 2,
      clientX: 250,
      clientY: 250,
    });
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("handles pointer cancellation and lost pointer capture", () => {
    const onAccept = vi.fn();

    render(
      <CaptureRegionOverlay
        transform={sampleTransform}
        active={true}
        onAcceptRegion={onAccept}
        onCancel={vi.fn()}
      />,
    );

    const surface = screen.getByRole("application");
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 500,
      height: 400,
      right: 500,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });

    fireEvent.pointerCancel(surface, {
      pointerId: 1,
    });

    fireEvent.pointerUp(surface, {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });

    expect(onAccept).not.toHaveBeenCalled();

    // Test lostPointerCapture
    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 3,
      clientX: 100,
      clientY: 100,
    });

    fireEvent.lostPointerCapture(surface, {
      pointerId: 3,
    });

    fireEvent.pointerUp(surface, {
      button: 0,
      pointerId: 3,
      clientX: 200,
      clientY: 200,
    });

    expect(onAccept).not.toHaveBeenCalled();
  });

  it("rejects zero-size drag gestures and triggers onError", () => {
    const onAccept = vi.fn();
    const onError = vi.fn();

    render(
      <CaptureRegionOverlay
        transform={sampleTransform}
        active={true}
        onAcceptRegion={onAccept}
        onCancel={vi.fn()}
        onError={onError}
      />,
    );

    const surface = screen.getByRole("application");
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 500,
      height: 400,
      right: 500,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Click at same point without moving (zero width/height)
    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });

    fireEvent.pointerUp(surface, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });

    expect(onAccept).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/选择范围|超出|重新操作|无效|框选/i),
    );
  });

  it("handles keyboard draft navigation, boundary clamping, resize steps, and accept on Enter/Space", () => {
    const onAccept = vi.fn();

    render(
      <CaptureRegionOverlay
        transform={sampleTransform}
        active={true}
        onAcceptRegion={onAccept}
        onCancel={vi.fn()}
      />,
    );

    const surface = screen.getByRole("application");

    // Move x and y
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    fireEvent.keyDown(surface, { key: "ArrowUp" });

    // Resize with Ctrl + ArrowRight
    fireEvent.keyDown(surface, { key: "ArrowRight", ctrlKey: true });
    // Resize with Ctrl + ArrowDown
    fireEvent.keyDown(surface, { key: "ArrowDown", ctrlKey: true });

    // Shift + Arrow (larger 10px step)
    fireEvent.keyDown(surface, { key: "ArrowRight", shiftKey: true });

    // Confirm with Space
    fireEvent.keyDown(surface, { key: " " });

    expect(onAccept).toHaveBeenCalledTimes(1);
    const rect = (onAccept.mock.calls[0] as [SourceRectangle])[0];
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
  });

  it("triggers onCancel when Escape key is pressed", () => {
    const onCancel = vi.fn();

    render(
      <CaptureRegionOverlay
        transform={sampleTransform}
        active={true}
        onAcceptRegion={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const surface = screen.getByRole("application");
    fireEvent.keyDown(surface, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores keyboard shortcuts during native IME composition or when target is an editable element", () => {
    const onAccept = vi.fn();

    render(
      <div>
        <input data-testid="text-input" />
        <textarea data-testid="textarea-input" />
        <select data-testid="select-input">
          <option value="1">1</option>
        </select>
        <CaptureRegionOverlay
          transform={sampleTransform}
          active={true}
          onAcceptRegion={onAccept}
          onCancel={vi.fn()}
        />
      </div>,
    );

    const textInput = screen.getByTestId("text-input");
    const textarea = screen.getByTestId("textarea-input");
    const select = screen.getByTestId("select-input");
    const surface = screen.getByRole("application");

    fireEvent.keyDown(textInput, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(select, { key: "Enter" });

    // IME composition event
    fireEvent.keyDown(surface, { key: "Enter", isComposing: true });

    expect(onAccept).not.toHaveBeenCalled();
  });
});
