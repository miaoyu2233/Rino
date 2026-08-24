import { create } from "zustand";

import {
  createShortcutPreferenceDocument,
  DEFAULT_SHORTCUT_KEYS,
  normalizeShortcutKey,
  parseShortcutPreferenceDocument,
  SHORTCUT_STORAGE_KEY,
  type ShortcutId,
  type ShortcutOverrides,
} from "./shortcut-preferences";

const PERSISTENCE_DELAY_MS = 200;

interface ShortcutPreferenceState {
  overrides: ShortcutOverrides;
  resolveKeys: (id: ShortcutId) => string;
  getEffectiveKeys: () => Record<ShortcutId, string>;
  setBinding: (id: ShortcutId, keys: string) => void;
  resetBinding: (id: ShortcutId) => void;
  resetAll: () => void;
  replaceOverrides: (overrides: ShortcutOverrides) => void;
}

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
let pendingOverrides: ShortcutOverrides | undefined;

function writeOverrides(overrides: ShortcutOverrides): void {
  try {
    window.localStorage.setItem(
      SHORTCUT_STORAGE_KEY,
      JSON.stringify(createShortcutPreferenceDocument(overrides)),
    );
  } catch {
    // Memory state remains valid if localStorage write fails.
  }
}

function cancelPendingPersistence(): void {
  if (typeof window === "undefined") return;
  window.clearTimeout(persistenceTimer);
  persistenceTimer = undefined;
  pendingOverrides = undefined;
}

function persistOverrides(overrides: ShortcutOverrides): void {
  if (typeof window === "undefined") return;
  window.clearTimeout(persistenceTimer);
  pendingOverrides = overrides;
  persistenceTimer = window.setTimeout(() => {
    persistenceTimer = undefined;
    pendingOverrides = undefined;
    writeOverrides(overrides);
  }, PERSISTENCE_DELAY_MS);
}

export function flushShortcutPersistence(): void {
  if (typeof window === "undefined" || pendingOverrides === undefined) return;
  const overrides = pendingOverrides;
  cancelPendingPersistence();
  writeOverrides(overrides);
}

export const useShortcutPreferenceStore = create<ShortcutPreferenceState>(
  (set, get) => ({
    overrides: {},
    resolveKeys: (id: ShortcutId) => {
      const override = get().overrides[id];
      if (override) return override;
      return DEFAULT_SHORTCUT_KEYS[id];
    },
    getEffectiveKeys: () => {
      const currentOverrides = get().overrides;
      const result = { ...DEFAULT_SHORTCUT_KEYS };
      for (const [id, val] of Object.entries(currentOverrides)) {
        if (val) {
          result[id as ShortcutId] = val;
        }
      }
      return result;
    },
    setBinding: (id: ShortcutId, keys: string) => {
      const normalized = normalizeShortcutKey(keys);
      const defaultKey = DEFAULT_SHORTCUT_KEYS[id];

      set((state) => {
        const nextOverrides =
          normalized === defaultKey
            ? Object.fromEntries(
                Object.entries(state.overrides).filter(([key]) => key !== id),
              )
            : { ...state.overrides, [id]: normalized };
        persistOverrides(nextOverrides);
        return { overrides: nextOverrides };
      });
    },
    resetBinding: (id: ShortcutId) => {
      set((state) => {
        if (!(id in state.overrides)) return state;
        const nextOverrides = Object.fromEntries(
          Object.entries(state.overrides).filter(([key]) => key !== id),
        );
        persistOverrides(nextOverrides);
        return { overrides: nextOverrides };
      });
    },
    resetAll: () => {
      cancelPendingPersistence();
      writeOverrides({});
      set({ overrides: {} });
    },
    replaceOverrides: (overrides: ShortcutOverrides) => {
      cancelPendingPersistence();
      set({ overrides });
    },
  }),
);

export function initializeShortcutPreferences(): void {
  if (typeof window === "undefined") return;
  let serialized: string | null;
  try {
    serialized = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
  } catch {
    serialized = null;
  }
  const parsed = parseShortcutPreferenceDocument(serialized);
  useShortcutPreferenceStore.getState().replaceOverrides(parsed.overrides);
}

export function applyExternalShortcutPreference(
  serializedDocument: string | null,
): void {
  const parsed = parseShortcutPreferenceDocument(serializedDocument);
  useShortcutPreferenceStore.getState().replaceOverrides(parsed.overrides);
}
