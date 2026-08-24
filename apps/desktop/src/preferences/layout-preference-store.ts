import { create } from "zustand";

import {
  createPreferenceDocument,
  defaultLayoutPreferences,
  normalizeLayoutPreferences,
  parsePreferenceDocument,
  PREFERENCE_STORAGE_KEY,
  type LayoutPreferences,
} from "./layout-preferences";

const PERSISTENCE_DELAY_MS = 200;

interface LayoutPreferenceState {
  layout: LayoutPreferences;
  replaceLayout: (layout: LayoutPreferences) => void;
  updateLayout: (change: Partial<LayoutPreferences>) => void;
}

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
let pendingLayout: LayoutPreferences | undefined;

function writeLayout(layout: LayoutPreferences): void {
  try {
    window.localStorage.setItem(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify(createPreferenceDocument(layout)),
    );
  } catch {
    // The in-memory preference remains valid when storage is unavailable.
  }
}

function cancelPendingPersistence(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.clearTimeout(persistenceTimer);
  persistenceTimer = undefined;
  pendingLayout = undefined;
}

function persistLayout(layout: LayoutPreferences): void {
  if (typeof window === "undefined") {
    return;
  }

  window.clearTimeout(persistenceTimer);
  pendingLayout = layout;
  persistenceTimer = window.setTimeout(() => {
    persistenceTimer = undefined;
    pendingLayout = undefined;
    writeLayout(layout);
  }, PERSISTENCE_DELAY_MS);
}

/** Writes any debounced layout change immediately, so the last edit before the window
 * closes is not lost. */
export function flushLayoutPersistence(): void {
  if (typeof window === "undefined" || pendingLayout === undefined) {
    return;
  }

  const layout = pendingLayout;
  cancelPendingPersistence();
  writeLayout(layout);
}

export const useLayoutPreferenceStore = create<LayoutPreferenceState>(
  (set) => ({
    layout: { ...defaultLayoutPreferences },
    replaceLayout: (layout) => {
      // An externally applied document supersedes any debounced local write; keeping the
      // pending write would overwrite the newer value a moment later.
      cancelPendingPersistence();
      set({ layout: normalizeLayoutPreferences(layout) });
    },
    updateLayout: (change) => {
      set((state) => {
        const layout = normalizeLayoutPreferences({
          ...state.layout,
          ...change,
        });
        persistLayout(layout);
        return { layout };
      });
    },
  }),
);

export function initializeLayoutPreferences(): void {
  if (typeof window === "undefined") {
    return;
  }

  let serializedDocument: string | null;
  try {
    serializedDocument = window.localStorage.getItem(PREFERENCE_STORAGE_KEY);
  } catch {
    serializedDocument = null;
  }

  useLayoutPreferenceStore
    .getState()
    .replaceLayout(parsePreferenceDocument(serializedDocument).layout);
}

export function applyExternalLayoutPreference(
  serializedDocument: string | null,
): void {
  useLayoutPreferenceStore
    .getState()
    .replaceLayout(parsePreferenceDocument(serializedDocument).layout);
}
