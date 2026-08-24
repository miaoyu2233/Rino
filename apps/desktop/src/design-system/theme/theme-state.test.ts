import { afterEach, describe, expect, it, vi } from "vitest";

import {
  THEME_STORAGE_KEY,
  applyTheme,
  initializeTheme,
  isThemePreference,
  persistThemePreference,
  resolveTheme,
} from "./theme-state";

function createMediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
}

describe("theme state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    delete document.documentElement.dataset["theme"];
    delete document.documentElement.dataset["themePreference"];
  });

  it("accepts only supported persisted preferences", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("auto")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it("resolves system and explicit preferences deterministically", () => {
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
  });

  it("initializes the document from a stored explicit preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => createMediaQuery(false)),
    );

    const state = initializeTheme();

    expect(state).toEqual({ preference: "dark", resolvedTheme: "dark" });
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(document.documentElement.dataset["themePreference"]).toBe("dark");
  });

  it("uses the operating-system theme when no valid override exists", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "unsupported");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => createMediaQuery(true)),
    );

    expect(initializeTheme()).toEqual({
      preference: "system",
      resolvedTheme: "dark",
    });
  });

  it("persists a valid override and applies a matching document state", () => {
    expect(persistThemePreference("light")).toBe(true);
    applyTheme({ preference: "light", resolvedTheme: "light" });

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(document.documentElement.dataset["themePreference"]).toBe("light");
  });
});
