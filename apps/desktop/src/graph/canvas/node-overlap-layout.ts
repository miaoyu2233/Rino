/** The canvas grid used by persisted node positions. */
export const NODE_LAYOUT_GRID_SIZE = 16;

/** The horizontal breathing room between two neighbouring node boxes. */
export const NODE_LAYOUT_HORIZONTAL_GAP = 48;

/** The vertical breathing room between two neighbouring node boxes. */
export const NODE_LAYOUT_VERTICAL_GAP = 32;

const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 32;
/** Input origins are bounded, while calculated forward positions may grow beyond this
 * value. With fewer than 2^32 array entries and at most 2e6 added per placement, the
 * largest calculated coordinate remains below Number.MAX_SAFE_INTEGER. */
const MAX_LAYOUT_ORIGIN = 1_000_000_000_000;
const MAX_LAYOUT_DIMENSION = 1_000_000;
const MAX_LAYOUT_GAP = 1_000_000;
const MAX_FINITE_COORDINATE = Number.MAX_VALUE / 4;

export interface NodeOverlapLayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when a rightward execution continuation should stay horizontal if possible. */
  preferHorizontal?: boolean;
}

export interface NodeOverlapLayoutOptions {
  horizontalGap?: number;
  verticalGap?: number;
}

function finiteCoordinate(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(-MAX_LAYOUT_ORIGIN, Math.min(MAX_LAYOUT_ORIGIN, value));
}

function finiteObservedCoordinate(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(
    -MAX_FINITE_COORDINATE,
    Math.min(MAX_FINITE_COORDINATE, value),
  );
}

function positiveDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(MAX_LAYOUT_DIMENSION, value);
}

function nonNegativeGap(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(MAX_LAYOUT_GAP, value));
}

function snapToGrid(value: number): number {
  const snapped =
    Math.round(finiteCoordinate(value) / NODE_LAYOUT_GRID_SIZE) *
    NODE_LAYOUT_GRID_SIZE;
  return snapped === 0 ? 0 : snapped;
}

function snapUpToGrid(value: number): number {
  const snapped =
    Math.ceil(value / NODE_LAYOUT_GRID_SIZE) * NODE_LAYOUT_GRID_SIZE;
  return snapped === 0 ? 0 : snapped;
}

function right(node: NodeOverlapLayoutNode): number {
  return node.x + node.width;
}

function bottom(node: NodeOverlapLayoutNode): number {
  return node.y + node.height;
}

function horizontalSeparated(
  first: NodeOverlapLayoutNode,
  second: NodeOverlapLayoutNode,
  gap: number,
): boolean {
  return right(first) + gap <= second.x || right(second) + gap <= first.x;
}

function verticalSeparated(
  first: NodeOverlapLayoutNode,
  second: NodeOverlapLayoutNode,
  gap: number,
): boolean {
  return bottom(first) + gap <= second.y || bottom(second) + gap <= first.y;
}

function separated(
  first: NodeOverlapLayoutNode,
  second: NodeOverlapLayoutNode,
  horizontalGap: number,
  verticalGap: number,
): boolean {
  return (
    horizontalSeparated(first, second, horizontalGap) ||
    verticalSeparated(first, second, verticalGap)
  );
}

function normalizedNode(
  node: NodeOverlapLayoutNode,
  snapPosition: boolean,
): NodeOverlapLayoutNode {
  return {
    id: node.id,
    x: snapPosition
      ? snapToGrid(finiteCoordinate(node.x))
      : finiteObservedCoordinate(node.x),
    y: snapPosition
      ? snapToGrid(finiteCoordinate(node.y))
      : finiteObservedCoordinate(node.y),
    width: positiveDimension(node.width, DEFAULT_NODE_WIDTH),
    height: positiveDimension(node.height, DEFAULT_NODE_HEIGHT),
    ...(node.preferHorizontal === true ? { preferHorizontal: true } : {}),
  };
}

/** Returns whether any pair of node rectangles intersects the requested safety gap.
 *
 * A zero gap checks the actual painted rectangles. A positive gap is useful for the
 * manual arrangement command, where touching boxes should also be separated. */
