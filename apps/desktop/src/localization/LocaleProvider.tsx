import type { i18n } from "i18next";
import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { I18nextProvider } from "react-i18next";

import { applicationI18n, applyLocalizedDocument } from "./i18n";
import { LocaleContext } from "./locale-context";
import {
  LOCALE_STORAGE_KEY,
  detectSystemLocale,
  isLocalePreference,
  persistLocalePreference,
  readLocalePreference,
  resolveLocale,
  type LocalePreference,
} from "./locale-state";
import type { SupportedLocale } from "./locales";

export interface LocaleProviderProps extends PropsWithChildren {
  i18nInstance?: i18n;
}

export function LocaleProvider({
  children,
  i18nInstance = applicationI18n,
}: LocaleProviderProps) {
  const [preference, setPreferenceState] =
    useState<LocalePreference>(readLocalePreference);
  const [systemLocale, setSystemLocale] =
    useState<SupportedLocale>(detectSystemLocale);
  const resolvedLocale = resolveLocale(preference, systemLocale);

  useEffect(() => {
    const handleLanguageChange = () => {
      setSystemLocale(detectSystemLocale());
    };

    window.addEventListener("languagechange", handleLanguageChange);
    return () => {
      window.removeEventListener("languagechange", handleLanguageChange);
    };
  }, []);

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY) {
        return;
      }

      setPreferenceState(
        isLocalePreference(event.newValue) ? event.newValue : "system",
      );
    };

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    let active = true;

    applyLocalizedDocument(i18nInstance, resolvedLocale);
    void i18nInstance.changeLanguage(resolvedLocale).then(() => {
      if (active && i18nInstance.resolvedLanguage === resolvedLocale) {
        applyLocalizedDocument(i18nInstance, resolvedLocale);
      }
    });

    return () => {
      active = false;
    };
  }, [i18nInstance, resolvedLocale]);

  const setPreference = useCallback((nextPreference: LocalePreference) => {
    const persisted = persistLocalePreference(nextPreference);
    setPreferenceState(nextPreference);
    return persisted;
  }, []);

  const contextValue = useMemo(
    () => ({ preference, resolvedLocale, setPreference }),
    [preference, resolvedLocale, setPreference],
  );

  return (
    <I18nextProvider i18n={i18nInstance}>
      <LocaleContext.Provider value={contextValue}>
        {children}
      </LocaleContext.Provider>
    </I18nextProvider>
  );
}
