import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const graphCanvasStyles = readFileSync(
  resolve(process.cwd(), "src/graph/canvas/graph-canvas.css"),
  "utf8",
);

describe("graph canvas performance styles", () => {
  it("opens canvas commands without an entrance animation", () => {
    const rule = graphCanvasStyles.match(
      /^\.graph-canvas-menu\s*\{([^}]*)\}/m,
    )?.[1];
    expect(rule).toContain("animation: none");
  });
  it("does not force compositor promotion across unbounded graph coordinates", () => {
    const viewportRule =
      graphCanvasStyles.match(
        /^\.graph-canvas \.react-flow__viewport\s*\{([^}]*)\}/m,
      )?.[1] ?? "";

    expect(viewportRule).not.toContain("will-change: transform");
    expect(viewportRule).not.toMatch(/translate(?:3d|Z)|scale3d/);
    expect(graphCanvasStyles).not.toMatch(
      /(?:\.rino-edge|\.react-flow__edge|\.react-flow__edges\s+svg)\s*\{[^}]*will-change/ms,
    );
  });

  it("clips graph painting without creating a nested compositor boundary", () => {
    const graphCanvasRule = graphCanvasStyles.match(
      /^\.graph-canvas\s*\{([^}]*)\}/m,
    )?.[1];

    expect(graphCanvasRule).toContain("overflow: hidden");
    expect(graphCanvasRule).not.toContain("isolation: isolate");
    expect(graphCanvasRule).not.toContain("contain: paint");
  });

  it("mounts virtualized nodes without a transparent entrance frame", () => {
    expect(graphCanvasStyles).not.toContain("rino-node-enter");
    expect(graphCanvasStyles).not.toMatch(
      /^\.rino-node\s*\{[^}]*\banimation\s*:/ms,
    );
  });

  it("never hides React Flow behind a replacement canvas", () => {
    expect(graphCanvasStyles).not.toContain(".graph-canvas__dense-overview");
    expect(graphCanvasStyles).not.toContain("data-canvas-overview");
    expect(graphCanvasStyles).not.toMatch(
      /\.react-flow__(?:nodes|edges)\s*\{[^}]*visibility:\s*hidden/ms,
    );
  });

  it("never modulates the whole window brightness during canvas input", () => {
    expect(graphCanvasStyles).not.toContain("canvas-presentation-refresh");
  });
});
