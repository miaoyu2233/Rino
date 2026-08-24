import type { CanvasViewport } from "./canvas-geometry";

export interface CanvasBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PointerPosition {
  clientX: number;
  clientY: number;
}

const PIXELS_PER_WHEEL_LINE = 20;
const PIXELS_PER_WHEEL_PAGE = 400;
// A normal Windows mouse notch is commonly reported as roughly 100 pixels. The old
// curve moved only about 11% at the responsive profile, which made a single notch feel
// inert. This curve keeps trackpads fine-grained while making a mouse notch visibly useful.
const WHEEL_ZOOM_EXPONENT_PER_PIXEL = 0.0018;
const MAXIMUM_WHEEL_EXPONENT_PER_FRAME = 0.28;
const CLEAR_ZOOM_LEVELS = [
  0.2, 0.25, 0.33, 0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 1.75, 2,
] as const;

function normalizedWheelPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) {
    return deltaY * PIXELS_PER_WHEEL_LINE;
  }
  if (deltaMode === 2) {
    return deltaY * PIXELS_PER_WHEEL_PAGE;
  }
  return deltaY;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function zoomViewportAtPointer(
  viewport: CanvasViewport,
  pointer: PointerPosition,
  bounds: CanvasBounds,
  wheelDeltaY: number,
  wheelDeltaMode: number,
  minimumZoom: number,
  maximumZoom: number,
  sensitivity = 1,
): CanvasViewport {
  const exponent = clamp(
    -normalizedWheelPixels(wheelDeltaY, wheelDeltaMode) *
      WHEEL_ZOOM_EXPONENT_PER_PIXEL *
      sensitivity,
    -MAXIMUM_WHEEL_EXPONENT_PER_FRAME,
    MAXIMUM_WHEEL_EXPONENT_PER_FRAME,
  );
  const zoom = clamp(viewport.zoom * 2 ** exponent, minimumZoom, maximumZoom);
  if (zoom === viewport.zoom) {
    return viewport;
  }
  const pointerX = clamp(pointer.clientX - bounds.left, 0, bounds.width);
  const pointerY = clamp(pointer.clientY - bounds.top, 0, bounds.height);
  const graphX = (pointerX - viewport.x) / viewport.zoom;
  const graphY = (pointerY - viewport.y) / viewport.zoom;
  return {
    x: pointerX - graphX * zoom,
    y: pointerY - graphY * zoom,
    zoom,
  };
}

export function settleViewportZoomAtPointer(
  viewport: CanvasViewport,
  pointer: PointerPosition,
  bounds: CanvasBounds,
  minimumZoom: number,
  maximumZoom: number,
): CanvasViewport {
  const availableLevels = CLEAR_ZOOM_LEVELS.filter(
    (level) => level >= minimumZoom && level <= maximumZoom,
  );
  const [firstLevel, ...remainingLevels] = availableLevels;
  if (firstLevel === undefined) {
    return viewport;
  }
  const nearestZoom = remainingLevels.reduce(
    (nearest, candidate) =>
      Math.abs(candidate - viewport.zoom) < Math.abs(nearest - viewport.zoom)
        ? candidate
        : nearest,
    firstLevel,
  );
  if (Math.abs(nearestZoom - viewport.zoom) < 0.005) {
    return viewport;
  }

  const pointerX = clamp(pointer.clientX - bounds.left, 0, bounds.width);
  const pointerY = clamp(pointer.clientY - bounds.top, 0, bounds.height);
  const graphX = (pointerX - viewport.x) / viewport.zoom;
  const graphY = (pointerY - viewport.y) / viewport.zoom;
  return {
    x: pointerX - graphX * nearestZoom,
    y: pointerY - graphY * nearestZoom,
    zoom: nearestZoom,
  };
}

export function acceleratedPanDelta(delta: number): number {
  return delta * 1.35;
}

export interface CanvasViewportVelocity {
  x: number;
  y: number;
  zoom: number;
}

interface SpringCoordinate {
  value: number;
  velocity: number;
  settled: boolean;
}

