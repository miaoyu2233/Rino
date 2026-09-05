import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWindowInteraction, useWindowMetrics } from "./useWindowMetrics";

/** The desktop window the mocked Tauri API hands back.
 *
 * Declared through `vi.hoisted` because the module mocks below are hoisted above the
 * imports and would otherwise read it before it exists.
 */
const tauriState = vi.hoisted(() => ({ enabled: true }));

const desktopWindow = vi.hoisted(() => {
  interface ScaleChangedPayload {
    scaleFactor: number;
    size: { toLogical: (scaleFactor: number) => Size };
  }
  interface Size {
    width: number;
    height: number;
  }
  const listeners: {
    moved: (() => void)[];
    resized: ((event: { payload: PhysicalSizeDouble }) => void)[];
    scaleChanged: ((event: { payload: ScaleChangedPayload }) => void)[];
  } = { moved: [], resized: [], scaleChanged: [] };

  /** Tauri reports physical pixels and converts on request; the double keeps that shape
   * because the hook's correctness is exactly in performing that conversion. */
  class PhysicalSizeDouble {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}

    toLogical(scaleFactor: number): Size {
      return {
        width: this.width / scaleFactor,
        height: this.height / scaleFactor,
      };
    }
  }

  const state = { width: 1920, height: 1080, scaleFactor: 1 };

  return {
    PhysicalSizeDouble,
    listeners,
    state,
    api: {
      innerSize: () =>
        Promise.resolve(new PhysicalSizeDouble(state.width, state.height)),
      scaleFactor: () => Promise.resolve(state.scaleFactor),
      onMoved: (handler: () => void) => {
        listeners.moved.push(handler);
        return Promise.resolve(() => {
          const index = listeners.moved.indexOf(handler);
          if (index >= 0) {
            listeners.moved.splice(index, 1);
          }
        });
      },
      onResized: (
        handler: (event: { payload: PhysicalSizeDouble }) => void,
      ) => {
        listeners.resized.push(handler);
        return Promise.resolve(() => {
          const index = listeners.resized.indexOf(handler);
          if (index >= 0) {
            listeners.resized.splice(index, 1);
          }
        });
      },
      onScaleChanged: (
        handler: (event: { payload: ScaleChangedPayload }) => void,
      ) => {
        listeners.scaleChanged.push(handler);
        return Promise.resolve(() => undefined);
      },
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauriState.enabled,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => desktopWindow.api,
}));

function MetricsProbe() {
  const metrics = useWindowMetrics();
  return (
    <output>{`${String(metrics.width)}x${String(metrics.height)}@${metrics.scaleFactor.toFixed(2)}`}</output>
  );
}

function InteractionProbe() {
  const interacting = useWindowInteraction();
  return (
    <output data-testid="window-interacting">{String(interacting)}</output>
  );
}

async function flushPendingWindowQueries(): Promise<void> {
  // The hook reads the window's size and scale through promises; letting the
  // microtask queue drain is what makes their result observable.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useWindowMetrics on the desktop window", () => {
  beforeEach(() => {
    tauriState.enabled = true;
    desktopWindow.listeners.moved.length = 0;
    desktopWindow.listeners.resized.length = 0;
    desktopWindow.listeners.scaleChanged.length = 0;
    desktopWindow.state.width = 1920;
    desktopWindow.state.height = 1080;
    desktopWindow.state.scaleFactor = 1;
  });

  it("reports the window in logical pixels rather than physical ones", async () => {
    desktopWindow.state.scaleFactor = 1.5;
    render(<MetricsProbe />);
    await flushPendingWindowQueries();

    expect(screen.getByRole("status")).toHaveTextContent("1280x720@1.50");
  });

  it("recalculates when the window moves to a monitor with another scale factor", async () => {
    render(<MetricsProbe />);
    await flushPendingWindowQueries();
    expect(screen.getByRole("status")).toHaveTextContent("1920x1080@1.00");

    // Windows reports a scale change with the size the window now has, which is what a
    // move between a 100 percent and a 200 percent monitor produces.
    await act(async () => {
      for (const handler of desktopWindow.listeners.scaleChanged) {
        handler({
          payload: {
            scaleFactor: 2,
            size: new desktopWindow.PhysicalSizeDouble(1920, 1080),
          },
        });
      }
      await Promise.resolve();
    });

    expect(screen.getByRole("status")).toHaveTextContent("960x540@2.00");
  });

  it("recalculates at the current scale factor when the window is resized", async () => {
    desktopWindow.state.scaleFactor = 1.25;
    render(<MetricsProbe />);
    await flushPendingWindowQueries();

    await act(async () => {
      for (const handler of desktopWindow.listeners.resized) {
        handler({
          payload: new desktopWindow.PhysicalSizeDouble(1600, 1000),
        });
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("status")).toHaveTextContent("1280x800@1.25");
  });

  it("keeps interaction active until the final move or resize settles", async () => {
    vi.useFakeTimers();
    try {
      render(<InteractionProbe />);
      await flushPendingWindowQueries();
      expect(screen.getByTestId("window-interacting")).toHaveTextContent(
        "false",
      );

      act(() => {
        desktopWindow.listeners.moved[0]?.();
      });
      expect(screen.getByTestId("window-interacting")).toHaveTextContent(
        "true",
      );

      act(() => {
        vi.advanceTimersByTime(219);
      });
      expect(screen.getByTestId("window-interacting")).toHaveTextContent(
        "true",
      );

      act(() => {
        desktopWindow.listeners.resized[0]?.({
          payload: new desktopWindow.PhysicalSizeDouble(1600, 1000),
        });
        vi.advanceTimersByTime(219);
      });
      expect(screen.getByTestId("window-interacting")).toHaveTextContent(
        "true",
      );

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByTestId("window-interacting")).toHaveTextContent(
        "false",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("unregisters movement listeners when the hook unmounts", async () => {
    const { unmount } = render(<InteractionProbe />);
    await flushPendingWindowQueries();

    expect(desktopWindow.listeners.moved).toHaveLength(1);
    expect(desktopWindow.listeners.resized).toHaveLength(1);

    unmount();

    expect(desktopWindow.listeners.moved).toHaveLength(0);
    expect(desktopWindow.listeners.resized).toHaveLength(0);
  });

  it("stays inactive without native Tauri window events", async () => {
    tauriState.enabled = false;
    render(<InteractionProbe />);
    await flushPendingWindowQueries();

    expect(screen.getByTestId("window-interacting")).toHaveTextContent("false");
    expect(desktopWindow.listeners.moved).toHaveLength(0);
    expect(desktopWindow.listeners.resized).toHaveLength(0);
  });
});
