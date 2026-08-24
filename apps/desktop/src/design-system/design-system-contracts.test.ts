import { describe, expect, it } from "vitest";

import { motionDurations, motionTransitions } from "./motion";
import {
  interactionSizeTokens,
  nodeCategoryColorTokens,
  nodeStatusColorTokens,
  portColorTokens,
  semanticColorTokens,
  tooltipTiers,
} from "./tokens";

describe("design-system contracts", () => {
  it("registers every semantic color family without raw component colors", () => {
    expect(semanticColorTokens).toContain("--background");
    expect(semanticColorTokens).toContain("--surface-elevated");
    expect(semanticColorTokens).toContain("--text-primary");
    expect(semanticColorTokens).toContain("--accent");
    expect(semanticColorTokens).toContain("--success");
    expect(semanticColorTokens).toContain("--warning");
    expect(semanticColorTokens).toContain("--danger");
    expect(semanticColorTokens).toContain("--info");
  });

  it("registers typed ports, node categories, and non-color node states", () => {
    expect(Object.keys(portColorTokens)).toEqual([
      "execution",
      "boolean",
      "number",
      "string",
      "image",
      "spatial",
      "recognition",
      "collection",
      "unknown",
    ]);
    expect(Object.keys(nodeCategoryColorTokens)).toEqual([
      "flow",
      "logic",
      "values",
      "text",
      "vision",
      "device",
      "timing",
      "diagnostics",
    ]);
    expect(Object.keys(nodeStatusColorTokens)).toEqual([
      "idle",
      "hovered",
      "selected",
      "running",
      "succeeded",
      "failed",
      "disabled",
      "breakpoint",
    ]);
  });

  it("defines all three bounded motion tiers and a restrained spring", () => {
    expect(motionDurations).toEqual({
      micro: 0.12,
      standard: 0.19,
      panel: 0.25,
    });
    expect(Math.max(...Object.values(motionDurations))).toBeLessThanOrEqual(
      0.28,
    );
    expect(motionTransitions.spatialSpring).toMatchObject({
      type: "spring",
      stiffness: 420,
      damping: 34,
    });
    expect(motionTransitions.micro).toMatchObject({
      ease: [0.16, 1, 0.3, 1],
    });
    expect(motionTransitions.panel).toMatchObject({
      ease: [0.22, 1, 0.36, 1],
    });
  });

  it("registers stable logical-pixel interaction dimensions", () => {
    expect(interactionSizeTokens).toEqual({
      compactControl: "--control-height-compact",
      standardControl: "--control-height-standard",
      smallIcon: "--icon-size-small",
      standardIcon: "--icon-size-standard",
      largeIcon: "--icon-size-large",
      visiblePort: "--port-visible-size",
      portHitArea: "--port-hit-size",
      border: "--border-width",
      focusRing: "--focus-ring-width",
    });
    expect(tooltipTiers).toEqual({
      brief: { delayMilliseconds: 300, maximumWidthRem: 20 },
      standard: { delayMilliseconds: 500, maximumWidthRem: 20 },
      detailed: { delayMilliseconds: 700, maximumWidthRem: 20 },
    });
  });
});
