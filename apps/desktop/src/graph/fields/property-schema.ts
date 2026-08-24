import type { NodeDefinitionV1 } from "@rino/contracts";

import type { EditableValue } from "../commands/graph-commands";
import {
  UNSUPPORTED_TYPE_EDITOR,
  type FieldChoice,
  type FieldEditor,
} from "./field-editor";

/** Vendor keywords the registry uses to attach localization to a property schema.
 *
 * The registry sends localization keys rather than translated text, and JSON Schema has
 * no keyword for that: `title` and `description` are display text. Annotating with an
 * explicit prefix keeps the two apart, and an unknown keyword is ignored by any standard
 * validator, so a schema stays usable for validation elsewhere.
 */
const LABEL_KEY = "x-rinoLabelKey";
const DESCRIPTION_KEY = "x-rinoDescriptionKey";
const UNIT_KEY = "x-rinoUnitKey";
const OPTION_LABEL_KEYS = "x-rinoOptionLabelKeys";

/** Bounds how much of an oversized declaration the inspector draws. A definition arrives
 * over the runtime boundary, so its property count is treated as untrusted input. */
export const MAXIMUM_PROPERTY_FIELDS = 64;

export interface PropertyField {
  propertyKey: string;
  labelKey: string;
  descriptionKey: string | undefined;
  required: boolean;
  /** The value `Reset` returns to, taken from the definition's declared defaults. Absent
   * when the definition declares no default, in which case there is nothing to reset to. */
  defaultValue: EditableValue | undefined;
  editor: FieldEditor;
}

export interface PropertyFieldSet {
  fields: readonly PropertyField[];
  /** The definition declares a property schema this editor cannot read as an object
   * schema. Its stored properties are still shown, read-only, rather than hidden. */
  schemaUnreadable: boolean;
  /** How many declared properties exceeded the rendering bound. */
  hiddenFieldCount: number;
}

const EMPTY_FIELD_SET: PropertyFieldSet = {
  fields: [],
  schemaUnreadable: false,
  hiddenFieldCount: 0,
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readRequiredNames(schema: UnknownRecord): ReadonlySet<string> {
  const declared = schema["required"];
  if (!Array.isArray(declared)) {
    return new Set<string>();
  }
  return new Set(
    declared.filter((entry): entry is string => typeof entry === "string"),
  );
}

function readChoices(
  field: UnknownRecord,
  values: readonly unknown[],
): FieldEditor {
  const labelKeys = asRecord(field[OPTION_LABEL_KEYS]);
  if (!labelKeys) {
    return { kind: "unsupported", reason: "choicesInvalid" };
  }
  const choices: FieldChoice[] = [];
  for (const value of values) {
    const labelKey =
      typeof value === "string" ? asString(labelKeys[value]) : undefined;
    if (typeof value !== "string" || labelKey === undefined) {
      // A choice the user cannot read is worse than a refused control: it would commit an
      // opaque value into the document.
      return { kind: "unsupported", reason: "choicesInvalid" };
    }
    choices.push({
      value,
      labelKey,
      ...(labelKey.includes(".option.")
        ? {
            descriptionKey: labelKey.replace(".option.", ".optionDescription."),
          }
        : {}),
    });
  }
  return choices.length > 0
    ? { kind: "choice", choices }
    : { kind: "unsupported", reason: "choicesInvalid" };
}

function readEditor(field: UnknownRecord): FieldEditor {
  const declaredType = asString(field["type"]);
  const enumValues = field["enum"];

  if (Array.isArray(enumValues)) {
    return declaredType === "string" || declaredType === undefined
      ? readChoices(field, enumValues)
      : { kind: "unsupported", reason: "typeUnsupported" };
  }

  switch (declaredType) {
    case "boolean":
      return { kind: "boolean" };
    case "string":
      return {
        kind: "text",
        minimumLength: asFiniteNumber(field["minLength"]),
        maximumLength: asFiniteNumber(field["maxLength"]),
      };
    case "number":
    case "integer":
      return {
        kind: "number",
        integer: declaredType === "integer",
        minimum: asFiniteNumber(field["minimum"]),
        maximum: asFiniteNumber(field["maximum"]),
        unitKey: asString(field[UNIT_KEY]),
      };
    default:
      return UNSUPPORTED_TYPE_EDITOR;
  }
}

/** Reads a node definition's property schema into the fields the inspector renders.
 *
 * The supported subset is deliberately narrow: a scalar, a bounded numeric range, or a
 * labelled choice. Anything else is reported as a property without an editor and its
 * stored value is preserved, because a definition may legitimately describe a value that
 * belongs to a specialist editor introduced by a later task.
 */
export function readPropertyFields(
  definition: NodeDefinitionV1,
): PropertyFieldSet {
  const schema = definition.propertySchema;
  if (schema === undefined) {
    return EMPTY_FIELD_SET;
  }

  const properties = asRecord(schema["properties"]);
  if (!properties || asString(schema["type"]) !== "object") {
    return { fields: [], schemaUnreadable: true, hiddenFieldCount: 0 };
  }

  const required = readRequiredNames(schema);
  const defaults = definition.propertyDefaults ?? {};
  const declared = Object.keys(properties);
  const fields: PropertyField[] = [];

  for (const propertyKey of declared.slice(0, MAXIMUM_PROPERTY_FIELDS)) {
    const field = asRecord(properties[propertyKey]);
    const labelKey = field ? asString(field[LABEL_KEY]) : undefined;
    fields.push({
      propertyKey,
      // A property with no label key would render as a control with no meaning, so it is
      // shown by name and refused rather than guessed at.
      labelKey: labelKey ?? propertyKey,
      descriptionKey: field ? asString(field[DESCRIPTION_KEY]) : undefined,
      required: required.has(propertyKey),
      defaultValue: Object.hasOwn(defaults, propertyKey)
        ? defaults[propertyKey]
        : undefined,
      editor:
        field === undefined
          ? { kind: "unsupported", reason: "declarationInvalid" }
          : labelKey === undefined
            ? { kind: "unsupported", reason: "labelMissing" }
            : readEditor(field),
    });
  }

  return {
    fields,
    schemaUnreadable: false,
    hiddenFieldCount: Math.max(0, declared.length - MAXIMUM_PROPERTY_FIELDS),
  };
}
