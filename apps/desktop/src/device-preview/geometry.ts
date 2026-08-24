export interface PreviewPoint {
  x: number;
  y: number;
}

export interface PreviewSize {
  width: number;
  height: number;
}

export interface ClientBounds extends PreviewSize {
  left: number;
  top: number;
}

export interface SourceCoordinateSpace extends PreviewSize {
  coordinateSpaceId: string;
  sourceGeneration: number;
}

export interface SourcePoint extends PreviewPoint {
  coordinateSpaceId: string;
  sourceGeneration: number;
}

export interface SourceRectangle extends SourcePoint, PreviewSize {}

export interface PreviewTransform {
  source: SourceCoordinateSpace;
  viewport: PreviewSize;
  scale: number;
  offsetX: number;
  offsetY: number;
  renderedWidth: number;
  renderedHeight: number;
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

export function createFitPreviewTransform(
  source: SourceCoordinateSpace,
  viewport: PreviewSize,
  zoom = 1,
  pan: PreviewPoint = { x: 0, y: 0 },
): PreviewTransform {
  requirePositiveFinite(source.width, "Source width");
  requirePositiveFinite(source.height, "Source height");
  requirePositiveFinite(viewport.width, "Viewport width");
  requirePositiveFinite(viewport.height, "Viewport height");
  requirePositiveFinite(zoom, "Preview zoom");
  if (!Number.isFinite(pan.x) || !Number.isFinite(pan.y)) {
    throw new RangeError("Preview pan must contain finite coordinates.");
  }
  const fitScale = Math.min(
    viewport.width / source.width,
    viewport.height / source.height,
  );
  const scale = fitScale * zoom;
  const renderedWidth = source.width * scale;
  const renderedHeight = source.height * scale;
  return {
    source,
    viewport,
    scale,
    offsetX: (viewport.width - renderedWidth) / 2 + pan.x,
    offsetY: (viewport.height - renderedHeight) / 2 + pan.y,
    renderedWidth,
    renderedHeight,
  };
}

export function oneToOneZoom(transform: PreviewTransform): number {
  const fitScale = Math.min(
    transform.viewport.width / transform.source.width,
    transform.viewport.height / transform.source.height,
  );
  return 1 / fitScale;
}

export function sourcePointToPreview(
  transform: PreviewTransform,
  point: PreviewPoint,
): PreviewPoint {
  return {
    x: transform.offsetX + point.x * transform.scale,
    y: transform.offsetY + point.y * transform.scale,
  };
}

export function clientPointToPreview(
  transform: PreviewTransform,
  bounds: ClientBounds,
  clientPoint: PreviewPoint,
): PreviewPoint | undefined {
  if (
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return undefined;
  }
  return {
    x:
      (clientPoint.x - bounds.left) * (transform.viewport.width / bounds.width),
    y:
      (clientPoint.y - bounds.top) *
      (transform.viewport.height / bounds.height),
  };
}

export function previewPointToSource(
  transform: PreviewTransform,
  point: PreviewPoint,
): SourcePoint | undefined {
  const x = (point.x - transform.offsetX) / transform.scale;
  const y = (point.y - transform.offsetY) / transform.scale;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= transform.source.width ||
    y >= transform.source.height
  ) {
    return undefined;
  }
  return {
    x: Math.min(transform.source.width - 1, Math.floor(x)),
    y: Math.min(transform.source.height - 1, Math.floor(y)),
    coordinateSpaceId: transform.source.coordinateSpaceId,
    sourceGeneration: transform.source.sourceGeneration,
  };
}

export function previewDragToSourceRectangle(
  transform: PreviewTransform,
  start: PreviewPoint,
  end: PreviewPoint,
): SourceRectangle | undefined {
  const left = Math.max(0, Math.min(start.x, end.x) - transform.offsetX);
  const top = Math.max(0, Math.min(start.y, end.y) - transform.offsetY);
  const right = Math.min(
    transform.renderedWidth,
    Math.max(start.x, end.x) - transform.offsetX,
  );
  const bottom = Math.min(
    transform.renderedHeight,
    Math.max(start.y, end.y) - transform.offsetY,
  );
  if (right <= left || bottom <= top) {
    return undefined;
  }
  const sourceLeft = Math.max(0, Math.floor(left / transform.scale));
  const sourceTop = Math.max(0, Math.floor(top / transform.scale));
  const sourceRight = Math.min(
    transform.source.width,
    Math.ceil(right / transform.scale),
  );
  const sourceBottom = Math.min(
    transform.source.height,
    Math.ceil(bottom / transform.scale),
  );
  if (sourceRight <= sourceLeft || sourceBottom <= sourceTop) {
    return undefined;
  }
  return {
    x: sourceLeft,
    y: sourceTop,
    width: sourceRight - sourceLeft,
    height: sourceBottom - sourceTop,
    coordinateSpaceId: transform.source.coordinateSpaceId,
    sourceGeneration: transform.source.sourceGeneration,
  };
}
