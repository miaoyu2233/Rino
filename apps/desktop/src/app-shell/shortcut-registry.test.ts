import { describe, expect, it } from "vitest";

import {
  isEditableKeyboardTarget,
  resolveAvailableShortcut,
  resolveCanvasShortcut,
} from "./shortcut-registry";

describe("shortcut registry", () => {
  it("resolves the application-frame shortcuts", () => {
    expect(
      resolveAvailableShortcut(
        new KeyboardEvent("keydown", { key: "/", ctrlKey: true }),
      ),
    ).toBe("openReference");
    expect(
      resolveAvailableShortcut(
        new KeyboardEvent("keydown", {
          key: "D",
          ctrlKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe("focusDevice");
    expect(
      resolveAvailableShortcut(new KeyboardEvent("keydown", { key: "F5" })),
    ).toBe("run");
    expect(
      resolveAvailableShortcut(
        new KeyboardEvent("keydown", { key: "F5", shiftKey: true }),
      ),
    ).toBe("stop");
    expect(
      resolveAvailableShortcut(
        new KeyboardEvent("keydown", { key: "F5", repeat: true }),
      ),
    ).toBeNull();
  });

  it("does not intercept text editing or IME composition", () => {
    const input = document.createElement("input");
    const inputShortcut = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
    });
    Object.defineProperty(inputShortcut, "target", { value: input });
    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(resolveAvailableShortcut(inputShortcut)).toBeNull();
    expect(
      resolveAvailableShortcut(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          isComposing: true,
        }),
      ),
    ).toBeNull();
  });

  it("uses plain C for an area comment without replacing copy", () => {
    expect(
      resolveCanvasShortcut(new KeyboardEvent("keydown", { key: "c" })),
    ).toBe("comment");
    expect(
      resolveCanvasShortcut(
        new KeyboardEvent("keydown", { key: "c", ctrlKey: true }),
      ),
    ).toBe("copy");
  });
});
