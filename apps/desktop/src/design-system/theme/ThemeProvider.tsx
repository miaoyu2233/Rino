import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ThemeContext } from "./theme-context";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  getSystemTheme,
  isThemePreference,
  persistThemePreference,
  readThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme-state";

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

export function ThemeProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(readThemePreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const resolvedTheme = resolveTheme(preference, systemTheme);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    };
  }, []);

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) {
        return;
      }

      setPreferenceState(
        isThemePreference(event.newValue) ? event.newValue : "system",
      );
    };

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    applyTheme({ preference, resolvedTheme });
  }, [preference, resolvedTheme]);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    persistThemePreference(nextPreference);
    setPreferenceState(nextPreference);
  }, []);

  const contextValue = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}
