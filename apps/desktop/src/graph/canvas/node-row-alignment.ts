const DEFAULT_GRID_SIZE = 8;
const DEFAULT_SCREEN_THRESHOLD = 10;
const DEFAULT_NODE_WIDTH = 220;

export interface NodeRowAlignmentNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeRowAlignmentOptions {
  zoom: number;
  screenThreshold?: number;
  gridSize?: number;
}

export interface NodeRowAlignmentResult {
  anchorId: string;
  candidateId: string;
  alignedY: number;
  deltaY: number;
  distance: number;
  threshold: number;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function snapToGrid(value: number, gridSize: number): number {
  return Math.round(finite(value) / gridSize) * gridSize;
}

function right(node: NodeRowAlignmentNode): number {
  return finite(node.x) + positive(node.width, DEFAULT_NODE_WIDTH);
}

function horizontallySeparated(
  first: NodeRowAlignmentNode,
  second: NodeRowAlignmentNode,
): boolean {
  const firstLeft = finite(first.x);
  const secondLeft = finite(second.x);
  return right(first) <= secondLeft || right(second) <= firstLeft;
}

function compareCandidates(
  first: { y: number; id: string; distance: number },
  second: { y: number; id: string; distance: number },
): number {
  if (first.distance !== second.distance) {
    return first.distance - second.distance;
  }
  if (first.y !== second.y) {
    return first.y - second.y;
  }
  return first.id.localeCompare(second.id);
}

/** Finds one nearby row for a moving node set without changing their relative offsets. */
export function alignNodeToRow(
  movingNodes: readonly NodeRowAlignmentNode[],
  stationaryNodes: readonly NodeRowAlignmentNode[],
  options: NodeRowAlignmentOptions,
): NodeRowAlignmentResult | undefined {
  if (movingNodes.length === 0 || stationaryNodes.length === 0) {
    return undefined;
  }

  const gridSize = positive(
    options.gridSize ?? DEFAULT_GRID_SIZE,
    DEFAULT_GRID_SIZE,
  );
  const screenThreshold = positive(
    options.screenThreshold ?? DEFAULT_SCREEN_THRESHOLD,
    DEFAULT_SCREEN_THRESHOLD,
  );
  const zoom = positive(options.zoom, 1);
  const threshold = Math.max(screenThreshold / zoom, gridSize);
  const anchor = [...movingNodes].sort((first, second) =>
    first.id.localeCompare(second.id),
  )[0];
  if (anchor === undefined) {
    return undefined;
  }

  const anchorY = finite(anchor.y);
  const snappedAnchorY = snapToGrid(anchorY, gridSize);
  const movingIds = new Set(movingNodes.map((node) => node.id));
  let bestCandidate: { id: string; y: number; distance: number } | undefined;
  for (const candidate of stationaryNodes) {
    if (movingIds.has(candidate.id)) {
      continue;
    }
    if (!movingNodes.every((node) => horizontallySeparated(node, candidate))) {
      continue;
    }
    const candidateY = finite(candidate.y);
    const distance = Math.abs(candidateY - snappedAnchorY);
    if (distance > threshold) {
      continue;
    }
    const currentCandidate = {
      id: candidate.id,
      y: candidateY,
      distance,
    };
    if (
      bestCandidate === undefined ||
      compareCandidates(currentCandidate, bestCandidate) < 0
    ) {
      bestCandidate = currentCandidate;
    }
  }
  const candidate = bestCandidate;
  if (candidate === undefined) {
    return undefined;
  }

  return {
    anchorId: anchor.id,
    candidateId: candidate.id,
    alignedY: candidate.y,
    deltaY: candidate.y - anchorY,
    distance: candidate.distance,
    threshold,
  };
}
