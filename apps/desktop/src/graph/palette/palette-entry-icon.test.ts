import { describe, expect, it } from "vitest";

import { paletteIconForEntry } from "./palette-entry-icon";
import type { PaletteEntry } from "./palette-model";

function entry(key: string, iconKey = "node.variable"): PaletteEntry {
  return {
    key,
    kind: "node",
    titleKey: "node.core.value.number.title",
    descriptionKey: "node.core.value.number.description",
    iconKey,
    category: "values",
    keywordKeys: [],
    requiredCapabilities: [],
    ports: [],
  };
}

describe("paletteIconForEntry", () => {
  it("distinguishes actual registry nodes that previously shared generic icons", () => {
    expect(paletteIconForEntry(entry("core.flow.sequence"))).not.toBe(
      paletteIconForEntry(entry("core.flow.parallel")),
    );
    expect(paletteIconForEntry(entry("core.math.arithmetic"))).not.toBe(
      paletteIconForEntry(entry("core.logic.numberCompare")),
    );
    expect(paletteIconForEntry(entry("core.time.delay"))).not.toBe(
      paletteIconForEntry(entry("core.flow.boundedRetry")),
    );
    expect(paletteIconForEntry(entry("core.geometry.point"))).not.toBe(
      paletteIconForEntry(entry("core.geometry.rectangle")),
    );
  });

  it("uses direction-specific icons for variable reads and writes", () => {
    expect(paletteIconForEntry(entry("core.variable.getNumber"))).toBe(
      "node.variableGet",
    );
    expect(paletteIconForEntry(entry("core.variable.setNumber"))).toBe(
      "node.variableSet",
    );
  });

  it("uses dedicated icons for literal values and workflow templates", () => {
    expect(paletteIconForEntry(entry("core.value.numberLiteral"))).toBe(
      "node.number",
    );
    expect(paletteIconForEntry(entry("core.value.stringLiteral"))).toBe(
      "node.text",
    );
    expect(paletteIconForEntry(entry("template.imageRecognition"))).toBe(
      "recognition.template",
    );
  });

  it("falls back to a valid registry icon", () => {
    expect(paletteIconForEntry(entry("future.node", "node.ocr"))).toBe(
      "node.ocr",
    );
    expect(paletteIconForEntry(entry("future.node", "unknown.icon"))).toBe(
      "category.flow",
    );
  });
});
