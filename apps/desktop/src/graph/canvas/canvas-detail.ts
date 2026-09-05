/** Keeps node and edge semantic zoom in one tier so the graph never mixes detail modes. */
export const FULL_CANVAS_DETAIL_MINIMUM_ZOOM = 0.5;

export type CanvasDetailMode = "full" | "overview";

export function canvasDetailModeForZoom(zoom: number): CanvasDetailMode {
  return zoom >= FULL_CANVAS_DETAIL_MINIMUM_ZOOM ? "full" : "overview";
}

/** Bounds mounted elements independently of semantic zoom on large, sparse graphs. */
export function shouldVirtualizeCanvasElements(
  renderElementCount: number,
  visibleElementThreshold: number,
): boolean {
  return renderElementCount >= visibleElementThreshold;
}