const MAXIMUM_SPRING_STEP_SECONDS = 0.1;
const VIEWPORT_POSITION_EPSILON = 0.01;
const VIEWPORT_ZOOM_EPSILON = 0.0001;

function stepSpringCoordinate(
  current: number,
  target: number,
  velocity: number,
  elapsedSeconds: number,
  smoothingRate: number,
  epsilon: number,
): SpringCoordinate {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(target) ||
    !Number.isFinite(velocity) ||
    !Number.isFinite(elapsedSeconds) ||
    !Number.isFinite(smoothingRate)
  ) {
    return {
      value: Number.isFinite(target) ? target : current,
      velocity: 0,
      settled: true,
    };
  }

  const boundedRate = Math.max(0.001, Math.abs(smoothingRate));
  const boundedElapsed = Math.min(
    MAXIMUM_SPRING_STEP_SECONDS,
    Math.max(0, elapsedSeconds),
  );
  const difference = target - current;
  if (
    Math.abs(difference) <= epsilon &&
    Math.abs(velocity) <= boundedRate * epsilon
  ) {
    return { value: target, velocity: 0, settled: true };
  }
  if (difference === 0) {
    return {
      value: target,
      velocity: 0,
      settled: true,
    };
  }
  if (boundedElapsed === 0) {
    return { value: current, velocity, settled: false };
  }

  // A critically damped spring has no oscillation when its initial speed is bounded
  // by the remaining distance. Discard speed that points away from a newly changed
  // target and cap the carried speed to prevent a visible rebound.
  const direction = Math.sign(difference);
  const directedVelocity = velocity * direction > 0 ? velocity : 0;
  const boundedVelocity =
    Math.min(Math.abs(difference) * boundedRate, Math.abs(directedVelocity)) *
    direction;
  const exponential = Math.exp(-boundedRate * boundedElapsed);
  const springCoefficient = boundedVelocity + boundedRate * (current - target);
  const error =
    (current - target + springCoefficient * boundedElapsed) * exponential;
  const nextVelocity =
    (boundedVelocity - boundedRate * springCoefficient * boundedElapsed) *
    exponential;
  let nextValue = target + error;
  let safeVelocity = nextVelocity;

  // Numerical noise and a target switch can otherwise carry one coordinate through
  // its target while the other coordinates are still converging.
  if ((target - current) * (target - nextValue) <= 0) {
    nextValue = target;
    safeVelocity = 0;
  }

  if (
    !Number.isFinite(nextValue) ||
    !Number.isFinite(safeVelocity) ||
    (Math.abs(target - nextValue) <= epsilon &&
      Math.abs(safeVelocity) <= boundedRate * epsilon)
  ) {
    return { value: target, velocity: 0, settled: true };
  }
  return { value: nextValue, velocity: safeVelocity, settled: false };
}

/** Advances a critically damped viewport spring by a frame-sized time step. */
export function stepViewportSpring(
  current: CanvasViewport,
  target: CanvasViewport,
  velocity: CanvasViewportVelocity,
  elapsedSeconds: number,
  smoothingRate: number,
): {
  viewport: CanvasViewport;
  velocity: CanvasViewportVelocity;
  settled: boolean;
} {
  const horizontal = stepSpringCoordinate(
    current.x,
    target.x,
    velocity.x,
    elapsedSeconds,
    smoothingRate,
    VIEWPORT_POSITION_EPSILON,
  );
  const vertical = stepSpringCoordinate(
    current.y,
    target.y,
    velocity.y,
    elapsedSeconds,
    smoothingRate,
    VIEWPORT_POSITION_EPSILON,
  );
  const zoom = stepSpringCoordinate(
    current.zoom,
    target.zoom,
    velocity.zoom,
    elapsedSeconds,
    smoothingRate,
    VIEWPORT_ZOOM_EPSILON,
  );
  const settled = horizontal.settled && vertical.settled && zoom.settled;
  return {
    viewport: settled
      ? target
      : { x: horizontal.value, y: vertical.value, zoom: zoom.value },
    velocity: settled
      ? { x: 0, y: 0, zoom: 0 }
      : { x: horizontal.velocity, y: vertical.velocity, zoom: zoom.velocity },
    settled,
  };
}
