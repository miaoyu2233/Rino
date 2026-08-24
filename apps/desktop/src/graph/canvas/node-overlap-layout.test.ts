import { describe, expect, it } from "vitest";

import {
  NODE_LAYOUT_GRID_SIZE,
  NODE_LAYOUT_HORIZONTAL_GAP,
  NODE_LAYOUT_VERTICAL_GAP,
  hasNodeOverlap,
  resolveNodeOverlaps,
  type NodeOverlapLayoutNode,
} from "./node-overlap-layout";

function node(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 60,
): NodeOverlapLayoutNode {
  return { id, x, y, width, height };
}

function expectSafeLayout(
  nodes: readonly NodeOverlapLayoutNode[],
  horizontalGap = NODE_LAYOUT_HORIZONTAL_GAP,
  verticalGap = NODE_LAYOUT_VERTICAL_GAP,
): void {
  for (const item of nodes) {
    expect(Number.isFinite(item.x)).toBe(true);
    expect(Number.isFinite(item.y)).toBe(true);
    expect(Math.abs(item.x % NODE_LAYOUT_GRID_SIZE)).toBe(0);
    expect(Math.abs(item.y % NODE_LAYOUT_GRID_SIZE)).toBe(0);
  }
  expect(
    hasNodeOverlap(nodes, {
      horizontalGap,
      verticalGap,
    }),
  ).toBe(false);
}

describe("resolveNodeOverlaps", () => {
  it("does not move nodes that already have enough space", () => {
    const input = [node("a", 0, 0), node("b", 192, 0)];

    expect(resolveNodeOverlaps(input)).toEqual(input);
  });

  it("moves a horizontally crowded node to the nearer safe axis", () => {
    const result = resolveNodeOverlaps([node("a", 0, 0), node("b", 32, 0)]);

    expect(result).toEqual([node("a", 0, 0), node("b", 32, 96)]);
    expectSafeLayout(result);
  });

  it("honours horizontal priority when a rightward continuation is crowded", () => {
    const result = resolveNodeOverlaps([
      node("a", 0, 0),
      { ...node("b", 32, 0), preferHorizontal: true },
    ]);

    expect(result[1]).toMatchObject({ x: 160, y: 0, preferHorizontal: true });
    expectSafeLayout(result);
  });

  it("moves a vertically crowded node down when that is nearer", () => {
    const result = resolveNodeOverlaps([node("a", 0, 0), node("b", 0, 16)]);

    expect(result).toEqual([node("a", 0, 0), node("b", 0, 96)]);
    expectSafeLayout(result);
  });

  it("uses measured height when resolving a tall node", () => {
    const result = resolveNodeOverlaps([
      node("a", 0, 0, 100, 180),
      node("b", 0, 16, 100, 40),
    ]);

    expect(result[1]?.x).toBe(160);
    expectSafeLayout(result);
  });

  it("keeps an axis candidate safe from a distant wide obstacle", () => {
    const result = resolveNodeOverlaps([
      node("anchor", 0, 0, 100, 400),
      node("wide-obstacle", 200, -20, 1000, 40),
      node("crowded", 32, 0, 100, 40),
    ]);

    expectSafeLayout(result);
    expect(result.find((item) => item.id === "crowded")?.y).toBe(432);
  });

  it("resolves a chain without moving earlier nodes", () => {
    const input = [node("a", 0, 0), node("b", 0, 0), node("c", 0, 0)];
    const result = resolveNodeOverlaps(input);

    expect(result[0]).toEqual(input[0]);
    expect(result[1]).not.toEqual(input[1]);
    expect(result[2]).not.toEqual(input[2]);
    expectSafeLayout(result);
  });

  it("keeps a horizontally preferred chain collision-free", () => {
    const result = resolveNodeOverlaps([
      node("a", 0, 0),
      { ...node("b", 32, 0), preferHorizontal: true },
      { ...node("c", 64, 0), preferHorizontal: true },
    ]);

    expect(result[1]?.x).toBeGreaterThan(result[0]?.x ?? 0);
    expect(result[2]?.x).toBeGreaterThan(result[1]?.x ?? 0);
    expectSafeLayout(result);
  });

  it("uses y, x, then id as a deterministic placement order", () => {
    const input = [node("z", 0, 0), node("a", 0, 0), node("m", 0, 0)];
    const first = resolveNodeOverlaps(input);
    const second = resolveNodeOverlaps([...input].reverse());

    const byId = (items: readonly NodeOverlapLayoutNode[]) =>
      new Map(items.map((item) => [item.id, item]));
    expect(
      [...byId(first).entries()].sort(([firstId], [secondId]) =>
        firstId.localeCompare(secondId),
      ),
    ).toEqual(
      [...byId(second).entries()].sort(([firstId], [secondId]) =>
        firstId.localeCompare(secondId),
      ),
    );
    expect(first.find((item) => item.id === "a")?.x).toBe(0);
  });

  it("checks actual overlap separately from the safety gap", () => {
    const input = [node("a", 0, 0), node("b", 112, 0)];

    expect(hasNodeOverlap(input, { horizontalGap: 0, verticalGap: 0 })).toBe(
      false,
    );
    expect(hasNodeOverlap(input)).toBe(true);
    expectSafeLayout(resolveNodeOverlaps(input));
  });

  it("sanitizes invalid dimensions and coordinates without non-finite output", () => {
    const result = resolveNodeOverlaps([
      node("a", Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, -1),
      node("b", 0, 0),
    ]);

    expectSafeLayout(result);
  });

  it("keeps three maximum-size nodes safe at the maximum origin", () => {
    const result = resolveNodeOverlaps(
      [
        node("a", 1_000_000_000_000, 1_000_000_000_000, 1_000_000, 1_000_000),
        node("b", 1_000_000_000_000, 1_000_000_000_000, 1_000_000, 1_000_000),
        node("c", 1_000_000_000_000, 1_000_000_000_000, 1_000_000, 1_000_000),
      ],
      { horizontalGap: 1_000_000, verticalGap: 1_000_000 },
    );
    expectSafeLayout(result, 1_000_000, 1_000_000);
  });

  it("keeps horizontal maximum spacing finite at the maximum origin", () => {
    const result = resolveNodeOverlaps(
      [
        node("a", 1_000_000_000_000, 1_000_000_000_000, 1_000_000, 1_000_000),
        node("b", 1_000_000_000_000, 1_000_000_000_000, 1_000_000, 1_000_000),
        node("c", 1_000_000_000_000, 1_000_000_000_000, 1_000_000, 1_000_000),
      ],
      { horizontalGap: 1_000_000, verticalGap: 0 },
    );

    expectSafeLayout(result, 1_000_000, 0);
  });

  it("keeps vertical maximum spacing finite at the maximum origin", () => {
    const result = resolveNodeOverlaps(
      [
        node("a", 1_000_000_000_000, 1_000_000_000_000, 1_000_000, 1_000_000),
        node("b", 1_000_000_000_000, 1_000_000_000_000, 1_000_000, 1_000_000),
        node("c", 1_000_000_000_000, 1_000_000_000_000, 1_000_000, 1_000_000),
      ],
      { horizontalGap: 0, verticalGap: 1_000_000 },
    );

    expectSafeLayout(result, 0, 1_000_000);
  });
});
