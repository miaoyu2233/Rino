import { describe, expect, it } from "vitest";
import type { NodeV1 } from "@rino/contracts";

import {
  DEFAULT_COLLECTION_ITEM_COUNT,
  DEFAULT_SEQUENCE_STEP_COUNT,
  collectionItemCount,
  initialDynamicPortState,
  isValidSequenceOrder,
  isVisibleDynamicPort,
  isVisibleSequencePort,
  moveSequenceOrder,
  sequenceOrder,
  sequenceOrderForNode,
  withDynamicPortCount,
  sequenceStepCount,
  withSequenceStepCount,
} from "./sequence-node";

function sequenceNode(dynamicPortState?: NodeV1["dynamicPortState"]): NodeV1 {
  return {
    nodeId: "10000000-0000-4000-8000-000000000001",
    typeKey: "core.flow.sequence",
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
    ...(dynamicPortState === undefined ? {} : { dynamicPortState }),
  };
}

function typedNode(
  typeKey: string,
  dynamicPortState?: NodeV1["dynamicPortState"],
): NodeV1 {
  return {
    nodeId: "10000000-0000-4000-8000-000000000002",
    typeKey,
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
    ...(dynamicPortState === undefined ? {} : { dynamicPortState }),
  };
}

describe("sequence node dynamic ports", () => {
  it("initializes new sequence nodes with two visible steps", () => {
    const state = initialDynamicPortState("core.flow.sequence");
    const node = sequenceNode(state);

    expect(state).toEqual({
      sequenceStepCount: DEFAULT_SEQUENCE_STEP_COUNT,
      sequenceOrder: ["step1", "step2"],
    });
    expect(sequenceStepCount(node)).toBe(DEFAULT_SEQUENCE_STEP_COUNT);
    expect(isVisibleSequencePort(node, "steps")).toBe(false);
    expect(isVisibleSequencePort(node, "step1")).toBe(true);
    expect(isVisibleSequencePort(node, "step2")).toBe(true);
    expect(isVisibleSequencePort(node, "step3")).toBe(false);
  });

  it("keeps the legacy fan-out port visible until the user adds a step", () => {
    const node = sequenceNode();

    expect(sequenceStepCount(node)).toBeUndefined();
    expect(isVisibleSequencePort(node, "steps")).toBe(true);
    expect(isVisibleSequencePort(node, "step1")).toBe(false);
  });

  it("updates only valid sequence step counts", () => {
    const node = sequenceNode();
    expect(sequenceStepCount(withSequenceStepCount(node, 4))).toBe(4);
    expect(withSequenceStepCount(node, 17)).toBe(node);
  });

  it("preserves authored order and appends a new step", () => {
    const node = sequenceNode({
      sequenceStepCount: 3,
      sequenceOrder: ["step3", "step1", "step2"],
    });

    expect(withSequenceStepCount(node, 4).dynamicPortState).toEqual({
      sequenceStepCount: 4,
      sequenceOrder: ["step3", "step1", "step2", "step4"],
    });
  });

  it("shares strict order validation with the order configuration node", () => {
    const state = initialDynamicPortState("core.flow.sequenceOrder");
    const node = typedNode("core.flow.sequenceOrder", state);

    expect(sequenceOrder(node)).toEqual(["step1", "step2"]);
    expect(sequenceOrderForNode(node)).toEqual(["step1", "step2"]);
    expect(isValidSequenceOrder(["step2", "step1"], 2)).toBe(true);
    expect(isValidSequenceOrder(["step1", "step1"], 2)).toBe(false);
  });

  it("moves adjacent order entries and treats boundaries as no-ops", () => {
    const order = ["step3", "step1", "step2"];

    expect(moveSequenceOrder(order, "step1", "up")).toEqual([
      "step1",
      "step3",
      "step2",
    ]);
    expect(moveSequenceOrder(order, "step1", "down")).toEqual([
      "step3",
      "step2",
      "step1",
    ]);
    expect(moveSequenceOrder(order, "step3", "up")).toBeUndefined();
    expect(moveSequenceOrder(order, "step2", "down")).toBeUndefined();
  });

  it("keeps multiple recognition list items bounded and dynamically visible", () => {
    const state = initialDynamicPortState("core.collection.imageList");
    const node = typedNode("core.collection.imageList", state);

    expect(collectionItemCount(node)).toBe(DEFAULT_COLLECTION_ITEM_COUNT);
    expect(isVisibleDynamicPort(node, "item1")).toBe(true);
    expect(isVisibleDynamicPort(node, "item2")).toBe(true);
    expect(isVisibleDynamicPort(node, "item3")).toBe(false);

    const expanded = withDynamicPortCount(node, 3);
    expect(collectionItemCount(expanded)).toBe(3);
    expect(isVisibleDynamicPort(expanded, "item3")).toBe(true);
    expect(isVisibleDynamicPort(expanded, "item4")).toBe(false);
  });

  it("uses the same bounded collection controls for click point lists", () => {
    const node = typedNode(
      "core.collection.pointList",
      initialDynamicPortState("core.collection.pointList"),
    );

    expect(collectionItemCount(node)).toBe(DEFAULT_COLLECTION_ITEM_COUNT);
    expect(isVisibleDynamicPort(node, "item2")).toBe(true);
    expect(isVisibleDynamicPort(node, "item3")).toBe(false);
    const maximum = withDynamicPortCount(node, 16);
    expect(collectionItemCount(maximum)).toBe(16);
    expect(isVisibleDynamicPort(maximum, "item16")).toBe(true);
    expect(isVisibleDynamicPort(maximum, "item17")).toBe(false);
    expect(collectionItemCount(withDynamicPortCount(node, 17))).toBe(
      DEFAULT_COLLECTION_ITEM_COUNT,
    );
  });
});
