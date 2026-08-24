export type ShortcutId =
  | "openReference"
  | "focusPalette"
  | "focusDevice"
  | "save"
  | "saveAs"
  | "undo"
  | "redo"
  | "copy"
  | "paste"
  | "duplicate"
  | "remove"
  | "addNode"
  | "comment"
  | "commandPalette"
  | "frameSelection"
  | "frameGraph"
  | "run"
  | "stop"
  | "breakpoint"
  | "stepOver"
  | "continueRun";

export type ShortcutScope = "global" | "canvas" | "runtime";

export interface ShortcutMetadata {
  id: ShortcutId;
  defaultKeys: string;
  scope: ShortcutScope;
}

export const DEFAULT_SHORTCUT_DEFINITIONS: readonly ShortcutMetadata[] = [
  { id: "openReference", defaultKeys: "Ctrl+/", scope: "global" },
  { id: "focusPalette", defaultKeys: "Ctrl+K", scope: "global" },
  { id: "focusDevice", defaultKeys: "Ctrl+Shift+D", scope: "global" },
  { id: "save", defaultKeys: "Ctrl+S", scope: "global" },
  { id: "saveAs", defaultKeys: "Ctrl+Shift+S", scope: "global" },
  { id: "undo", defaultKeys: "Ctrl+Z", scope: "canvas" },
  { id: "redo", defaultKeys: "Ctrl+Y", scope: "canvas" },
  { id: "copy", defaultKeys: "Ctrl+C", scope: "canvas" },
  { id: "paste", defaultKeys: "Ctrl+V", scope: "canvas" },
  { id: "duplicate", defaultKeys: "Ctrl+D", scope: "canvas" },
  { id: "remove", defaultKeys: "Delete", scope: "canvas" },
  { id: "addNode", defaultKeys: "Tab", scope: "canvas" },
  { id: "comment", defaultKeys: "C", scope: "canvas" },
  { id: "commandPalette", defaultKeys: "Ctrl+P", scope: "global" },
  { id: "frameSelection", defaultKeys: "F", scope: "canvas" },
  { id: "frameGraph", defaultKeys: "Home", scope: "canvas" },
  { id: "run", defaultKeys: "F5", scope: "runtime" },
  { id: "stop", defaultKeys: "Shift+F5", scope: "runtime" },
  { id: "breakpoint", defaultKeys: "F9", scope: "runtime" },
  { id: "stepOver", defaultKeys: "F10", scope: "runtime" },
  { id: "continueRun", defaultKeys: "F6", scope: "runtime" },
] as const;

export const DEFAULT_SHORTCUT_KEYS: Record<ShortcutId, string> =
  DEFAULT_SHORTCUT_DEFINITIONS.reduce(
    (acc, item) => {
      acc[item.id] = item.defaultKeys;
      return acc;
    },
    {} as Record<ShortcutId, string>,
  );

export const SHORTCUT_STORAGE_KEY = "rino.shortcut-overrides.v1";

export type ShortcutOverrides = Partial<Record<ShortcutId, string>>;

export interface ShortcutPreferenceDocument {
  version: 1;
  overrides: ShortcutOverrides;
}

export function normalizeShortcutKey(keyCombo: string): string {
  const parts = keyCombo.split("+").map((p) => p.trim());
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  let mainKey = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") ctrl = true;
    else if (lower === "alt") alt = true;
    else if (lower === "shift") shift = true;
    else if (lower === "meta" || lower === "cmd" || lower === "command")
      meta = true;
    else if (part !== "") {
      mainKey = part;
    }
  }

  if (!mainKey) {
    return keyCombo;
  }

  const formattedKey =
    mainKey.length === 1
      ? mainKey.toUpperCase()
      : mainKey.charAt(0).toUpperCase() + mainKey.slice(1);
  const resultParts: string[] = [];
  if (ctrl) resultParts.push("Ctrl");
  if (alt) resultParts.push("Alt");
  if (shift) resultParts.push("Shift");
  if (meta) resultParts.push("Meta");
  resultParts.push(formattedKey);

  return resultParts.join("+");
}

export function parseShortcutPreferenceDocument(
  serialized: string | null,
): ShortcutPreferenceDocument {
  if (!serialized) {
    return { version: 1, overrides: {} };
  }
  try {
    const data = JSON.parse(serialized) as unknown;
    if (
      typeof data === "object" &&
      data !== null &&
      "version" in data &&
      data.version === 1 &&
      "overrides" in data &&
      typeof (data as { overrides: unknown }).overrides === "object" &&
      (data as { overrides: unknown }).overrides !== null
    ) {
      const rawOverrides = (data as { overrides: Record<string, unknown> })
        .overrides;
      const validOverrides: ShortcutOverrides = {};
      const validIds = new Set(DEFAULT_SHORTCUT_DEFINITIONS.map((d) => d.id));

      for (const [id, value] of Object.entries(rawOverrides)) {
        if (
          validIds.has(id as ShortcutId) &&
          typeof value === "string" &&
          value.trim()
        ) {
          validOverrides[id as ShortcutId] = normalizeShortcutKey(value.trim());
        }
      }

      return { version: 1, overrides: validOverrides };
    }
  } catch {
    // Ignore invalid JSON
  }

  return { version: 1, overrides: {} };
}

export function createShortcutPreferenceDocument(
  overrides: ShortcutOverrides,
): ShortcutPreferenceDocument {
  const cleanOverrides: ShortcutOverrides = {};
  for (const def of DEFAULT_SHORTCUT_DEFINITIONS) {
    const val = overrides[def.id];
    if (val && val !== def.defaultKeys) {
      cleanOverrides[def.id] = normalizeShortcutKey(val);
    }
  }
  return { version: 1, overrides: cleanOverrides };
}

export function checkShortcutConflict(
  targetId: ShortcutId,
  newKeys: string,
  currentEffectiveKeys: Record<ShortcutId, string>,
): ShortcutId | null {
  const normalizedNew = normalizeShortcutKey(newKeys);
  const targetDef = DEFAULT_SHORTCUT_DEFINITIONS.find((d) => d.id === targetId);
  if (!targetDef) return null;

  for (const def of DEFAULT_SHORTCUT_DEFINITIONS) {
    if (def.id === targetId) continue;
    const existingKeys = currentEffectiveKeys[def.id];
    if (existingKeys && normalizeShortcutKey(existingKeys) === normalizedNew) {
      if (
        targetDef.scope === "global" ||
        def.scope === "global" ||
        targetDef.scope === def.scope
      ) {
        return def.id;
      }
    }
  }

  return null;
}
