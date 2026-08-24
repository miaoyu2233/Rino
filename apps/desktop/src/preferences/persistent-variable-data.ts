import type {
  PersistentVariableValueV1,
  RinoProjectDocumentV1,
} from "@rino/contracts";

import {
  variablesForGraph,
  type VariableDocumentSource,
} from "../graph/variables/variable-authoring";

export const MAX_PERSISTENT_VARIABLES_PER_DOCUMENT = 128;
export const MAX_PERSISTENT_VARIABLE_DOCUMENTS = 64;
export const MAX_PERSISTENT_STRING_CODE_POINTS = 4096;
export const MAX_PERSISTENT_NUMBER_ABSOLUTE = 1e308;
export const INT32_MINIMUM = -2_147_483_648;
export const INT32_MAXIMUM = 2_147_483_647;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type PersistentVariableValueKind =
  PersistentVariableValueV1["valueKind"];

export type PersistentVariableValidationFailureReason =
  | "invalidValue"
  | "tooManyValues"
  | "duplicateVariableId"
  | "unknownVariable"
  | "nonPersistentVariable"
  | "valueKindMismatch";

export interface PersistentVariableValidationFailure {
  ok: false;
  reason: PersistentVariableValidationFailureReason;
  variableId?: string;
}

export interface PersistentVariableValidationSuccess {
  ok: true;
  values: PersistentVariableValueV1[];
}

export type PersistentVariableValidationResult =
  PersistentVariableValidationFailure | PersistentVariableValidationSuccess;

type PersistentVariableDefinition = Pick<
  NonNullable<RinoProjectDocumentV1["variables"]>[number],
  "variableId" | "valueKind" | "persistent"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function isBoundedNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_PERSISTENT_NUMBER_ABSOLUTE
  );
}

function isInt32(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= INT32_MINIMUM &&
    value <= INT32_MAXIMUM
  );
}

function isPersistentPointValue(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["x", "y"]) &&
    isInt32(value["x"]) &&
    isInt32(value["y"])
  );
}

function isPersistentRectValue(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["height", "width", "x", "y"]) &&
    isInt32(value["x"]) &&
    isInt32(value["y"]) &&
    isInt32(value["width"]) &&
    isInt32(value["height"]) &&
    value["width"] >= 1 &&
    value["height"] >= 1
  );
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isPersistentVariableValue(
  value: unknown,
): value is PersistentVariableValueV1 {
  if (!isRecord(value) || !isUuid(value["variableId"])) {
    return false;
  }
  switch (value["valueKind"]) {
    case "bool":
      return (
        hasExactKeys(value, ["value", "valueKind", "variableId"]) &&
        typeof value["value"] === "boolean"
      );
    case "number":
      return (
        hasExactKeys(value, ["value", "valueKind", "variableId"]) &&
        isBoundedNumber(value["value"])
      );
    case "string":
      return (
        hasExactKeys(value, ["value", "valueKind", "variableId"]) &&
        typeof value["value"] === "string" &&
        Array.from(value["value"]).length <= MAX_PERSISTENT_STRING_CODE_POINTS
      );
    case "point":
      return (
        hasExactKeys(value, ["value", "valueKind", "variableId"]) &&
        isPersistentPointValue(value["value"])
      );
    case "rect":
      return (
        hasExactKeys(value, ["value", "valueKind", "variableId"]) &&
        isPersistentRectValue(value["value"])
      );
    default:
      return false;
  }
}

function clonePersistentVariableValue(
  value: PersistentVariableValueV1,
): PersistentVariableValueV1 {
  if (value.valueKind === "point") {
    return { ...value, value: { ...value.value } };
  }
  if (value.valueKind === "rect") {
    return { ...value, value: { ...value.value } };
  }
  return { ...value };
}

export function clonePersistentVariableValues(
  values: readonly PersistentVariableValueV1[],
): PersistentVariableValueV1[] {
  return values.map(clonePersistentVariableValue);
}

/** Parses untrusted application data without allowing a malformed value through. */
export function parsePersistentVariablesByDocument(
  value: unknown,
): Record<string, PersistentVariableValueV1[]> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    return {};
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_PERSISTENT_VARIABLE_DOCUMENTS) {
    return {};
  }
  const result: Record<string, PersistentVariableValueV1[]> = {};
  for (const [documentId, candidate] of entries) {
    if (!isUuid(documentId) || !Array.isArray(candidate)) {
      return {};
    }
    const parsed = parsePersistentVariableValues(candidate);
    if (parsed === undefined) {
      return {};
    }
    result[documentId] = parsed;
  }
  return result;
}

export function parsePersistentVariableValues(
  value: unknown,
): PersistentVariableValueV1[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > MAX_PERSISTENT_VARIABLES_PER_DOCUMENT
  ) {
    return undefined;
  }
  const identifiers = new Set<string>();
  const parsed: PersistentVariableValueV1[] = [];
  for (const candidate of value) {
    if (!isPersistentVariableValue(candidate)) {
      return undefined;
    }
    if (identifiers.has(candidate.variableId)) {
      return undefined;
    }
    identifiers.add(candidate.variableId);
    parsed.push(clonePersistentVariableValue(candidate));
  }
  return parsed;
}

export function validatePersistentVariableValues(
  definitions: readonly PersistentVariableDefinition[],
  values: readonly unknown[],
): PersistentVariableValidationResult {
  if (values.length > MAX_PERSISTENT_VARIABLES_PER_DOCUMENT) {
    return { ok: false, reason: "tooManyValues" };
  }
  const definitionsById = new Map(
    definitions.map((definition) => [definition.variableId, definition]),
  );
  const identifiers = new Set<string>();
  const parsed: PersistentVariableValueV1[] = [];
  for (const candidate of values) {
    if (!isPersistentVariableValue(candidate)) {
      return { ok: false, reason: "invalidValue" };
    }
    if (identifiers.has(candidate.variableId)) {
      return {
        ok: false,
        reason: "duplicateVariableId",
        variableId: candidate.variableId,
      };
    }
    const definition = definitionsById.get(candidate.variableId);
    if (definition === undefined) {
      return {
        ok: false,
        reason: "unknownVariable",
        variableId: candidate.variableId,
      };
    }
    if (!definition.persistent || definition.valueKind === "imageRef") {
      return {
        ok: false,
        reason: "nonPersistentVariable",
        variableId: candidate.variableId,
      };
    }
    if (definition.valueKind !== candidate.valueKind) {
      return {
        ok: false,
        reason: "valueKindMismatch",
        variableId: candidate.variableId,
      };
    }
    identifiers.add(candidate.variableId);
    parsed.push(clonePersistentVariableValue(candidate));
  }
  return { ok: true, values: parsed };
}

export function selectPersistentVariableInitialValues(
  document: VariableDocumentSource,
  storedValues: readonly PersistentVariableValueV1[],
  graphId?: string,
): PersistentVariableValueV1[] {
  const storedById = new Map(
    storedValues.map((value) => [value.variableId, value]),
  );
  const result: PersistentVariableValueV1[] = [];
  for (const definition of variablesForGraph(document, graphId)) {
    if (!definition.persistent || definition.valueKind === "imageRef") {
      continue;
    }
    const value = storedById.get(definition.variableId);
    if (value?.valueKind === definition.valueKind) {
      result.push(clonePersistentVariableValue(value));
    }
  }
  return result;
}
