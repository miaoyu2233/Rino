import type { GraphV1 } from "@rino/contracts";

import type { AuthoringCoordinateSelection } from "../../device-preview/authoring-selection";
import type { CompositeCommand, GraphCommand } from "./graph-commands";

export type CoordinateCommandFailure = "nodeMissing" | "nodeTypeMismatch";

export type CoordinateCommandResult =
  | { ok: true; command: CompositeCommand }
  | { ok: false; reason: CoordinateCommandFailure };

function inputCommand(
  graphId: string,
  nodeId: string,
  portId: string,
  value: number,
): GraphCommand {
  return { kind: "setInputValue", graphId, nodeId, portId, value };
}

export function buildSetCoordinateSelectionCommand(
  graph: GraphV1,
  nodeId: string,
  selection: AuthoringCoordinateSelection,
): CoordinateCommandResult {
  const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) {
    return { ok: false, reason: "nodeMissing" };
  }
  const typeMatches =
    selection.kind === "point"
      ? node.typeKey === "core.geometry.point" ||
        node.typeKey === "automation.clickPoint"
      : node.typeKey === "core.geometry.rectangle";
  if (!typeMatches) {
    return { ok: false, reason: "nodeTypeMismatch" };
  }
  const values: readonly (readonly [string, number])[] = [
    ["x", selection.x],
    ["y", selection.y],
    ...(selection.kind === "rectangle"
      ? ([
          ["width", selection.width],
          ["height", selection.height],
        ] as const)
      : []),
    ["referenceWidth", selection.referenceWidth],
    ["referenceHeight", selection.referenceHeight],
  ];
  return {
    ok: true,
    command: {
      kind: "composite",
      label: "setCoordinateSelection",
      commands: [
        ...(node.typeKey === "automation.clickPoint"
          ? ([
              {
                kind: "setNodeProperty",
                graphId: graph.graphId,
                nodeId: node.nodeId,
                propertyKey: "inputMode",
                value: "coordinates",
              },
            ] satisfies GraphCommand[])
          : []),
        ...values.map(([portId, value]) =>
          inputCommand(graph.graphId, node.nodeId, portId, value),
        ),
      ],
    },
  };
}
