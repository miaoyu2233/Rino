import type { NodeCategoryV1 } from "@rino/contracts";

export const semanticColorTokens = [
  "--background",
  "--surface",
  "--surface-elevated",
  "--surface-interactive",
  "--surface-interactive-hover",
  "--border",
  "--border-strong",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--accent",
  "--accent-hover",
  "--accent-subtle",
  "--accent-foreground",
  "--focus-ring",
  "--success",
  "--warning",
  "--danger",
  "--info",
] as const;

export const portColorTokens = {
  execution: "--port-exec",
  boolean: "--port-boolean",
  number: "--port-number",
  string: "--port-string",
  image: "--port-image",
  spatial: "--port-spatial",
  recognition: "--port-recognition",
  collection: "--port-collection",
  unknown: "--port-unknown",
} as const;

/** One entry per node category in the registry contract, so a definition can never
 * arrive with a category the interface has no colour for. */
export const nodeCategoryColorTokens = {
  flow: "--category-flow",
  logic: "--category-logic",
  values: "--category-values",
  text: "--category-text",
  vision: "--category-vision",
  device: "--category-device",
  timing: "--category-timing",
  diagnostics: "--category-diagnostics",
} as const satisfies Record<NodeCategoryV1, string>;

export const nodeStatusColorTokens = {
  idle: "--node-idle",
  hovered: "--node-hovered",
  selected: "--node-selected",
  running: "--node-running",
  succeeded: "--node-succeeded",
  failed: "--node-failed",
  disabled: "--node-disabled",
  breakpoint: "--node-breakpoint",
} as const;

export const interactionSizeTokens = {
  compactControl: "--control-height-compact",
  standardControl: "--control-height-standard",
  smallIcon: "--icon-size-small",
  standardIcon: "--icon-size-standard",
  largeIcon: "--icon-size-large",
  visiblePort: "--port-visible-size",
  portHitArea: "--port-hit-size",
  border: "--border-width",
  focusRing: "--focus-ring-width",
} as const;

export const tooltipTiers = {
  brief: { delayMilliseconds: 300, maximumWidthRem: 20 },
  standard: { delayMilliseconds: 500, maximumWidthRem: 20 },
  detailed: { delayMilliseconds: 700, maximumWidthRem: 20 },
} as const;
