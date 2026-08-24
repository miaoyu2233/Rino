import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTranslation } from "react-i18next";

import { createLocalizationInstance } from "./i18n";
import { LOCALE_STORAGE_KEY } from "./locale-state";
import { LocaleProvider } from "./LocaleProvider";
import { useLocale } from "./useLocale";

function LocaleHarness() {
  const { preference, resolvedLocale, setPreference } = useLocale();
  const { t } = useTranslation();

  return (
    <div>
      <output aria-label="locale state">{`${preference}:${resolvedLocale}`}</output>
      <output aria-label="localized label">{t("locale.languageLabel")}</output>
      <button
        type="button"
        onClick={() => {
          setPreference("en-US");
        }}
      >
        select English
      </button>
      <button
        type="button"
        onClick={() => {
          setPreference("system");
        }}
      >
        use system
      </button>
    </div>
  );
}

describe("LocaleProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.lang = "zh-CN";
    document.documentElement.dir = "";
    document.title = "Rino";
  });

  it("applies and persists an explicit language preference", async () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    const instance = createLocalizationInstance({
      initialLocale: "zh-CN",
      developmentDiagnostics: false,
    });

    render(
      <LocaleProvider i18nInstance={instance}>
        <LocaleHarness />
      </LocaleProvider>,
    );

    expect(screen.getByLabelText("localized label")).toHaveTextContent(
      "界面语言",
    );
    fireEvent.click(screen.getByRole("button", { name: "select English" }));

    await waitFor(() => {
      expect(screen.getByLabelText("locale state")).toHaveTextContent(
        "en-US:en-US",
      );
      expect(screen.getByLabelText("localized label")).toHaveTextContent(
        "Display language",
      );
    });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("tracks operating-system language changes only through system mode", async () => {
    let browserLanguages: readonly string[] = ["zh-CN"];
    vi.spyOn(window.navigator, "languages", "get").mockImplementation(
      () => browserLanguages,
    );
    const instance = createLocalizationInstance({
      initialLocale: "zh-CN",
      developmentDiagnostics: false,
    });

    render(
      <LocaleProvider i18nInstance={instance}>
        <LocaleHarness />
      </LocaleProvider>,
    );

    browserLanguages = ["en-GB"];
    act(() => {
      window.dispatchEvent(new Event("languagechange"));
    });

    await waitFor(() => {
      expect(screen.getByLabelText("locale state")).toHaveTextContent(
        "system:en-US",
      );
      expect(screen.getByLabelText("localized label")).toHaveTextContent(
        "Display language",
      );
    });
  });

  it("accepts a valid preference update from another application view", async () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    const instance = createLocalizationInstance({
      initialLocale: "zh-CN",
      developmentDiagnostics: false,
    });

    render(
      <LocaleProvider i18nInstance={instance}>
        <LocaleHarness />
      </LocaleProvider>,
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: LOCALE_STORAGE_KEY,
          newValue: "en-US",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByLabelText("locale state")).toHaveTextContent(
        "en-US:en-US",
      );
    });
  });
});
