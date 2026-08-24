import type { EditorPositionV1 } from "@rino/contracts";

/** The canvas pan and zoom, matching the transform React Flow applies to its viewport. */
export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

/** The part of the client rectangle the conversion needs. Narrowed to two numbers so the
 * calculation can be exercised without a layout engine. */
export interface CanvasBounds {
  left: number;
  top: number;
}

export interface CanvasRectangle extends CanvasBounds {
  width: number;
  height: number;
}

export interface ScreenPoint {
  clientX: number;
  clientY: number;
}

/** Nodes align to this grid, which keeps hand-placed and generated positions consistent
 * and matches the canvas grid spacing. */
export const CANVAS_GRID_SIZE = 8;

export const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };

/** Returns the pointer when it belongs to the canvas, or its visible centre when the
 * desktop webview reports a missing or out-of-range drag coordinate. */
export function pointerOrCanvasCenter(
  point: ScreenPoint,
  bounds: CanvasRectangle,
): ScreenPoint {
  const inside =
    Number.isFinite(point.clientX) &&
    Number.isFinite(point.clientY) &&
    point.clientX >= bounds.left &&
    point.clientX <= bounds.left + bounds.width &&
    point.clientY >= bounds.top &&
    point.clientY <= bounds.top + bounds.height;

  return inside
    ? point
    : {
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      };
}

/** Converts a pointer position into graph coordinates.
 *
 * Drops from the palette carry a screen position, while the document stores graph
 * coordinates. Doing the conversion here rather than reading it back from a rendered node
 * keeps a drop landing exactly under the pointer at any zoom level.
 */
export function screenToCanvasPosition(
  point: ScreenPoint,
  bounds: CanvasBounds,
  viewport: CanvasViewport,
): EditorPositionV1 {
  return {
    x: (point.clientX - bounds.left - viewport.x) / viewport.zoom,
    y: (point.clientY - bounds.top - viewport.y) / viewport.zoom,
  };
}

/** Converts graph coordinates back into a position inside the canvas element. */
export function canvasToScreenPosition(
  position: EditorPositionV1,
  bounds: CanvasBounds,
  viewport: CanvasViewport,
): ScreenPoint {
  return {
    clientX: position.x * viewport.zoom + viewport.x + bounds.left,
    clientY: position.y * viewport.zoom + viewport.y + bounds.top,
  };
}

export function snapToGrid(
  position: EditorPositionV1,
  gridSize: number = CANVAS_GRID_SIZE,
): EditorPositionV1 {
  return {
    x: Math.round(position.x / gridSize) * gridSize,
    y: Math.round(position.y / gridSize) * gridSize,
  };
}

/** Places a dropped node so the pointer lands on its header rather than its corner. */
export function centerOnPointer(
  position: EditorPositionV1,
  nodeWidth: number,
  headerHeight: number,
): EditorPositionV1 {
  return {
    x: position.x - nodeWidth / 2,
    y: position.y - headerHeight / 2,
  };
}
