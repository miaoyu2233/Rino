import type { GraphV1, NodeV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import { buildSetCoordinateSelectionCommand } from "./coordinate-node-commands";

function graphWith(node: NodeV1): GraphV1 {
  return {
    graphId: "89d7d0e1-5a91-47d8-b969-65f95a5b36dc",
    name: "Main",
    kind: "entry",
    nodes: [node],
    edges: [],
  };
}

const pointNode: NodeV1 = {
  nodeId: "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f",
  typeKey: "core.geometry.point",
  typeVersion: 1,
  position: { x: 0, y: 0 },
  properties: {},
  inputValues: {},
};

describe("coordinate-node commands", () => {
  it("sets a complete point selection as one undoable command", () => {
    const result = buildSetCoordinateSelectionCommand(
      graphWith(pointNode),
      pointNode.nodeId,
      {
        kind: "point",
        x: 120,
        y: 340,
        referenceWidth: 1080,
        referenceHeight: 1920,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      command: { kind: "composite", label: "setCoordinateSelection" },
    });
    if (result.ok) {
      expect(result.command.commands).toHaveLength(4);
      expect(result.command.commands.map((command) => command.kind)).toEqual([
        "setInputValue",
        "setInputValue",
        "setInputValue",
        "setInputValue",
      ]);
    }
  });

  it("switches a click node to direct coordinates before storing the point", () => {
    const clickNode: NodeV1 = {
      ...pointNode,
      typeKey: "automation.clickPoint",
      properties: { inputMode: "point" },
    };
    const result = buildSetCoordinateSelectionCommand(
      graphWith(clickNode),
      clickNode.nodeId,
      {
        kind: "point",
        x: 120,
        y: 340,
        referenceWidth: 1080,
        referenceHeight: 1920,
      },
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.command.commands).toHaveLength(5);
      expect(result.command.commands[0]).toMatchObject({
        kind: "setNodeProperty",
        propertyKey: "inputMode",
        value: "coordinates",
      });
    }
  });

  it("rejects a selection for the wrong coordinate-node type", () => {
    expect(
      buildSetCoordinateSelectionCommand(
        graphWith(pointNode),
        pointNode.nodeId,
        {
          kind: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          referenceWidth: 1080,
          referenceHeight: 1920,
        },
      ),
    ).toEqual({ ok: false, reason: "nodeTypeMismatch" });
  });
});
