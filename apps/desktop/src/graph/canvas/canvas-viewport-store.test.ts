import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_VIEWPORT } from "./canvas-geometry";
import { useCanvasViewportStore } from "./canvas-viewport-store";

describe("canvas viewport store", () => {
  beforeEach(() => {
    useCanvasViewportStore.setState({
      viewport: DEFAULT_VIEWPORT,
      width: 0,
      height: 0,
    });
  });

  it("does not notify subscribers when reported geometry is unchanged", () => {
    let notificationCount = 0;
    const unsubscribe = useCanvasViewportStore.subscribe(() => {
      notificationCount += 1;
    });

    const store = useCanvasViewportStore.getState();
    store.reportGeometry({ x: 12, y: 24, zoom: 0.75 }, 800, 500);
    store.reportGeometry({ x: 12, y: 24, zoom: 0.75 }, 800, 500);
    store.reportViewport({ x: 12, y: 24, zoom: 0.75 });

    expect(notificationCount).toBe(1);
    unsubscribe();
  });

  it("notifies subscribers when the viewport changes", () => {
    let notificationCount = 0;
    const unsubscribe = useCanvasViewportStore.subscribe(() => {
      notificationCount += 1;
    });

    const store = useCanvasViewportStore.getState();
    store.reportViewport({ x: 0, y: 0, zoom: 0.9 });
    store.reportViewport({ x: 10, y: 0, zoom: 0.9 });

    expect(notificationCount).toBe(2);
    unsubscribe();
  });
});
