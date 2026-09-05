import { applyNodeChanges, type NodeChange } from "@xyflow/react";

import {
  NODE_HEADER_HEIGHT,
  NODE_WIDTH,
  type RinoFlowNode,
} from "./graph-view-model";
import { estimateNodeHeight } from "./node-layout-size";
import {
  alignNodeToRow,
  type NodeRowAlignmentNode,
} from "./node-row-alignment";
import type { NodeOverlapLayoutNode } from "./node-overlap-layout";

function positiveDimension(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function nodeRectangle(
  node: RinoFlowNode,
  surface: HTMLElement | null,
  requireMeasured: boolean,
  estimateUnmeasured: boolean,
  preferHorizontal: boolean,
): NodeOverlapLayoutNode | undefined {
  const measuredWidth = positiveDimension(node.measured?.width);
  const measuredHeight = positiveDimension(node.measured?.height);
  if (
    requireMeasured &&
    (measuredWidth === undefined ||
      measuredHeight === undefined ||
      measuredWidth <= 0 ||
      measuredHeight <= 0)
  ) {
    return undefined;
  }
  const element =
    requireMeasured || surface === null
      ? undefined
      : surface.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(node.id)}"]`,
        );
  const elementWidth = positiveDimension(element?.offsetWidth);
  const elementHeight = positiveDimension(element?.offsetHeight);
  const width = elementWidth ?? measuredWidth ?? NODE_WIDTH;
  const height =
    elementHeight ??
    measuredHeight ??
    (estimateUnmeasured ? estimateNodeHeight(node.data) : NODE_HEADER_HEIGHT);
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width,
    height,
    ...(preferHorizontal ? { preferHorizontal: true } : {}),
  };
}

function rowAlignmentNode(node: RinoFlowNode): NodeRowAlignmentNode {
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: positiveDimension(node.measured?.width) ?? NODE_WIDTH,
    height: positiveDimension(node.measured?.height) ?? NODE_HEADER_HEIGHT,
  };
}

export function alignPositionChanges(
  changes: readonly NodeChange<RinoFlowNode>[],
  nodes: readonly RinoFlowNode[],
  zoom: number,
): NodeChange<RinoFlowNode>[] {
  const releaseChanges = changes.filter(
    (
      change,
    ): change is Extract<NodeChange<RinoFlowNode>, { type: "position" }> =>
      change.type === "position" &&
      change.dragging === false &&
      change.position !== undefined,
  );
  const movingIds = new Set(releaseChanges.map((change) => change.id));
  if (movingIds.size === 0) {
    return [...changes];
  }

  const proposedNodes = applyNodeChanges([...releaseChanges], [...nodes]);
  const movingNodes = proposedNodes
    .filter((node) => movingIds.has(node.id))
    .map(rowAlignmentNode);
  const stationaryNodes = nodes
    .filter((node) => !movingIds.has(node.id) && node.dragging !== true)
    .map(rowAlignmentNode);
  const alignment = alignNodeToRow(movingNodes, stationaryNodes, { zoom });
  if (alignment === undefined) {
    return [...changes];
  }

  return changes.map((change) => {
    if (
      change.type !== "position" ||
      change.dragging !== false ||
      change.position === undefined ||
      !movingIds.has(change.id)
    ) {
      return change;
    }
    return {
      ...change,
      position: {
        ...change.position,
        y: change.position.y + alignment.deltaY,
      },
    };
  });
}

export function filterNoOpNodeSelectionChanges(
  changes: readonly NodeChange<RinoFlowNode>[],
  nodes: readonly RinoFlowNode[],
): NodeChange<RinoFlowNode>[] {
  const selectedById = new Map(
    nodes.map((node) => [node.id, Boolean(node.selected)]),
  );
  return changes.filter((change) => {
    if (change.type !== "select") {
      return true;
    }
    const currentSelected = selectedById.get(change.id);
    return currentSelected === undefined || currentSelected !== change.selected;
  });
}

/** Node measurements originate inside ResizeObserver callbacks. Applying them during
 * the callback can synchronously resize a controlled node and start another delivery
 * loop, so measurements share the existing next-frame path with active drags. */
export function shouldDeferNodeChange(
  change: NodeChange<RinoFlowNode>,
): boolean {
  return (
    change.type === "dimensions" ||
    (change.type === "position" && change.dragging === true)
  );
}

export function applyTransientNodeChanges(
  changes: readonly NodeChange<RinoFlowNode>[],
  nodes: readonly RinoFlowNode[],
  commitInternalNodes: (nodes: RinoFlowNode[]) => void,
): RinoFlowNode[] {
  const latestPositions = new Map<string, NodeChange<RinoFlowNode>>();
  const otherChanges: NodeChange<RinoFlowNode>[] = [];
  for (const change of changes) {
    if (change.type === "position") {
      latestPositions.set(change.id, change);
    } else {
      otherChanges.push(change);
    }
  }
  const nextNodes = applyNodeChanges(
    [...otherChanges, ...latestPositions.values()],
    [...nodes],
  );
  commitInternalNodes(nextNodes);
  return nextNodes;
}
