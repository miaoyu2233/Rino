import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LOCALE_STORAGE_KEY,
  applyLocaleToDocument,
  createLocaleState,
  detectSystemLocale,
  isLocalePreference,
  persistLocalePreference,
  readLocalePreference,
  resolveLocale,
} from "./locale-state";

describe("locale state", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.lang = "zh-CN";
    document.documentElement.dir = "";
  });

  it("accepts only supported preferences", () => {
    expect(isLocalePreference("system")).toBe(true);
    expect(isLocalePreference("zh-CN")).toBe(true);
    expect(isLocalePreference("en-US")).toBe(true);
    expect(isLocalePreference("zh-TW")).toBe(false);
    expect(isLocalePreference(null)).toBe(false);
  });

  it("detects supported language families in browser priority order", () => {
    expect(detectSystemLocale(["zh-Hans-SG", "en-US"])).toBe("zh-CN");
    expect(detectSystemLocale(["fr-FR", "en-GB"])).toBe("en-US");
    expect(detectSystemLocale(["fr-FR", "ja-JP"])).toBe("zh-CN");
    expect(detectSystemLocale([" EN_us "])).toBe("en-US");
  });

  it("resolves explicit preferences without changing their locale", () => {
    expect(resolveLocale("system", "en-US")).toBe("en-US");
    expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN");
    expect(resolveLocale("en-US", "zh-CN")).toBe("en-US");
  });

  it("persists a valid explicit preference", () => {
    expect(persistLocalePreference("en-US")).toBe(true);
    expect(readLocalePreference()).toBe("en-US");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en-US");
  });

  it("falls back safely when stored preference access fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable.");
    });

    expect(readLocalePreference()).toBe("system");
  });

  it("creates a state from the explicit preference and updates the document", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");

    expect(createLocaleState()).toEqual({
      preference: "zh-CN",
      resolvedLocale: "zh-CN",
    });

    applyLocaleToDocument("en-US");
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.dir).toBe("ltr");
  });
});
