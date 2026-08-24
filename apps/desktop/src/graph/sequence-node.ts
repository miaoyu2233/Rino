import type { NodeV1 } from "@rino/contracts";

import {
  initialTaskChoiceDynamicPortState,
  isVisibleCaseCatalogPort,
} from "./task-choice";

export const DEFAULT_SEQUENCE_STEP_COUNT = 2;
export const MAXIMUM_SEQUENCE_STEP_COUNT = 16;
export const DEFAULT_PARALLEL_BRANCH_COUNT = 2;
export const MAXIMUM_PARALLEL_BRANCH_COUNT = 3;
export const DEFAULT_NUMERIC_INPUT_COUNT = 3;
export const MAXIMUM_NUMERIC_INPUT_COUNT = 16;
export const DEFAULT_COLLECTION_ITEM_COUNT = 2;
export const MAXIMUM_COLLECTION_ITEM_COUNT = 16;
const STEP_COUNT_KEY = "sequenceStepCount";
const SEQUENCE_ORDER_KEY = "sequenceOrder";
const PARALLEL_BRANCH_COUNT_KEY = "parallelBranchCount";
const NUMERIC_INPUT_COUNT_KEY = "numericInputCount";
const COLLECTION_ITEM_COUNT_KEY = "collectionItemCount";
const NUMERIC_INPUT_PORT_IDS = "abcdefghijklmnop";
const SEQUENCE_NODE_TYPE_KEYS = new Set([
  "core.flow.sequence",
  "core.flow.sequenceOrder",
]);

export type SequenceMoveDirection = "up" | "down";

export function sequenceStepId(index: number): string {
  return `step${String(index)}`;
}

export function naturalSequenceOrder(stepCount: number): string[] {
  return Array.from({ length: stepCount }, (_, index) =>
    sequenceStepId(index + 1),
  );
}

/** Shared strict order validation for both sequence node flavours. */
export function isValidSequenceOrder(
  value: unknown,
  stepCount: number,
): value is readonly string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  const sequenceValues: unknown[] = value;
  if (
    !Number.isInteger(stepCount) ||
    stepCount < 1 ||
    stepCount > MAXIMUM_SEQUENCE_STEP_COUNT ||
    sequenceValues.length !== stepCount ||
    sequenceValues.some((stepId) => typeof stepId !== "string")
  ) {
    return false;
  }
  const expected = new Set(naturalSequenceOrder(stepCount));
  return (
    new Set(sequenceValues).size === stepCount &&
    sequenceValues.every(
      (stepId): stepId is string =>
        typeof stepId === "string" && expected.has(stepId),
    )
  );
}

function isSequenceNodeType(node: NodeV1): boolean {
  return SEQUENCE_NODE_TYPE_KEYS.has(node.typeKey);
}

export function sequenceStepCount(node: NodeV1): number | undefined {
  if (!isSequenceNodeType(node)) {
    return undefined;
  }
  const value = node.dynamicPortState?.[STEP_COUNT_KEY];
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAXIMUM_SEQUENCE_STEP_COUNT
    ? value
    : undefined;
}

export function sequenceOrder(node: NodeV1): readonly string[] | undefined {
  if (!isSequenceNodeType(node)) {
    return undefined;
  }
  const value = node.dynamicPortState?.[SEQUENCE_ORDER_KEY];
  const count = sequenceStepCount(node);
  return count !== undefined && isValidSequenceOrder(value, count)
    ? value
    : undefined;
}

export function sequenceOrderForCount(
  node: NodeV1,
  stepCount: number,
): readonly string[] {
  const authored = sequenceOrder(node);
  return authored?.length === stepCount
    ? authored
    : naturalSequenceOrder(stepCount);
}

export function sequenceOrderForNode(node: NodeV1): readonly string[] {
  const count = sequenceStepCount(node) ?? DEFAULT_SEQUENCE_STEP_COUNT;
  return sequenceOrderForCount(node, count);
}

