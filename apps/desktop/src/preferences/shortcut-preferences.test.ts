import { beforeEach, describe, expect, it } from "vitest";

import {
  checkShortcutConflict,
  createShortcutPreferenceDocument,
  DEFAULT_SHORTCUT_KEYS,
  normalizeShortcutKey,
  parseShortcutPreferenceDocument,
  SHORTCUT_STORAGE_KEY,
} from "./shortcut-preferences";
import {
  initializeShortcutPreferences,
  useShortcutPreferenceStore,
} from "./shortcut-preference-store";

describe("shortcut preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useShortcutPreferenceStore.getState().resetAll();
  });

  it("normalizes shortcut key combinations cleanly", () => {
    expect(normalizeShortcutKey("ctrl + s")).toBe("Ctrl+S");
    expect(normalizeShortcutKey("ctrl + shift + d")).toBe("Ctrl+Shift+D");
    expect(normalizeShortcutKey("alt+shift+f5")).toBe("Alt+Shift+F5");
    expect(normalizeShortcutKey("f5")).toBe("F5");
    expect(normalizeShortcutKey("delete")).toBe("Delete");
    expect(normalizeShortcutKey("tab")).toBe("Tab");
  });

  it("parses and creates preference documents with version 1", () => {
    const doc = createShortcutPreferenceDocument({
      save: "Ctrl+Alt+S",
      undo: "Ctrl+Z", // same as default, should be omitted
    });
    expect(doc).toEqual({
      version: 1,
      overrides: { save: "Ctrl+Alt+S" },
    });

    const parsed = parseShortcutPreferenceDocument(JSON.stringify(doc));
    expect(parsed.overrides).toEqual({ save: "Ctrl+Alt+S" });
  });

  it("detects shortcut conflicts correctly across scopes", () => {
    const effective = { ...DEFAULT_SHORTCUT_KEYS };

    // "Ctrl+S" is currently assigned to global `save`
    // Attempting to assign "Ctrl+S" to `saveAs` (global) should conflict
    expect(checkShortcutConflict("saveAs", "Ctrl+S", effective)).toBe("save");

    // Assigning a unique combo "Ctrl+Alt+S" should not conflict
    expect(checkShortcutConflict("saveAs", "Ctrl+Alt+S", effective)).toBeNull();

    // Global shortcut "Ctrl+S" conflicts with canvas shortcut "undo" if "undo" becomes "Ctrl+S"
    expect(checkShortcutConflict("undo", "Ctrl+S", effective)).toBe("save");
  });

  it("manages store overrides and resets", () => {
    initializeShortcutPreferences();
    expect(useShortcutPreferenceStore.getState().resolveKeys("save")).toBe(
      "Ctrl+S",
    );

    // Update binding
    useShortcutPreferenceStore.getState().setBinding("save", "Ctrl+Alt+S");
    expect(useShortcutPreferenceStore.getState().resolveKeys("save")).toBe(
      "Ctrl+Alt+S",
    );

    // Single reset
    useShortcutPreferenceStore.getState().resetBinding("save");
    expect(useShortcutPreferenceStore.getState().resolveKeys("save")).toBe(
      "Ctrl+S",
    );

    // Reset all
    useShortcutPreferenceStore.getState().setBinding("save", "Ctrl+Alt+S");
    useShortcutPreferenceStore.getState().setBinding("undo", "Ctrl+U");
    useShortcutPreferenceStore.getState().resetAll();
    expect(useShortcutPreferenceStore.getState().resolveKeys("save")).toBe(
      "Ctrl+S",
    );
    expect(useShortcutPreferenceStore.getState().resolveKeys("undo")).toBe(
      "Ctrl+Z",
    );
    expect(window.localStorage.getItem(SHORTCUT_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, overrides: {} }),
    );
  });
});
