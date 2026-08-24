export interface FloatingWorkbenchGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingWorkbenchViewport {
  width: number;
  height: number;
}

export const floatingWorkbenchGeometryLimits = {
  position: { minimum: 0, maximum: 100_000 },
  width: { minimum: 280, maximum: 720, default: 360 },
  height: { minimum: 240, maximum: 900, default: 520 },
} as const;

export const defaultFloatingWorkbenchGeometry: FloatingWorkbenchGeometry = {
  x: 24,
  y: 64,
  width: floatingWorkbenchGeometryLimits.width.default,
  height: floatingWorkbenchGeometryLimits.height.default,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedNumber(
  value: unknown,
  limits: { readonly minimum: number; readonly maximum: number },
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, limits.minimum, limits.maximum)
    : fallback;
}

/** Normalizes persisted geometry before it is used by a view or written back. */
export function normalizeFloatingWorkbenchGeometry(
  candidate: unknown,
): FloatingWorkbenchGeometry {
  if (!isRecord(candidate)) {
    return { ...defaultFloatingWorkbenchGeometry };
  }

  return {
    x: readBoundedNumber(
      candidate["x"],
      floatingWorkbenchGeometryLimits.position,
      defaultFloatingWorkbenchGeometry.x,
    ),
    y: readBoundedNumber(
      candidate["y"],
      floatingWorkbenchGeometryLimits.position,
      defaultFloatingWorkbenchGeometry.y,
    ),
    width: readBoundedNumber(
      candidate["width"],
      floatingWorkbenchGeometryLimits.width,
      defaultFloatingWorkbenchGeometry.width,
    ),
    height: readBoundedNumber(
      candidate["height"],
      floatingWorkbenchGeometryLimits.height,
      defaultFloatingWorkbenchGeometry.height,
    ),
  };
}

function viewportDimension(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

/**
 * Keeps the floating workbench and its title bar fully reachable after a resize.
 * When a viewport is smaller than the normal minimum, the panel yields to the viewport.
 */
export function constrainFloatingWorkbenchGeometry(
  geometry: FloatingWorkbenchGeometry,
  viewport: FloatingWorkbenchViewport,
): FloatingWorkbenchGeometry {
  const normalized = normalizeFloatingWorkbenchGeometry(geometry);
  const viewportWidth = viewportDimension(viewport.width);
  const viewportHeight = viewportDimension(viewport.height);
  const width = clamp(
    normalized.width,
    floatingWorkbenchGeometryLimits.width.minimum,
    Math.min(floatingWorkbenchGeometryLimits.width.maximum, viewportWidth),
  );
  const height = clamp(
    normalized.height,
    floatingWorkbenchGeometryLimits.height.minimum,
    Math.min(floatingWorkbenchGeometryLimits.height.maximum, viewportHeight),
  );

  return {
    x: clamp(normalized.x, 0, Math.max(0, viewportWidth - width)),
    y: clamp(normalized.y, 0, Math.max(0, viewportHeight - height)),
    width,
    height,
  };
}
