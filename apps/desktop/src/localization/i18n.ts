import { createInstance, type i18n, type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

import { DEFAULT_NAMESPACE, localizationResources } from "./catalogs";
import { createLocaleState, applyLocaleToDocument } from "./locale-state";
import {
  FALLBACK_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./locales";

const MAX_MISSING_TRANSLATION_DIAGNOSTICS = 100;

export interface MissingTranslationDiagnostic {
  languages: readonly string[];
  namespace: string;
  key: string;
}

export interface CreateLocalizationInstanceOptions {
  initialLocale: SupportedLocale;
  developmentDiagnostics?: boolean;
  onMissingTranslation?: (diagnostic: MissingTranslationDiagnostic) => void;
  resources?: Resource;
}

export function createLocalizationInstance({
  initialLocale,
  developmentDiagnostics = import.meta.env.DEV,
  onMissingTranslation = reportMissingTranslation,
  resources = localizationResources,
}: CreateLocalizationInstanceOptions): i18n {
  const instance = createInstance();
  const reportMissingKey =
    createMissingTranslationReporter(onMissingTranslation);

  instance.use(initReactI18next);
  void instance.init({
    resources,
    lng: initialLocale,
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    nonExplicitSupportedLngs: false,
    load: "currentOnly",
    ns: [DEFAULT_NAMESPACE],
    defaultNS: DEFAULT_NAMESPACE,
    initAsync: false,
    debug: false,
    returnNull: false,
    returnEmptyString: false,
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    saveMissing: developmentDiagnostics,
    saveMissingTo: "current",
    ...(developmentDiagnostics
      ? {
          missingKeyHandler: (
            languages: readonly string[],
            namespace: string,
            key: string,
          ) => {
            reportMissingKey({ languages, namespace, key });
          },
          parseMissingKeyHandler: (key: string) => `[missing:${key}]`,
        }
      : {}),
  });

  if (!instance.isInitialized) {
    throw new Error(
      "The localization instance did not initialize synchronously.",
    );
  }

  return instance;
}

function createMissingTranslationReporter(
  report: (diagnostic: MissingTranslationDiagnostic) => void,
): (diagnostic: MissingTranslationDiagnostic) => void {
  const reportedKeys = new Set<string>();

  return (diagnostic) => {
    const identity = `${diagnostic.languages.join(",")}:${diagnostic.namespace}:${diagnostic.key}`;
    if (
      reportedKeys.has(identity) ||
      reportedKeys.size >= MAX_MISSING_TRANSLATION_DIAGNOSTICS
    ) {
      return;
    }

    reportedKeys.add(identity);
    report(diagnostic);
  };
}

function reportMissingTranslation(
  diagnostic: MissingTranslationDiagnostic,
): void {
  console.warn("[localization] Missing translation key.", diagnostic);
}

const initialLocaleState = createLocaleState();

export const applicationI18n = createLocalizationInstance({
  initialLocale: initialLocaleState.resolvedLocale,
});

export function applyLocalizedDocument(
  instance: i18n,
  locale: SupportedLocale,
): void {
  applyLocaleToDocument(locale);

  if (typeof document !== "undefined") {
    document.title = instance.getFixedT(locale)("app.title");
  }
}

export function initializeLocalization(): void {
  const localeState = createLocaleState();
  void applicationI18n.changeLanguage(localeState.resolvedLocale);
  applyLocalizedDocument(applicationI18n, localeState.resolvedLocale);
}