export function hasNodeOverlap(
  nodes: readonly NodeOverlapLayoutNode[],
  options: NodeOverlapLayoutOptions = {},
): boolean {
  const horizontalGap = nonNegativeGap(
    options.horizontalGap,
    NODE_LAYOUT_HORIZONTAL_GAP,
  );
  const verticalGap = nonNegativeGap(
    options.verticalGap,
    NODE_LAYOUT_VERTICAL_GAP,
  );
  const normalized = nodes.map((node) => normalizedNode(node, false));
  for (let firstIndex = 0; firstIndex < normalized.length; firstIndex += 1) {
    const first = normalized[firstIndex];
    if (first === undefined) {
      continue;
    }
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < normalized.length;
      secondIndex += 1
    ) {
      const second = normalized[secondIndex];
      if (
        second !== undefined &&
        !separated(first, second, horizontalGap, verticalGap)
      ) {
        return true;
      }
    }
  }
  return false;
}

function candidateX(
  node: NodeOverlapLayoutNode,
  placed: readonly NodeOverlapLayoutNode[],
  horizontalGap: number,
  verticalGap: number,
  mustResolve: boolean,
): number {
  if (!mustResolve) {
    return node.x;
  }
  let x = node.x;
  for (const previous of placed) {
    if (
      !verticalSeparated(node, previous, verticalGap) &&
      right(previous) + horizontalGap > node.x
    ) {
      x = Math.max(x, right(previous) + horizontalGap);
    }
  }
  return snapUpToGrid(x);
}

function candidateY(
  node: NodeOverlapLayoutNode,
  placed: readonly NodeOverlapLayoutNode[],
  horizontalGap: number,
  verticalGap: number,
  mustResolve: boolean,
): number {
  if (!mustResolve) {
    return node.y;
  }
  let y = node.y;
  for (const previous of placed) {
    if (
      !horizontalSeparated(node, previous, horizontalGap) &&
      bottom(previous) + verticalGap > node.y
    ) {
      y = Math.max(y, bottom(previous) + verticalGap);
    }
  }
  return snapUpToGrid(y);
}

function overlapsPlaced(
  node: NodeOverlapLayoutNode,
  placed: readonly NodeOverlapLayoutNode[],
  horizontalGap: number,
  verticalGap: number,
): boolean {
  return placed.some(
    (previous) => !separated(node, previous, horizontalGap, verticalGap),
  );
}

/**
 * Resolves node collisions in a stable, finite pass.
 *
 * Nodes are considered in original y/x/id order. An already placed node is never moved;
 * each later node is moved only forward (right or down) and chooses the smaller of the
 * two collision-free displacements, preferring right on a tie. The result is returned in
 * the same order as the input so callers can map it back to visual nodes without changing
 * graph order.
 */
export function resolveNodeOverlaps(
  nodes: readonly NodeOverlapLayoutNode[],
  options: NodeOverlapLayoutOptions = {},
): NodeOverlapLayoutNode[] {
  const horizontalGap = nonNegativeGap(
    options.horizontalGap,
    NODE_LAYOUT_HORIZONTAL_GAP,
  );
  const verticalGap = nonNegativeGap(
    options.verticalGap,
    NODE_LAYOUT_VERTICAL_GAP,
  );
  const normalized = nodes.map((node, index) => ({
    node: normalizedNode(node, true),
    index,
  }));
  const ordered = [...normalized].sort(
    (first, second) =>
      first.node.y - second.node.y ||
      first.node.x - second.node.x ||
      first.node.id.localeCompare(second.node.id) ||
      first.index - second.index,
  );
  const placed: NodeOverlapLayoutNode[] = [];

  for (const entry of ordered) {
    const original = entry.node;
    const mustResolve = overlapsPlaced(
      original,
      placed,
      horizontalGap,
      verticalGap,
    );
    const rightX = candidateX(
      original,
      placed,
      horizontalGap,
      verticalGap,
      mustResolve,
    );
    const downY = candidateY(
      original,
      placed,
      horizontalGap,
      verticalGap,
      mustResolve,
    );
    const rightCandidate = { ...original, x: Math.max(original.x, rightX) };
    const downCandidate = { ...original, y: Math.max(original.y, downY) };
    const rightDelta = rightCandidate.x - original.x;
    const downDelta = downCandidate.y - original.y;
    const resolved =
      original.preferHorizontal === true || rightDelta <= downDelta
        ? rightCandidate
        : downCandidate;

    placed.push(resolved);
    normalized[entry.index] = { node: resolved, index: entry.index };
  }

  return normalized.map(({ node }) => node);
}
