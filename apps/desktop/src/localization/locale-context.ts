import { createContext } from "react";

import type { LocalePreference } from "./locale-state";
import type { SupportedLocale } from "./locales";

export interface LocaleContextValue {
  preference: LocalePreference;
  resolvedLocale: SupportedLocale;
  setPreference: (preference: LocalePreference) => boolean;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);
