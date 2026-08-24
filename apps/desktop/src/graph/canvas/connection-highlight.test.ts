import type {
  EdgeV1,
  GraphV1,
  NodeV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";
import { describe, expect, it } from "vitest";

import coreDefinitions from "../../../../../contracts/fixtures/registry/valid/core-definitions.json";
import { GraphConnectionIndex } from "../connection-rules";
import {
  compatibleConnectionTargets,
  connectionTargetKey,
} from "./connection-highlight";

const registry = coreDefinitions as unknown as RinoNodeRegistrySnapshotV1;

const START = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const BRANCH = "6a5c9b8f-a3b4-4fc0-9be3-5d6e7f809102";
const LITERAL = "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80";
const SECOND_LITERAL = "1c0b9a8d-7e6f-4501-8243-3a2b1c0d9e8f";
const COMPARE = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";
const CAPTURE = "7c6d5e4f-3a2b-4190-8f7e-6d5c4b3a2190";
const OCR = "9a8b7c6d-5e4f-4382-9170-8f7e6d5c4b3a";
const OCCUPIED_EDGE = "8c7ebda1-c5d6-41e2-9d05-7f8091021324";

function node(nodeId: string, typeKey: string): NodeV1 {
  return {
    nodeId,
    typeKey,
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
  };
}

function graphWith(edges: EdgeV1[]): GraphV1 {
  return {
    graphId: "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e",
    name: "主图",
    kind: "entry",
    nodes: [
      node(START, "core.flow.start"),
      node(BRANCH, "core.logic.branch"),
      node(LITERAL, "core.value.numberLiteral"),
      node(SECOND_LITERAL, "core.value.numberLiteral"),
      node(COMPARE, "core.logic.numberCompare"),
      node(CAPTURE, "automation.captureScreen"),
      node(OCR, "vision.ocr"),
    ],
    edges,
  };
}

function literalIntoCompareLeft(): EdgeV1 {
  return {
    edgeId: OCCUPIED_EDGE,
    edgeKind: "data",
    sourceNodeId: LITERAL,
    sourcePortId: "value",
    targetNodeId: COMPARE,
    targetPortId: "left",
  };
}

function targetsFrom(
  graph: GraphV1,
  nodeId: string,
  portId: string,
  handleType: "source" | "target",
): ReadonlySet<string> {
  return compatibleConnectionTargets(
    new GraphConnectionIndex(graph, registry),
    {
      nodeId,
      portId,
      handleType,
    },
  );
}

describe("compatible connection targets", () => {
  it("offers every execution input an execution output can reach", () => {
    const targets = targetsFrom(graphWith([]), START, "next", "source");

    expect(targets).toEqual(
      new Set([
        connectionTargetKey(BRANCH, "run"),
        connectionTargetKey(CAPTURE, "run"),
        connectionTargetKey(OCR, "run"),
      ]),
    );
  });

  it("offers only inputs of the same data type", () => {
    const targets = targetsFrom(graphWith([]), LITERAL, "value", "source");

    expect(targets).toEqual(
      new Set([
        connectionTargetKey(COMPARE, "left"),
        connectionTargetKey(COMPARE, "right"),
        connectionTargetKey(OCR, "confidenceThreshold"),
      ]),
    );
  });

  it("looks for outputs when the drag started at an input", () => {
    const targets = targetsFrom(graphWith([]), BRANCH, "condition", "target");

    expect(targets).toEqual(
      new Set([
        connectionTargetKey(COMPARE, "result"),
        connectionTargetKey(OCR, "matched"),
      ]),
    );
  });

  it("drops a target the connection already reaches", () => {
    const targets = targetsFrom(
      graphWith([literalIntoCompareLeft()]),
      LITERAL,
      "value",
      "source",
    );

    expect(targets.has(connectionTargetKey(COMPARE, "left"))).toBe(false);
    expect(targets.has(connectionTargetKey(COMPARE, "right"))).toBe(true);
  });

  it("still offers an occupied input, because landing there replaces the edge", () => {
    const targets = targetsFrom(
      graphWith([literalIntoCompareLeft()]),
      SECOND_LITERAL,
      "value",
      "source",
    );

    expect(targets.has(connectionTargetKey(COMPARE, "left"))).toBe(true);
  });

  it("never offers a port of the node the drag started from", () => {
    const targets = targetsFrom(graphWith([]), CAPTURE, "next", "source");

    expect(targets.has(connectionTargetKey(CAPTURE, "run"))).toBe(false);
    expect(targets.has(connectionTargetKey(OCR, "run"))).toBe(true);
  });
});