export function initialDynamicPortState(
  typeKey: string,
): NodeV1["dynamicPortState"] | undefined {
  if (typeKey === "core.flow.sequence") {
    return {
      [STEP_COUNT_KEY]: DEFAULT_SEQUENCE_STEP_COUNT,
      [SEQUENCE_ORDER_KEY]: naturalSequenceOrder(DEFAULT_SEQUENCE_STEP_COUNT),
    };
  }
  if (typeKey === "core.flow.sequenceOrder") {
    return {
      [STEP_COUNT_KEY]: DEFAULT_SEQUENCE_STEP_COUNT,
      [SEQUENCE_ORDER_KEY]: naturalSequenceOrder(DEFAULT_SEQUENCE_STEP_COUNT),
    };
  }
  if (typeKey === "core.flow.parallel") {
    return { [PARALLEL_BRANCH_COUNT_KEY]: DEFAULT_PARALLEL_BRANCH_COUNT };
  }
  if (
    typeKey === "core.math.expression" ||
    typeKey === "core.logic.numberSelect"
  ) {
    return { [NUMERIC_INPUT_COUNT_KEY]: DEFAULT_NUMERIC_INPUT_COUNT };
  }
  if (
    typeKey === "core.collection.imageList" ||
    typeKey === "core.collection.regionList" ||
    typeKey === "core.collection.pointList"
  ) {
    return { [COLLECTION_ITEM_COUNT_KEY]: DEFAULT_COLLECTION_ITEM_COUNT };
  }
  return typeKey === "core.logic.taskChoice"
    ? initialTaskChoiceDynamicPortState()
    : undefined;
}

export function withSequenceStepCount(node: NodeV1, count: number): NodeV1 {
  if (
    !isSequenceNodeType(node) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAXIMUM_SEQUENCE_STEP_COUNT
  ) {
    return node;
  }
  const previousCount = sequenceStepCount(node) ?? Math.max(0, count - 1);
  const previousOrder = sequenceOrderForCount(node, previousCount);
  const allowed = new Set(naturalSequenceOrder(count));
  const nextOrder = [
    ...previousOrder.filter((stepId) => allowed.has(stepId)),
    ...naturalSequenceOrder(count).filter(
      (stepId) => !previousOrder.includes(stepId),
    ),
  ];
  return {
    ...node,
    dynamicPortState: {
      ...(node.dynamicPortState ?? {}),
      [STEP_COUNT_KEY]: count,
      [SEQUENCE_ORDER_KEY]: nextOrder,
    },
  };
}

export function withSequenceOrder(
  node: NodeV1,
  order: readonly string[],
): NodeV1 {
  if (!isSequenceNodeType(node)) {
    return node;
  }
  const count = sequenceStepCount(node) ?? order.length;
  if (!isValidSequenceOrder(order, count)) {
    return node;
  }
  return {
    ...node,
    dynamicPortState: {
      ...(node.dynamicPortState ?? {}),
      [STEP_COUNT_KEY]: count,
      [SEQUENCE_ORDER_KEY]: [...order],
    },
  };
}

export function moveSequenceOrder(
  order: readonly string[],
  stepId: string,
  direction: SequenceMoveDirection,
): readonly string[] | undefined {
  const index = order.indexOf(stepId);
  if (index < 0) {
    return undefined;
  }
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= order.length) {
    return undefined;
  }
  const next = [...order];
  const target = next[targetIndex];
  const current = next[index];
  if (target === undefined || current === undefined) {
    return undefined;
  }
  next[index] = target;
  next[targetIndex] = current;
  return next;
}

