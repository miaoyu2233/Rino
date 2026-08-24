import type { EditorPositionV1 } from "@rino/contracts";
import { create } from "zustand";

import {
  DEFAULT_VIEWPORT,
  screenToCanvasPosition,
  snapToGrid,
  type CanvasViewport,
} from "./canvas-geometry";

interface CanvasViewportState {
  viewport: CanvasViewport;
  width: number;
  height: number;
  reportViewport: (viewport: CanvasViewport) => void;
  reportGeometry: (
    viewport: CanvasViewport,
    width: number,
    height: number,
  ) => void;
}

/** The canvas reports its pan, zoom, and size here.
 *
 * Insertions that have no pointer position — a keyboard quick add, a palette item
 * activated with the keyboard — need somewhere to place the node. Reading the viewport
 * through a store keeps that decision out of the palette and out of React Flow's
 * component tree.
 */
export const useCanvasViewportStore = create<CanvasViewportState>((set) => ({
  viewport: DEFAULT_VIEWPORT,
  width: 0,
  height: 0,
  reportViewport: (viewport) => {
    set({ viewport });
  },
  reportGeometry: (viewport, width, height) => {
    set({ viewport, width, height });
  },
}));

/** Graph coordinates at the middle of what the user can currently see. */
export function visibleCanvasCenter(): EditorPositionV1 {
  const { viewport, width, height } = useCanvasViewportStore.getState();
  return snapToGrid(
    screenToCanvasPosition(
      { clientX: width / 2, clientY: height / 2 },
      { left: 0, top: 0 },
      viewport,
    ),
  );
}
