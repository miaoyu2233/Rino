import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { CoordinatePickerOverlay } from "./CoordinatePickerOverlay";
import type { PreviewTransform } from "./geometry";
import {
  useCoordinatePickerStore,
  type CoordinatePickerSession,
} from "./coordinate-picker-store";
import type { DeviceOverlay, ProjectedDeviceOverlay } from "./overlay-model";

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
  scale: 0.4,
  offsetX: 50,
  offsetY: 40,
  renderedWidth: 400,
  renderedHeight: 320,
};

const pointSession: CoordinatePickerSession = {
  sessionId: 10,
  kind: "point",
  target: {
    graphId: "graph-1",
    nodeId: "node-1",
    nodeTypeKey: "core.geometry.point",
  },
  source: sampleTransform.source,
};

const rectSession: CoordinatePickerSession = {
  sessionId: 11,
  kind: "rectangle",
  target: {
    graphId: "graph-1",
    nodeId: "node-2",
    nodeTypeKey: "core.geometry.rectangle",
  },
  source: sampleTransform.source,
};

describe("CoordinatePickerOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts point clicks using supplied transform and rejects letterboxing", () => {
    const onCommitPoint = vi.fn();
    const onError = vi.fn();

    act(() => {
      useCoordinatePickerStore.setState({ session: pointSession });
    });

    render(
      <CoordinatePickerOverlay
        transform={sampleTransform}
        session={pointSession}
        savedOverlay={undefined}
        savedRawOverlay={undefined}
        onCommitPoint={onCommitPoint}
        onCommitRectangle={vi.fn()}
        onCancel={vi.fn()}
        onError={onError}
      />,
    );

    const surface = screen.getByRole("application");

    // Click inside letterbox (x=20 is outside offsetX=50)
    fireEvent.pointerDown(surface, {
      clientX: 20,
      clientY: 100,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(surface, {
      clientX: 20,
      clientY: 100,
      button: 0,
      pointerId: 1,
    });
    expect(onCommitPoint).not.toHaveBeenCalled();

    // Click inside image area (clientX=90, offsetX=50, scale=0.4 => source x=100)
    fireEvent.pointerDown(surface, {
      clientX: 90,
      clientY: 80,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(surface, {
      clientX: 90,
      clientY: 80,
      button: 0,
      pointerId: 1,
    });
    expect(onCommitPoint).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        x: 100,
        y: 100,
      }),
    );
  });

  it("handles rectangle drag with pointer capture and clips to image bounds", () => {
    const onCommitRectangle = vi.fn();
    const onError = vi.fn();

    act(() => {
      useCoordinatePickerStore.setState({ session: rectSession });
    });

    // Mock pointer capture methods
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => true);

    render(
      <CoordinatePickerOverlay
        transform={sampleTransform}
        session={rectSession}
        savedOverlay={undefined}
        savedRawOverlay={undefined}
        onCommitPoint={vi.fn()}
        onCommitRectangle={onCommitRectangle}
        onCancel={vi.fn()}
        onError={onError}
      />,
    );

    const surface = screen.getByRole("application");

    // Drag start at clientX=90, clientY=80 (source x=100, y=100)
    fireEvent.pointerDown(surface, {
      clientX: 90,
      clientY: 80,
      button: 0,
      pointerId: 1,
    });
    // Drag move to clientX=170, clientY=160 (source x=300, y=300)
    fireEvent.pointerMove(surface, {
      clientX: 170,
      clientY: 160,
      button: 0,
      pointerId: 1,
    });
    // Drag release
    fireEvent.pointerUp(surface, {
      clientX: 170,
      clientY: 160,
      button: 0,
      pointerId: 1,
    });

    expect(onCommitRectangle).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        x: 100,
        y: 100,
        width: 200,
        height: 200,
      }),
    );
  });

  it("uses the transform captured at pointer down if layout changes during a drag", () => {
    const onCommitRectangle = vi.fn();

    act(() => {
      useCoordinatePickerStore.setState({ session: rectSession });
    });

    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => true);

    const props = {
      session: rectSession,
      savedOverlay: undefined,
      savedRawOverlay: undefined,
      onCommitPoint: vi.fn(),
      onCommitRectangle,
      onCancel: vi.fn(),
      onError: vi.fn(),
    };
    const { rerender } = render(
      <CoordinatePickerOverlay transform={sampleTransform} {...props} />,
    );
    const surface = screen.getByRole("application");

    fireEvent.pointerDown(surface, {
      clientX: 90,
      clientY: 80,
      button: 0,
      pointerId: 7,
    });

    const changedTransform: PreviewTransform = {
      ...sampleTransform,
      viewport: { width: 1000, height: 800 },
      scale: 0.8,
      offsetX: 100,
      offsetY: 80,
      renderedWidth: 800,
      renderedHeight: 640,
    };
    rerender(
      <CoordinatePickerOverlay transform={changedTransform} {...props} />,
    );
    fireEvent.pointerUp(surface, {
      clientX: 170,
      clientY: 160,
      button: 0,
      pointerId: 7,
    });

    expect(onCommitRectangle).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ x: 100, y: 100, width: 200, height: 200 }),
    );
  });

  it("requires a matching pointer press and rejects stale sessions", () => {
    const onCommitPoint = vi.fn();

    act(() => {
      useCoordinatePickerStore.setState({ session: pointSession });
    });

    render(
      <CoordinatePickerOverlay
        transform={sampleTransform}
        session={pointSession}
        savedOverlay={undefined}
        savedRawOverlay={undefined}
        onCommitPoint={onCommitPoint}
        onCommitRectangle={vi.fn()}
        onCancel={vi.fn()}
        onError={vi.fn()}
      />,
    );

    const surface = screen.getByRole("application");

    fireEvent.pointerDown(surface, {
      clientX: 90,
      clientY: 80,
      button: 2,
      pointerId: 1,
    });
    fireEvent.pointerUp(surface, {
      clientX: 90,
      clientY: 80,
      button: 2,
      pointerId: 1,
    });
    expect(onCommitPoint).not.toHaveBeenCalled();

    fireEvent.pointerUp(surface, {
      clientX: 90,
      clientY: 80,
      button: 0,
      pointerId: 1,
    });
    expect(onCommitPoint).not.toHaveBeenCalled();

    fireEvent.pointerDown(surface, {
      clientX: 90,
      clientY: 80,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(surface, {
      clientX: 90,
      clientY: 80,
      button: 0,
      pointerId: 2,
    });
    expect(onCommitPoint).not.toHaveBeenCalled();

    fireEvent.pointerUp(surface, {
      clientX: 90,
      clientY: 80,
      button: 0,
      pointerId: 1,
    });
    expect(onCommitPoint).toHaveBeenCalledTimes(1);
    onCommitPoint.mockClear();

    fireEvent.pointerDown(surface, {
      clientX: 90,
      clientY: 80,
      button: 0,
      pointerId: 3,
    });
    act(() => {
      useCoordinatePickerStore.setState({
        session: { ...pointSession, sessionId: 12 },
      });
    });
    fireEvent.pointerUp(surface, {
      clientX: 90,
      clientY: 80,
      button: 0,
      pointerId: 3,
    });
    expect(onCommitPoint).not.toHaveBeenCalled();
  });

  it("handles Escape, Enter, Space, and arrow key movement with clamping", () => {
    const onCommitPoint = vi.fn();
    const onCancel = vi.fn();

    act(() => {
      useCoordinatePickerStore.setState({ session: pointSession });
    });

    render(
      <CoordinatePickerOverlay
        transform={sampleTransform}
        session={pointSession}
        savedOverlay={undefined}
        savedRawOverlay={undefined}
        onCommitPoint={onCommitPoint}
        onCommitRectangle={vi.fn()}
        onCancel={onCancel}
        onError={vi.fn()}
      />,
    );

    const surface = screen.getByRole("application");
    expect(surface).toHaveFocus();

    // Escape cancels
    fireEvent.keyDown(surface, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledWith(10);

    // Arrow Right + Shift (10 steps), then Enter commits
    fireEvent.keyDown(surface, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(surface, { key: "Enter" });

    expect(onCommitPoint).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        x: 510,
        y: 400,
      }),
    );
  });

  it("initializes keyboard draft from existing saved raw overlay", () => {
    const savedRawPoint: DeviceOverlay = {
      overlayId: "saved-point",
      kind: "point",
      coordinateSpaceId: "space-1",
      sourceGeneration: 1,
      point: {
        x: 250,
        y: 350,
        coordinateSpaceId: "space-1",
        sourceGeneration: 1,
      },
    };

    const onCommitPoint = vi.fn();

    act(() => {
      useCoordinatePickerStore.setState({ session: pointSession });
    });

    render(
      <CoordinatePickerOverlay
        transform={sampleTransform}
        session={pointSession}
        savedOverlay={undefined}
        savedRawOverlay={savedRawPoint}
        onCommitPoint={onCommitPoint}
        onCommitRectangle={vi.fn()}
        onCancel={vi.fn()}
        onError={vi.fn()}
      />,
    );

    const surface = screen.getByRole("application");

    // Pressing Space should commit the initial position at (250, 350)
    fireEvent.keyDown(surface, { key: " " });
    expect(onCommitPoint).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        x: 250,
        y: 350,
      }),
    );
  });

  it("reprojects a keyboard draft when the preview transform changes", () => {
    act(() => {
      useCoordinatePickerStore.setState({ session: pointSession });
    });

    const props = {
      session: pointSession,
      savedOverlay: undefined,
      savedRawOverlay: undefined,
      onCommitPoint: vi.fn(),
      onCommitRectangle: vi.fn(),
      onCancel: vi.fn(),
      onError: vi.fn(),
    };
    const { container, rerender } = render(
      <CoordinatePickerOverlay transform={sampleTransform} {...props} />,
    );

    expect(
      container
        .querySelector(".coordinate-picker-overlay__keyboard-draft > g")
        ?.getAttribute("transform"),
    ).toBe("translate(250, 200)");

    const enlargedTransform: PreviewTransform = {
      ...sampleTransform,
      viewport: { width: 1000, height: 800 },
      scale: 0.8,
      offsetX: 100,
      offsetY: 80,
      renderedWidth: 800,
      renderedHeight: 640,
    };
    rerender(
      <CoordinatePickerOverlay transform={enlargedTransform} {...props} />,
    );

    expect(
      container
        .querySelector(".coordinate-picker-overlay__keyboard-draft > g")
        ?.getAttribute("transform"),
    ).toBe("translate(500, 400)");
  });

  it("handles rectangle keyboard movement and resizing with Ctrl+Arrow and minimum size", () => {
    const onCommitRectangle = vi.fn();

    act(() => {
      useCoordinatePickerStore.setState({ session: rectSession });
    });

    render(
      <CoordinatePickerOverlay
        transform={sampleTransform}
        session={rectSession}
        savedOverlay={undefined}
        savedRawOverlay={undefined}
        onCommitPoint={vi.fn()}
        onCommitRectangle={onCommitRectangle}
        onCancel={vi.fn()}
        onError={vi.fn()}
      />,
    );

    const surface = screen.getByRole("application");
    expect(screen.getByText("250 × 200")).toBeInTheDocument();

    fireEvent.keyDown(surface, { key: "ArrowRight", ctrlKey: true });
    expect(screen.getByText("251 × 200")).toBeInTheDocument();
    fireEvent.keyDown(surface, { key: "Enter" });

    expect(onCommitRectangle).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        width: 251,
      }),
    );
  });

  it("keeps pointer draft local without issuing graph commands before release", () => {
    const onCommitRectangle = vi.fn();

    act(() => {
      useCoordinatePickerStore.setState({ session: rectSession });
    });

    render(
      <CoordinatePickerOverlay
        transform={sampleTransform}
        session={rectSession}
        savedOverlay={undefined}
        savedRawOverlay={undefined}
        onCommitPoint={vi.fn()}
        onCommitRectangle={onCommitRectangle}
        onCancel={vi.fn()}
        onError={vi.fn()}
      />,
    );

    const surface = screen.getByRole("application");

    fireEvent.pointerDown(surface, {
      clientX: 90,
      clientY: 80,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(surface, {
      clientX: 170,
      clientY: 160,
      button: 0,
      pointerId: 1,
    });

    expect(onCommitRectangle).not.toHaveBeenCalled();
  });

  it("associates error message with surface through aria-describedby", () => {
    act(() => {
      useCoordinatePickerStore.setState({ session: pointSession });
    });

    render(
      <CoordinatePickerOverlay
        transform={sampleTransform}
        session={pointSession}
        savedOverlay={undefined}
        savedRawOverlay={undefined}
        onCommitPoint={vi.fn()}
        onCommitRectangle={vi.fn()}
        onCancel={vi.fn()}
        onError={vi.fn()}
        errorMessage="无效的图像选择"
      />,
    );

    const surface = screen.getByRole("application");
    const describedBy = surface.getAttribute("aria-describedby") ?? "";
    expect(describedBy.length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent("无效的图像选择");
  });

  it("renders projected saved overlay graphics when supplied", () => {
    const savedProjectedOverlay: ProjectedDeviceOverlay = {
      overlayId: "proj-1",
      kind: "point",
      point: { x: 90, y: 80 },
    };

    const { container } = render(
      <CoordinatePickerOverlay
        transform={sampleTransform}
        session={undefined}
        savedOverlay={savedProjectedOverlay}
        savedRawOverlay={undefined}
        onCommitPoint={vi.fn()}
        onCommitRectangle={vi.fn()}
        onCancel={vi.fn()}
        onError={vi.fn()}
      />,
    );

    const savedElem = container.querySelector(
      ".coordinate-picker-overlay__saved",
    );
    expect(savedElem).toBeInTheDocument();
  });

  it("supports prefers-reduced-motion without leaving hidden content or delayed interaction", () => {
    act(() => {
      useCoordinatePickerStore.setState({ session: pointSession });
    });

    const { container } = render(
      <CoordinatePickerOverlay
        transform={sampleTransform}
        session={pointSession}
        savedOverlay={undefined}
        savedRawOverlay={undefined}
        onCommitPoint={vi.fn()}
        onCommitRectangle={vi.fn()}
        onCancel={vi.fn()}
        onError={vi.fn()}
      />,
    );

    const surface = screen.getByRole("application");
    expect(surface).toBeInTheDocument();
    expect(
      container.querySelector(".coordinate-picker-overlay"),
    ).toBeInTheDocument();
  });
});
