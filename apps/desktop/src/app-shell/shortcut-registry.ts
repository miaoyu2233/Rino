import {
  DEFAULT_SHORTCUT_DEFINITIONS,
  DEFAULT_SHORTCUT_KEYS,
  type ShortcutId,
  type ShortcutScope,
} from "../preferences/shortcut-preferences";
import { useShortcutPreferenceStore } from "../preferences/shortcut-preference-store";

export type { ShortcutId, ShortcutScope };

export interface ShortcutDefinition {
  id: ShortcutId;
  keys: string;
  defaultKeys: string;
  scope: ShortcutScope;
  available: boolean;
}

export const shortcutDefinitions: ShortcutDefinition[] =
  DEFAULT_SHORTCUT_DEFINITIONS.map((def) => ({
    id: def.id,
    keys: def.defaultKeys,
    defaultKeys: def.defaultKeys,
    scope: def.scope,
    available: [
      "openReference",
      "focusPalette",
      "focusDevice",
      "save",
      "saveAs",
      "undo",
      "redo",
      "copy",
      "paste",
      "duplicate",
      "remove",
      "addNode",
    ].includes(def.id),
  }));

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function matchKeyboardEvent(
  event: KeyboardEvent,
  targetKeys: string,
): boolean {
  if (!targetKeys) return false;
  const parts = targetKeys.split("+").map((p) => p.trim());
  let targetCtrl = false;
  let targetAlt = false;
  let targetShift = false;
  let targetMeta = false;
  let targetKey = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") targetCtrl = true;
    else if (lower === "alt") targetAlt = true;
    else if (lower === "shift") targetShift = true;
    else if (lower === "meta" || lower === "cmd" || lower === "command")
      targetMeta = true;
    else if (part !== "") {
      targetKey = lower;
    }
  }

  if (!targetKey) return false;

  if (event.ctrlKey !== targetCtrl) return false;
  if (event.altKey !== targetAlt) return false;
  if (event.shiftKey !== targetShift) return false;
  if (event.metaKey !== targetMeta) return false;

  const eventKey = event.key.toLowerCase();

  if (targetKey === "delete") {
    return eventKey === "delete" || eventKey === "backspace";
  }

  return eventKey === targetKey;
}

export type ApplicationShortcutId = Extract<
  ShortcutId,
  | "openReference"
  | "focusPalette"
  | "focusDevice"
  | "save"
  | "saveAs"
  | "run"
  | "stop"
>;

const APPLICATION_SHORTCUT_IDS: readonly ApplicationShortcutId[] = [
  "stop",
  "run",
  "saveAs",
  "save",
  "focusDevice",
  "focusPalette",
  "openReference",
];

export function resolveAvailableShortcut(
  event: KeyboardEvent,
  overrideKeys?: Record<ShortcutId, string>,
): ApplicationShortcutId | null {
  if (event.isComposing || isEditableKeyboardTarget(event.target)) {
    return null;
  }

  if (event.key.toLowerCase() === "f5" && event.repeat) {
    return null;
  }

  const effectiveKeys =
    overrideKeys ?? useShortcutPreferenceStore.getState().getEffectiveKeys();

  for (const id of APPLICATION_SHORTCUT_IDS) {
    const keys = effectiveKeys[id];
    if (keys && matchKeyboardEvent(event, keys)) {
      return id;
    }
  }

  return null;
}

export type CanvasShortcutId = Extract<
  ShortcutId,
  | "undo"
  | "redo"
  | "copy"
  | "paste"
  | "duplicate"
  | "remove"
  | "addNode"
  | "comment"
>;

const CANVAS_SHORTCUT_IDS: readonly CanvasShortcutId[] = [
  "undo",
  "redo",
  "copy",
  "paste",
  "duplicate",
  "remove",
  "addNode",
  "comment",
];

export function resolveCanvasShortcut(
  event: KeyboardEvent,
  overrideKeys?: Record<ShortcutId, string>,
): CanvasShortcutId | null {
  if (event.isComposing || isEditableKeyboardTarget(event.target)) {
    return null;
  }

  const effectiveKeys =
    overrideKeys ?? useShortcutPreferenceStore.getState().getEffectiveKeys();

  // Shift+Ctrl+Z is a standard secondary redo shortcut when redo is using default Ctrl+Y
  if (
    effectiveKeys.redo === DEFAULT_SHORTCUT_KEYS.redo &&
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key.toLowerCase() === "z"
  ) {
    return "redo";
  }

  for (const id of CANVAS_SHORTCUT_IDS) {
    const keys = effectiveKeys[id];
    if (keys && matchKeyboardEvent(event, keys)) {
      return id;
    }
  }

  return null;
}
