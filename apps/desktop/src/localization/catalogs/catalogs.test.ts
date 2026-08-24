import { describe, expect, it } from "vitest";

import { enUSTranslation, zhCNTranslation } from ".";

function collectLeafEntries(
  value: Readonly<Record<string, unknown>>,
  prefix = "",
): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();

  for (const [key, child] of Object.entries(value)) {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (typeof child === "string") {
      entries.set(path, child);
      continue;
    }

    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      for (const [childPath, translation] of collectLeafEntries(
        child as Readonly<Record<string, unknown>>,
        path,
      )) {
        entries.set(childPath, translation);
      }
      continue;
    }

    throw new TypeError(
      `Translation catalog value at ${path} is not a string.`,
    );
  }

  return entries;
}

describe("localization catalogs", () => {
  it("keeps Simplified Chinese and English key sets identical", () => {
    const chineseEntries = collectLeafEntries(zhCNTranslation);
    const englishEntries = collectLeafEntries(enUSTranslation);

    expect([...chineseEntries.keys()].sort()).toEqual(
      [...englishEntries.keys()].sort(),
    );
  });

  it("contains no blank translations", () => {
    for (const catalog of [zhCNTranslation, enUSTranslation]) {
      for (const translation of collectLeafEntries(catalog).values()) {
        expect(translation.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("defines the initial application and locale preference strings", () => {
    expect(zhCNTranslation.app.title).toBe("Rino");
    expect(zhCNTranslation.locale.preferences.system).toBe("跟随系统");
    expect(enUSTranslation.locale.preferences.system).toBe(
      "Use system setting",
    );
  });
});
