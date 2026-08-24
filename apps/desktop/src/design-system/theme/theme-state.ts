export const THEME_STORAGE_KEY = "rino.theme-preference.v1";
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export interface ThemeState {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((preference) => preference === value);
}

export function getSystemTheme(): ResolvedTheme {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }

  return "light";
}

export function resolveTheme(
  preference: ThemePreference,
  systemTheme: ResolvedTheme,
): ResolvedTheme {
  return preference === "system" ? systemTheme : preference;
}

export function readThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function persistThemePreference(preference: ThemePreference): boolean {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(state: ThemeState): void {
  document.documentElement.dataset["theme"] = state.resolvedTheme;
  document.documentElement.dataset["themePreference"] = state.preference;
}

export function initializeTheme(): ThemeState {
  const preference = readThemePreference();
  const state = {
    preference,
    resolvedTheme: resolveTheme(preference, getSystemTheme()),
  } satisfies ThemeState;

  applyTheme(state);
  return state;
}
