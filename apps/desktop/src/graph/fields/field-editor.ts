import type { TypeDescriptorV1 } from "@rino/contracts";

import type {
  DiagnosticParameters,
  LocalizationKey,
} from "../../diagnostics/diagnostic-model";
import type { EditableValue } from "../commands/graph-commands";

/** Why a value has no editor in this version of the editor.
 *
 * The reason is kept rather than collapsed into a single "unsupported" state, because the
 * interface has to tell the user whether the definition asked for something this editor
 * cannot draw or whether the definition itself is malformed.
 */
export type UnsupportedFieldReason =
  "typeUnsupported" | "labelMissing" | "choicesInvalid" | "declarationInvalid";

export interface FieldChoice {
  value: string;
  labelKey: string;
  descriptionKey?: string;
}

/** The control a value is edited with.
 *
 * Both node properties and inline literal inputs resolve to this union, so the inspector
 * and the controls drawn on a node render the same value with the same rules instead of
 * two implementations that can disagree.
 */
export type FieldEditor =
  | {
      kind: "text";
      minimumLength: number | undefined;
      maximumLength: number | undefined;
    }
  | {
      kind: "number";
      integer: boolean;
      minimum: number | undefined;
      maximum: number | undefined;
      /** Localization key for the unit shown beside the control and in its help. */
      unitKey: string | undefined;
    }
  | { kind: "boolean" }
  | { kind: "choice"; choices: readonly FieldChoice[] }
  | { kind: "unsupported"; reason: UnsupportedFieldReason };

export const UNSUPPORTED_TYPE_EDITOR: FieldEditor = {
  kind: "unsupported",
  reason: "typeUnsupported",
};

/** The bounds the persisted graph format places on the values a field can hold.
 *
 * They are repeated here so an over-long value is refused while it is being typed, with a
 * message naming the field, rather than at save time when the user has moved on.
 */
export const MAXIMUM_TEXT_VALUE_LENGTH = 65536;
export const MAXIMUM_DISPLAY_ALIAS_LENGTH = 80;

/** Removes an `optional` wrapper, which changes only whether a value may be cleared. */
export function unwrapOptional(type: TypeDescriptorV1): {
  inner: TypeDescriptorV1;
  clearable: boolean;
} {
  return type.kind === "optional"
    ? { inner: type.value, clearable: true }
    : { inner: type, clearable: false };
}

/** The editor for an inline literal on a data input port.
 *
 * Only the primitive types with a meaningful written form get one. A rectangle, a point,
 * an image handle, a recognition result, or a collection is either picked from the device
 * workbench or produced by another node, so offering a text box for it would invite a
 * value the runtime cannot use.
 */
export function literalEditorFor(type: TypeDescriptorV1): FieldEditor {
  const { inner } = unwrapOptional(type);
  switch (inner.kind) {
    case "bool":
      return { kind: "boolean" };
    case "number":
      return {
        kind: "number",
        integer: false,
        minimum: undefined,
        maximum: undefined,
        unitKey: undefined,
      };
    case "string":
      return {
        kind: "text",
        minimumLength: undefined,
        maximumLength: MAXIMUM_TEXT_VALUE_LENGTH,
      };
    default:
      return UNSUPPORTED_TYPE_EDITOR;
  }
}

export type FieldValidation =
  | { ok: true; value: EditableValue | undefined }
  | {
      ok: false;
      messageKey: LocalizationKey;
      parameters: DiagnosticParameters | undefined;
    };

function invalid(
  messageKey: LocalizationKey,
  parameters?: DiagnosticParameters,
): FieldValidation {
  return { ok: false, messageKey, parameters };
}

/** Renders a committed value as the text a control starts editing from. */
export function formatFieldValue(value: EditableValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function parseNumber(
  editor: Extract<FieldEditor, { kind: "number" }>,
  raw: string,
): FieldValidation {
  // Number() accepts leading and trailing spaces but also the empty string, which the
  // caller has already handled, and rejects the partial forms a user types.
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return invalid("graph.inspector.validation.notANumber");
  }
  if (editor.integer && !Number.isInteger(parsed)) {
    return invalid("graph.inspector.validation.notAnInteger");
  }
  if (editor.minimum !== undefined && parsed < editor.minimum) {
    return invalid("graph.inspector.validation.tooSmall", {
      minimum: editor.minimum,
    });
  }
  if (editor.maximum !== undefined && parsed > editor.maximum) {
    return invalid("graph.inspector.validation.tooLarge", {
      maximum: editor.maximum,
    });
  }
  return { ok: true, value: parsed };
}

function parseText(
  editor: Extract<FieldEditor, { kind: "text" }>,
  raw: string,
): FieldValidation {
  // Counted in code points, which is how the persisted schema counts a string length, so
  // the editor refuses exactly what a save would refuse.
  const length = Array.from(raw).length;
  if (editor.minimumLength !== undefined && length < editor.minimumLength) {
    return invalid("graph.inspector.validation.tooShort", {
      minimum: editor.minimumLength,
    });
  }
  if (editor.maximumLength !== undefined && length > editor.maximumLength) {
    return invalid("graph.inspector.validation.tooLong", {
      maximum: editor.maximumLength,
    });
  }
  return { ok: true, value: raw };
}

/** Validates typed text and produces the value a command would store.
 *
 * An empty entry clears the value rather than storing an empty string, so removing a
 * literal and never having typed one reach the document as the same absent state. A
 * required field refuses to clear, because the resulting document would be one the user
 * cannot run and did not ask for.
 */
export function parseFieldInput(
  editor: FieldEditor,
  raw: string,
  required: boolean,
): FieldValidation {
  if (editor.kind === "unsupported") {
    return invalid("graph.inspector.validation.notEditable");
  }
  if (editor.kind === "boolean") {
    return raw === "true" || raw === "false"
      ? { ok: true, value: raw === "true" }
      : invalid("graph.inspector.validation.notEditable");
  }
  if (editor.kind === "choice") {
    return editor.choices.some((choice) => choice.value === raw)
      ? { ok: true, value: raw }
      : invalid("graph.inspector.validation.notAChoice");
  }

  if (raw.length === 0) {
    return required
      ? invalid("graph.inspector.validation.required")
      : { ok: true, value: undefined };
  }
  return editor.kind === "number"
    ? parseNumber(editor, raw)
    : parseText(editor, raw);
}

/** Reports whether a committed value still matches the editor that produced it.
 *
 * A document is untrusted input: it may have been written by a newer definition, edited
 * by hand, or saved before a definition changed. The inspector says so rather than
 * silently rewriting the stored value.
 */
export function matchesEditor(
  editor: FieldEditor,
  value: EditableValue | undefined,
): boolean {
  if (value === undefined) {
    return true;
  }
  switch (editor.kind) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "choice":
      return (
        typeof value === "string" &&
        editor.choices.some((choice) => choice.value === value)
      );
    case "unsupported":
      return false;
    default: {
      const unhandled: never = editor;
      return unhandled;
    }
  }
}
