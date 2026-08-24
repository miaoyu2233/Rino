import type { Resource } from "i18next";
import { describe, expect, it, vi } from "vitest";

import { applyLocalizedDocument, createLocalizationInstance } from "./i18n";

describe("localization instance", () => {
  it("falls back from an empty Simplified Chinese value to English", () => {
    const resources = {
      "zh-CN": {
        translation: {
          app: { title: "" },
        },
      },
      "en-US": {
        translation: {
          app: { title: "English fallback" },
        },
      },
    } satisfies Resource;
    const instance = createLocalizationInstance({
      initialLocale: "zh-CN",
      developmentDiagnostics: false,
      resources,
    });

    expect(instance.t("app.title")).toBe("English fallback");
  });

  it("reports and visibly marks a fully missing key once in development", () => {
    const onMissingTranslation = vi.fn();
    const resources = {
      "zh-CN": { translation: {} },
      "en-US": { translation: {} },
    } satisfies Resource;
    const instance = createLocalizationInstance({
      initialLocale: "zh-CN",
      developmentDiagnostics: true,
      onMissingTranslation,
      resources,
    });

    expect(instance.t("app.title")).toBe("[missing:app.title]");
    expect(instance.t("app.title")).toBe("[missing:app.title]");
    expect(onMissingTranslation).toHaveBeenCalledTimes(1);
    expect(onMissingTranslation).toHaveBeenCalledWith({
      languages: ["zh-CN"],
      namespace: "translation",
      key: "app.title",
    });
  });

  it("does not emit missing-key diagnostics in production mode", () => {
    const onMissingTranslation = vi.fn();
    const instance = createLocalizationInstance({
      initialLocale: "en-US",
      developmentDiagnostics: false,
      onMissingTranslation,
      resources: {
        "zh-CN": { translation: {} },
        "en-US": { translation: {} },
      },
    });

    expect(instance.t("app.title")).toBe("app.title");
    expect(onMissingTranslation).not.toHaveBeenCalled();
  });

  it("applies localized document metadata without a network backend", () => {
    const instance = createLocalizationInstance({
      initialLocale: "en-US",
      developmentDiagnostics: false,
    });

    applyLocalizedDocument(instance, "en-US");

    expect(instance.options.backend).toBeUndefined();
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.title).toBe("Rino");
  });
});
