import {
  sourcePointToPreview,
  type PreviewPoint,
  type PreviewTransform,
  type SourcePoint,
  type SourceRectangle,
} from "./geometry";

interface OverlayIdentity {
  overlayId: string;
  coordinateSpaceId: string;
  sourceGeneration: number;
}

export interface PointOverlay extends OverlayIdentity {
  kind: "point";
  point: SourcePoint;
}

export interface RectangleOverlay extends OverlayIdentity {
  kind: "roi" | "rectangle" | "recognition";
  rectangle: SourceRectangle;
  confidence?: number;
}

export type DeviceOverlay = PointOverlay | RectangleOverlay;

export type ProjectedDeviceOverlay =
  | { overlayId: string; kind: "point"; point: PreviewPoint }
  | {
      overlayId: string;
      kind: RectangleOverlay["kind"];
      topLeft: PreviewPoint;
      width: number;
      height: number;
      confidence?: number;
    };

function belongsToTransform(
  transform: PreviewTransform,
  overlay: DeviceOverlay,
): boolean {
  return (
    overlay.coordinateSpaceId === transform.source.coordinateSpaceId &&
    overlay.sourceGeneration === transform.source.sourceGeneration
  );
}

function rectangleIsBounded(
  transform: PreviewTransform,
  rectangle: SourceRectangle,
): boolean {
  return (
    rectangle.x >= 0 &&
    rectangle.y >= 0 &&
    rectangle.width > 0 &&
    rectangle.height > 0 &&
    rectangle.x + rectangle.width <= transform.source.width &&
    rectangle.y + rectangle.height <= transform.source.height
  );
}

/** Projects only current-frame, in-bounds overlays into preview pixels. */
export function projectDeviceOverlay(
  transform: PreviewTransform,
  overlay: DeviceOverlay,
): ProjectedDeviceOverlay | undefined {
  if (!belongsToTransform(transform, overlay)) {
    return undefined;
  }
  if (overlay.kind === "point") {
    const { point } = overlay;
    if (
      point.coordinateSpaceId !== overlay.coordinateSpaceId ||
      point.sourceGeneration !== overlay.sourceGeneration ||
      point.x < 0 ||
      point.y < 0 ||
      point.x >= transform.source.width ||
      point.y >= transform.source.height
    ) {
      return undefined;
    }
    return {
      overlayId: overlay.overlayId,
      kind: "point",
      point: sourcePointToPreview(transform, point),
    };
  }
  if (
    overlay.rectangle.coordinateSpaceId !== overlay.coordinateSpaceId ||
    overlay.rectangle.sourceGeneration !== overlay.sourceGeneration ||
    !rectangleIsBounded(transform, overlay.rectangle) ||
    (overlay.confidence !== undefined &&
      (!Number.isFinite(overlay.confidence) ||
        overlay.confidence < 0 ||
        overlay.confidence > 1))
  ) {
    return undefined;
  }
  const topLeft = sourcePointToPreview(transform, overlay.rectangle);
  return {
    overlayId: overlay.overlayId,
    kind: overlay.kind,
    topLeft,
    width: overlay.rectangle.width * transform.scale,
    height: overlay.rectangle.height * transform.scale,
    ...(overlay.confidence === undefined
      ? {}
      : { confidence: overlay.confidence }),
  };
}
