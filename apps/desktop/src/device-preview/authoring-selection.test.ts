import type { NodeV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import {
  createAuthoringPointSelection,
  createAuthoringRectangleSelection,
  createAuthoringSelectionOverlay,
  readAuthoringCoordinateSelection,
} from "./authoring-selection";

const source = {
  width: 1080,
  height: 1920,
  coordinateSpaceId: "source-space",
  sourceGeneration: 7,
};

function node(typeKey: string, inputValues: NodeV1["inputValues"]): NodeV1 {
  return {
    nodeId: "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f",
    typeKey,
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues,
  };
}

function clickPointNode(
  inputMode: "point" | "coordinates",
  inputValues: NodeV1["inputValues"],
): NodeV1 {
  return {
    ...node("automation.clickPoint", inputValues),
    properties: { inputMode },
  };
}

describe("authoring coordinate selections", () => {
  it("strips transient frame identity while preserving the reference resolution", () => {
    expect(
      createAuthoringPointSelection(source, {
        x: 120,
        y: 340,
        coordinateSpaceId: "source-space",
        sourceGeneration: 7,
      }),
    ).toEqual({
      kind: "point",
      x: 120,
      y: 340,
      referenceWidth: 1080,
      referenceHeight: 1920,
    });
    expect(
      createAuthoringRectangleSelection(source, {
        x: 100,
        y: 200,
        width: 300,
        height: 400,
        coordinateSpaceId: "source-space",
        sourceGeneration: 7,
      }),
    ).toMatchObject({ kind: "rectangle", width: 300, height: 400 });
  });

  it("rejects stale identity and geometry outside the source frame", () => {
    expect(
      createAuthoringPointSelection(source, {
        x: 120,
        y: 340,
        coordinateSpaceId: "source-space",
        sourceGeneration: 6,
      }),
    ).toBeUndefined();
    expect(
      createAuthoringRectangleSelection(source, {
        x: 1000,
        y: 200,
        width: 100,
        height: 400,
        coordinateSpaceId: "source-space",
        sourceGeneration: 7,
      }),
    ).toBeUndefined();
  });

  it("reads only complete valid coordinate-node input values", () => {
    expect(
      readAuthoringCoordinateSelection(
        node("core.geometry.point", {
          x: 120,
          y: 340,
          referenceWidth: 1080,
          referenceHeight: 1920,
        }),
      ),
    ).toMatchObject({ kind: "point", x: 120, y: 340 });
    expect(
      readAuthoringCoordinateSelection(
        node("core.geometry.rectangle", {
          x: 900,
          y: 100,
          width: 300,
          height: 400,
          referenceWidth: 1080,
          referenceHeight: 1920,
        }),
      ),
    ).toBeUndefined();
    expect(
      readAuthoringCoordinateSelection(
        clickPointNode("coordinates", {
          x: 120,
          y: 340,
          referenceWidth: 1080,
          referenceHeight: 1920,
        }),
      ),
    ).toMatchObject({ kind: "point", x: 120, y: 340 });
    expect(
      readAuthoringCoordinateSelection(
        clickPointNode("point", {
          x: 120,
          y: 340,
          referenceWidth: 1080,
          referenceHeight: 1920,
        }),
      ),
    ).toBeUndefined();
  });

  it("rebinds a persisted selection only to a matching current resolution", () => {
    const selection = {
      kind: "point" as const,
      x: 120,
      y: 340,
      referenceWidth: 1080,
      referenceHeight: 1920,
    };
    expect(
      createAuthoringSelectionOverlay(selection, source, "selection"),
    ).toMatchObject({
      kind: "point",
      coordinateSpaceId: "source-space",
      sourceGeneration: 7,
    });
    expect(
      createAuthoringSelectionOverlay(
        selection,
        { ...source, width: 720, height: 1280 },
        "selection",
      ),
    ).toBeUndefined();
  });
});
