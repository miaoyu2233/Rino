import { NODE_HEADER_HEIGHT } from "./graph-view-model";

const ESTIMATED_GRID_SIZE = 16;
const ESTIMATED_MIN_HEIGHT = NODE_HEADER_HEIGHT + ESTIMATED_GRID_SIZE * 2;
const ESTIMATED_ROW_HEIGHT = 24;
const ESTIMATED_SECTION_PADDING = 16;
const MAX_ESTIMATED_HEIGHT = 1_000_000;

interface LayoutPortEstimate {
  portKind: "execution" | "data";
}

/** The projection fields that can affect the rendered node's height. Keeping this
 * structural makes the estimator pure and usable without constructing React Flow nodes. */
export interface NodeLayoutSizeData {
  typeKey?: string;
  inputs?: readonly LayoutPortEstimate[];
  outputs?: readonly LayoutPortEstimate[];
  propertyFields?: readonly unknown[];
  logControl?: {
    segmentKinds: readonly unknown[];
  };
  sequenceControl?: {
    stepCount: number;
  };
  workflowGroup?: {
    steps: readonly unknown[];
    recognitionRepeat?: {
      enabled: boolean;
    };
    imageRecognitionParameters?: unknown;
    textRecognitionParameters?: unknown;
  };
}

function finiteCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(4096, Math.floor(value));
}

function sectionHeight(rows: number): number {
  return rows <= 0
    ? 0
    : ESTIMATED_SECTION_PADDING + rows * ESTIMATED_ROW_HEIGHT;
}

function portSectionRows(
  inputs: readonly LayoutPortEstimate[],
  outputs: readonly LayoutPortEstimate[],
  kind: LayoutPortEstimate["portKind"],
): number {
  const inputCount = inputs.filter((port) => port.portKind === kind).length;
  const outputCount = outputs.filter((port) => port.portKind === kind).length;
  return Math.max(inputCount, outputCount);
}

function workflowParameterRows(
  workflowGroup: NonNullable<NodeLayoutSizeData["workflowGroup"]>,
): number {
  let rows = 1; // The workflow step summary is always rendered.
  rows += finiteCount(workflowGroup.steps.length);
  if (workflowGroup.imageRecognitionParameters !== undefined) {
    rows += 4;
  }
  if (workflowGroup.textRecognitionParameters !== undefined) {
    rows += 5;
  }
  if (workflowGroup.recognitionRepeat !== undefined) {
    rows += workflowGroup.recognitionRepeat.enabled ? 2 : 1;
  }
  return rows;
}

/** Estimates the rendered node height before React Flow has measured it.
 *
 * The estimate intentionally errs high: a conservative rectangle prevents a virtualized
 * large graph from reintroducing collisions that a measured small graph would catch. It
 * follows the projected port, property, log, coordinate-picker, sequence, and workflow
 * fields rather than any individual project's node types or coordinates.
 */
export function estimateNodeHeight(data: NodeLayoutSizeData): number {
  const inputs = data.inputs ?? [];
  const outputs = data.outputs ?? [];
  let height = NODE_HEADER_HEIGHT + ESTIMATED_GRID_SIZE;

  height += sectionHeight(portSectionRows(inputs, outputs, "execution"));
  height += sectionHeight(portSectionRows(inputs, outputs, "data"));

  const propertyCount = finiteCount(data.propertyFields?.length);
  if (propertyCount > 0) {
    height += sectionHeight(Math.min(2, propertyCount));
    if (propertyCount > 2) {
      height += ESTIMATED_ROW_HEIGHT;
    }
  }

  if (data.logControl !== undefined) {
    height += sectionHeight(
      finiteCount(data.logControl.segmentKinds.length) + 2,
    );
  }

  if (
    data.typeKey === "core.geometry.point" ||
    data.typeKey === "core.geometry.rectangle" ||
    data.typeKey === "automation.clickPoint"
  ) {
    height += ESTIMATED_ROW_HEIGHT + ESTIMATED_SECTION_PADDING;
  }

  if (data.sequenceControl !== undefined) {
    height += ESTIMATED_ROW_HEIGHT + ESTIMATED_SECTION_PADDING;
  }

  if (data.workflowGroup !== undefined) {
    height += sectionHeight(workflowParameterRows(data.workflowGroup));
  }

  if (data.typeKey === "automation.touchAction") {
    height += sectionHeight(2);
  }

  return Math.min(
    MAX_ESTIMATED_HEIGHT,
    Math.max(
      ESTIMATED_MIN_HEIGHT,
      Math.ceil(height / ESTIMATED_GRID_SIZE) * ESTIMATED_GRID_SIZE,
    ),
  );
}
