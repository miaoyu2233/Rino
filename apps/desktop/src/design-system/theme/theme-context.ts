import { createContext } from "react";

import type { ThemePreference, ThemeState } from "./theme-state";

export interface ThemeContextValue extends ThemeState {
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
