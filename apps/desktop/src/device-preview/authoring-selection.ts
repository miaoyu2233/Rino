import type { NodeV1 } from "@rino/contracts";

import {
  type SourceCoordinateSpace,
  type SourcePoint,
  type SourceRectangle,
} from "./geometry";
import type { DeviceOverlay } from "./overlay-model";

export interface AuthoringPointSelection {
  kind: "point";
  x: number;
  y: number;
  referenceWidth: number;
  referenceHeight: number;
}

export interface AuthoringRectangleSelection {
  kind: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
  referenceWidth: number;
  referenceHeight: number;
}

export type AuthoringCoordinateSelection =
  AuthoringPointSelection | AuthoringRectangleSelection;

export type CoordinateNodeTypeKey =
  "core.geometry.point" | "core.geometry.rectangle" | "automation.clickPoint";

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValidSource(source: SourceCoordinateSpace): boolean {
  return (
    source.coordinateSpaceId.length > 0 &&
    isPositiveInteger(source.sourceGeneration) &&
    isPositiveInteger(source.width) &&
    isPositiveInteger(source.height)
  );
}

function belongsToSource(
  source: SourceCoordinateSpace,
  value: SourcePoint,
): boolean {
  return (
    value.coordinateSpaceId === source.coordinateSpaceId &&
    value.sourceGeneration === source.sourceGeneration
  );
}

export function createAuthoringPointSelection(
  source: SourceCoordinateSpace,
  point: SourcePoint,
): AuthoringPointSelection | undefined {
  if (
    !isValidSource(source) ||
    !belongsToSource(source, point) ||
    !isNonNegativeInteger(point.x) ||
    !isNonNegativeInteger(point.y) ||
    point.x >= source.width ||
    point.y >= source.height
  ) {
    return undefined;
  }
  return {
    kind: "point",
    x: point.x,
    y: point.y,
    referenceWidth: source.width,
    referenceHeight: source.height,
  };
}

export function createAuthoringRectangleSelection(
  source: SourceCoordinateSpace,
  rectangle: SourceRectangle,
): AuthoringRectangleSelection | undefined {
  if (
    !isValidSource(source) ||
    !belongsToSource(source, rectangle) ||
    !isNonNegativeInteger(rectangle.x) ||
    !isNonNegativeInteger(rectangle.y) ||
    !isPositiveInteger(rectangle.width) ||
    !isPositiveInteger(rectangle.height) ||
    rectangle.x + rectangle.width > source.width ||
    rectangle.y + rectangle.height > source.height
  ) {
    return undefined;
  }
  return {
    kind: "rectangle",
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height,
    referenceWidth: source.width,
    referenceHeight: source.height,
  };
}

function numberInput(node: NodeV1, portId: string): number | undefined {
  const value = node.inputValues[portId];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

export function readAuthoringCoordinateSelection(
  node: NodeV1,
): AuthoringCoordinateSelection | undefined {
  const x = numberInput(node, "x");
  const y = numberInput(node, "y");
  const referenceWidth = numberInput(node, "referenceWidth");
  const referenceHeight = numberInput(node, "referenceHeight");
  if (
    x === undefined ||
    y === undefined ||
    referenceWidth === undefined ||
    referenceHeight === undefined ||
    !isNonNegativeInteger(x) ||
    !isNonNegativeInteger(y) ||
    !isPositiveInteger(referenceWidth) ||
    !isPositiveInteger(referenceHeight)
  ) {
    return undefined;
  }
  if (
    node.typeKey === "core.geometry.point" ||
    (node.typeKey === "automation.clickPoint" &&
      node.properties["inputMode"] === "coordinates")
  ) {
    if (x >= referenceWidth || y >= referenceHeight) {
      return undefined;
    }
    return { kind: "point", x, y, referenceWidth, referenceHeight };
  }
  if (node.typeKey !== "core.geometry.rectangle") {
    return undefined;
  }
  const width = numberInput(node, "width");
  const height = numberInput(node, "height");
  if (
    width === undefined ||
    height === undefined ||
    !isPositiveInteger(width) ||
    !isPositiveInteger(height) ||
    x + width > referenceWidth ||
    y + height > referenceHeight
  ) {
    return undefined;
  }
  return {
    kind: "rectangle",
    x,
    y,
    width,
    height,
    referenceWidth,
    referenceHeight,
  };
}

export function createAuthoringSelectionOverlay(
  selection: AuthoringCoordinateSelection,
  source: SourceCoordinateSpace,
  overlayId: string,
): DeviceOverlay | undefined {
  if (
    !isValidSource(source) ||
    source.width !== selection.referenceWidth ||
    source.height !== selection.referenceHeight
  ) {
    return undefined;
  }
  const identity = {
    overlayId,
    coordinateSpaceId: source.coordinateSpaceId,
    sourceGeneration: source.sourceGeneration,
  };
  if (selection.kind === "point") {
    return {
      ...identity,
      kind: "point",
      point: {
        x: selection.x,
        y: selection.y,
        coordinateSpaceId: source.coordinateSpaceId,
        sourceGeneration: source.sourceGeneration,
      },
    };
  }
  return {
    ...identity,
    kind: "rectangle",
    rectangle: {
      x: selection.x,
      y: selection.y,
      width: selection.width,
      height: selection.height,
      coordinateSpaceId: source.coordinateSpaceId,
      sourceGeneration: source.sourceGeneration,
    },
  };
}