function boundedDynamicCount(
  node: NodeV1,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = node.dynamicPortState?.[key];
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

export function parallelBranchCount(node: NodeV1): number | undefined {
  return node.typeKey === "core.flow.parallel"
    ? boundedDynamicCount(
        node,
        PARALLEL_BRANCH_COUNT_KEY,
        DEFAULT_PARALLEL_BRANCH_COUNT,
        MAXIMUM_PARALLEL_BRANCH_COUNT,
      )
    : undefined;
}

export function numericInputCount(node: NodeV1): number | undefined {
  return node.typeKey === "core.math.expression" ||
    node.typeKey === "core.logic.numberSelect"
    ? boundedDynamicCount(
        node,
        NUMERIC_INPUT_COUNT_KEY,
        2,
        MAXIMUM_NUMERIC_INPUT_COUNT,
      )
    : undefined;
}

export function collectionItemCount(node: NodeV1): number | undefined {
  return node.typeKey === "core.collection.imageList" ||
    node.typeKey === "core.collection.regionList" ||
    node.typeKey === "core.collection.pointList"
    ? boundedDynamicCount(
        node,
        COLLECTION_ITEM_COUNT_KEY,
        1,
        MAXIMUM_COLLECTION_ITEM_COUNT,
      )
    : undefined;
}

export function withDynamicPortCount(node: NodeV1, count: number): NodeV1 {
  const key =
    node.typeKey === "core.flow.parallel"
      ? PARALLEL_BRANCH_COUNT_KEY
      : node.typeKey === "core.math.expression" ||
          node.typeKey === "core.logic.numberSelect"
        ? NUMERIC_INPUT_COUNT_KEY
        : node.typeKey === "core.collection.imageList" ||
            node.typeKey === "core.collection.regionList" ||
            node.typeKey === "core.collection.pointList"
          ? COLLECTION_ITEM_COUNT_KEY
          : undefined;
  const isCollection =
    node.typeKey === "core.collection.imageList" ||
    node.typeKey === "core.collection.regionList" ||
    node.typeKey === "core.collection.pointList";
  if (
    key === undefined ||
    (isCollection &&
      (!Number.isInteger(count) ||
        count < 1 ||
        count > MAXIMUM_COLLECTION_ITEM_COUNT))
  ) {
    return node;
  }
  return {
    ...node,
    dynamicPortState: { ...(node.dynamicPortState ?? {}), [key]: count },
  };
}

export function isVisibleSequencePort(node: NodeV1, portId: string): boolean {
  if (node.typeKey !== "core.flow.sequence") {
    return true;
  }
  const count = sequenceStepCount(node);
  if (count === undefined) {
    return !/^step\d+$/.test(portId);
  }
  if (portId === "steps") {
    return false;
  }
  const match = /^step(\d+)$/.exec(portId);
  return match === null || Number(match[1]) <= count;
}

function isVisibleParallelPort(node: NodeV1, portId: string): boolean {
  if (node.typeKey !== "core.flow.parallel") {
    return true;
  }
  const match = /^branch(\d+)$/.exec(portId);
  return match === null || Number(match[1]) <= (parallelBranchCount(node) ?? 2);
}

function isVisibleNumericInputPort(node: NodeV1, portId: string): boolean {
  if (
    node.typeKey !== "core.math.expression" &&
    node.typeKey !== "core.logic.numberSelect"
  ) {
    return true;
  }
  const index = NUMERIC_INPUT_PORT_IDS.indexOf(portId);
  return index < 0 || index < (numericInputCount(node) ?? 3);
}

function isVisibleCollectionItemPort(node: NodeV1, portId: string): boolean {
  if (
    node.typeKey !== "core.collection.imageList" &&
    node.typeKey !== "core.collection.regionList" &&
    node.typeKey !== "core.collection.pointList"
  ) {
    return true;
  }
  const match = /^item(\d+)$/.exec(portId);
  return match === null || Number(match[1]) <= (collectionItemCount(node) ?? 2);
}

/** Dynamic visibility is kept in one projection helper so the canvas and connection
 * affordances agree about which bounded branches are currently authored. */
export function isVisibleDynamicPort(node: NodeV1, portId: string): boolean {
  return (
    isVisibleSequencePort(node, portId) &&
    isVisibleParallelPort(node, portId) &&
    isVisibleNumericInputPort(node, portId) &&
    isVisibleCollectionItemPort(node, portId) &&
    isVisibleCaseCatalogPort(node, portId)
  );
}
