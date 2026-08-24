import { describe, expect, it } from "vitest";

import {
  alignNodeToRow,
  type NodeRowAlignmentNode,
} from "./node-row-alignment";

function node(
  id: string,
  x: number,
  y: number,
  width = 100,
): NodeRowAlignmentNode {
  return { id, x, y, width, height: 40 };
}

function countedNode(
  value: NodeRowAlignmentNode,
  reads: { value: number },
): NodeRowAlignmentNode {
  return new Proxy(value, {
    get(target, property, receiver) {
      if (
        property === "id" ||
        property === "x" ||
        property === "y" ||
        property === "width" ||
        property === "height"
      ) {
        reads.value += 1;
      }
      return Reflect.get(
        target,
        property,
        receiver,
      ) as NodeRowAlignmentNode[keyof NodeRowAlignmentNode];
    },
  });
}

describe("alignNodeToRow", () => {
  it("aligns a nearby row after snapping the moving position to the grid", () => {
    const result = alignNodeToRow(
      [node("moving", 0, 103)],
      [node("stationary", 140, 112)],
      { zoom: 1 },
    );

    expect(result).toMatchObject({
      candidateId: "stationary",
      alignedY: 112,
      deltaY: 9,
    });
  });

  it("keeps a non-grid candidate's persisted row exactly", () => {
    const result = alignNodeToRow(
      [node("moving", 0, 143)],
      [node("imported", 140, 150)],
      { zoom: 1 },
    );

    expect(result).toMatchObject({
      candidateId: "imported",
      alignedY: 150,
      deltaY: 7,
    });
  });

  it("does not align outside the screen-distance threshold", () => {
    expect(
      alignNodeToRow([node("moving", 0, 100)], [node("stationary", 140, 120)], {
        zoom: 1,
      }),
    ).toBeUndefined();
  });

  it("chooses the nearest row and breaks ties by y then id", () => {
    const result = alignNodeToRow(
      [node("moving", 0, 100)],
      [
        node("z-row", 140, 108),
        node("a-row", 140, 108),
        node("near", 140, 104),
      ],
      { zoom: 1 },
    );

    expect(result?.candidateId).toBe("near");
    expect(
      alignNodeToRow(
        [node("moving", 0, 100)],
        [node("z-row", 140, 108), node("a-row", 140, 108)],
        { zoom: 1 },
      )?.candidateId,
    ).toBe("a-row");
  });

  it("skips candidates that overlap horizontally", () => {
    expect(
      alignNodeToRow(
        [node("moving", 0, 100)],
        [node("overlapping", 50, 108), node("side-by-side", 120, 108)],
        { zoom: 1 },
      )?.candidateId,
    ).toBe("side-by-side");
  });

  it("uses one common delta for a multi-node move and excludes moving nodes", () => {
    const moving = [node("a", 0, 100), node("b", 120, 140)];
    const result = alignNodeToRow(
      moving,
      [...moving, node("stationary", 260, 108)],
      { zoom: 1 },
    );

    expect(result).toMatchObject({ candidateId: "stationary", deltaY: 8 });
    expect(moving.map((item) => item.y + (result?.deltaY ?? 0))).toEqual([
      108, 148,
    ]);
  });

  it("keeps the minimum grid step in the threshold at high zoom", () => {
    expect(
      alignNodeToRow([node("moving", 0, 100)], [node("stationary", 140, 108)], {
        zoom: 4,
      })?.candidateId,
    ).toBe("stationary");
    expect(
      alignNodeToRow([node("moving", 0, 100)], [node("stationary", 140, 117)], {
        zoom: 4,
      }),
    ).toBeUndefined();
  });

  it("keeps candidate reads within a linear budget for 100 and 256 nodes", () => {
    for (const nodeCount of [100, 256]) {
      const reads = { value: 0 };
      const stationaryNodes = Array.from(
        { length: nodeCount - 1 },
        (_, index) =>
          countedNode(
            node(
              `row-${index.toString().padStart(3, "0")}`,
              140 + index * 240,
              108,
            ),
            reads,
          ),
      );

      const result = alignNodeToRow([node("moving", 0, 100)], stationaryNodes, {
        zoom: 1,
      });

      expect(result?.candidateId).toBe("row-000");
      expect(reads.value).toBeLessThanOrEqual((nodeCount - 1) * 4);
    }
  });
});
