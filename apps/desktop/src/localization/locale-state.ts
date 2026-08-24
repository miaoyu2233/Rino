import { PRIMARY_LOCALE, type SupportedLocale } from "./locales";

export const LOCALE_STORAGE_KEY = "rino.locale-preference.v1";
export const LOCALE_PREFERENCES = ["system", "zh-CN", "en-US"] as const;

export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];

export interface LocaleState {
  preference: LocalePreference;
  resolvedLocale: SupportedLocale;
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return LOCALE_PREFERENCES.some((preference) => preference === value);
}

export function detectSystemLocale(
  languages: readonly string[] = getBrowserLanguages(),
): SupportedLocale {
  for (const language of languages) {
    const normalizedLanguage = language
      .trim()
      .replaceAll("_", "-")
      .toLowerCase();

    if (normalizedLanguage === "zh" || normalizedLanguage.startsWith("zh-")) {
      return "zh-CN";
    }

    if (normalizedLanguage === "en" || normalizedLanguage.startsWith("en-")) {
      return "en-US";
    }
  }

  return PRIMARY_LOCALE;
}

export function resolveLocale(
  preference: LocalePreference,
  systemLocale: SupportedLocale,
): SupportedLocale {
  return preference === "system" ? systemLocale : preference;
}

export function readLocalePreference(): LocalePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocalePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function persistLocalePreference(preference: LocalePreference): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function createLocaleState(): LocaleState {
  const preference = readLocalePreference();
  return {
    preference,
    resolvedLocale: resolveLocale(preference, detectSystemLocale()),
  };
}

export function applyLocaleToDocument(locale: SupportedLocale): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.lang = locale;
  document.documentElement.dir = "ltr";
}

function getBrowserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") {
    return [];
  }

  if (navigator.languages.length > 0) {
    return navigator.languages;
  }

  return navigator.language.length > 0 ? [navigator.language] : [];
}
