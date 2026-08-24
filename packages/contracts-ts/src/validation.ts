import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";

import { rinoDiagnosticsV1Schema } from "./generated/rino-diagnostics-v1.schema";
import type { RinoGraphDiagnosticReportV1 } from "./generated/rino-diagnostics-v1.types";
import { rinoGraphV1Schema } from "./generated/rino-graph-v1.schema";
import type {
  GraphDocumentV1,
  ProjectManifestV1,
  RinoProjectDocumentV1,
} from "./generated/rino-graph-v1.types";
import { rinoIpcV1Schema } from "./generated/rino-ipc-v1.schema";
import type { RinoIpcMessageV1 } from "./generated/rino-ipc-v1.types";
import { rinoRegistryV1Schema } from "./generated/rino-registry-v1.schema";
import type { RinoNodeRegistrySnapshotV1 } from "./generated/rino-registry-v1.types";
import type { PayloadDefinitionName } from "./message-families";

const IPC_SCHEMA_ID =
  "https://schemas.rino.invalid/ipc/rino-ipc-v1.schema.json";
const GRAPH_SCHEMA_ID =
  "https://schemas.rino.invalid/graph/rino-graph-v1.schema.json";
const REGISTRY_SCHEMA_ID =
  "https://schemas.rino.invalid/registry/rino-registry-v1.schema.json";
const DIAGNOSTICS_SCHEMA_ID =
  "https://schemas.rino.invalid/diagnostics/rino-diagnostics-v1.schema.json";

const UUID_FORMAT_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE_TIME_FORMAT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const MAXIMUM_REPORTED_ERRORS = 4;

interface CompiledValidators {
  engine: Ajv2020;
  message: ValidateFunction;
  projectDocument: ValidateFunction;
  registrySnapshot: ValidateFunction;
  diagnosticReport: ValidateFunction;
  definitions: Map<string, ValidateFunction>;
}

let compiledValidators: CompiledValidators | undefined;

function compiledSchema(engine: Ajv2020, schemaId: string): ValidateFunction {
  const validator = engine.getSchema(schemaId);
  if (!validator) {
    throw new Error(`The canonical schema ${schemaId} failed to compile.`);
  }
  return validator;
}

function validators(): CompiledValidators {
  if (compiledValidators) {
    return compiledValidators;
  }
  const engine = new Ajv2020({
    allErrors: false,
    allowUnionTypes: false,
    strict: true,
    validateFormats: true,
  });
  engine.addFormat("uuid", UUID_FORMAT_PATTERN);
  engine.addFormat("date-time", DATE_TIME_FORMAT_PATTERN);
  engine.addSchema(rinoIpcV1Schema);
  engine.addSchema(rinoGraphV1Schema);
  engine.addSchema(rinoRegistryV1Schema);
  engine.addSchema(rinoDiagnosticsV1Schema);

  compiledValidators = {
    engine,
    message: compiledSchema(engine, IPC_SCHEMA_ID),
    projectDocument: compiledSchema(engine, GRAPH_SCHEMA_ID),
    registrySnapshot: compiledSchema(engine, REGISTRY_SCHEMA_ID),
    diagnosticReport: compiledSchema(engine, DIAGNOSTICS_SCHEMA_ID),
    definitions: new Map(),
  };
  return compiledValidators;
}

function definitionValidator(
  schemaId: string,
  definition: string,
): ValidateFunction {
  const compiled = validators();
  const cacheKey = `${schemaId}#${definition}`;
  const existing = compiled.definitions.get(cacheKey);
  if (existing) {
    return existing;
  }
  const validator = compiled.engine.compile({
    $ref: `${schemaId}#/$defs/${definition}`,
  });
  compiled.definitions.set(cacheKey, validator);
  return validator;
}

/** Returns a bounded structural summary that never echoes the validated content. */
function describeErrors(validator: ValidateFunction): string {
  const errors = validator.errors ?? [];
  return errors
    .slice(0, MAXIMUM_REPORTED_ERRORS)
    .map((error) => `${error.instancePath || "/"} ${error.keyword}`)
    .join("; ");
}

/** Validates one decoded JSON value against the canonical envelope schema. */
export function isValidMessage(value: unknown): value is RinoIpcMessageV1 {
  return validators().message(value);
}

/** Returns a bounded validation summary for diagnostics without echoing payload data. */
export function describeMessageErrors(value: unknown): string {
  const compiled = validators();
  if (compiled.message(value)) {
    return "";
  }
  return describeErrors(compiled.message);
}

/** Validates a message payload or result against one named canonical definition. */
export function isValidPayload(
  definition: PayloadDefinitionName,
  value: unknown,
): boolean {
  return definitionValidator(IPC_SCHEMA_ID, definition)(value);
}

/** Validates one persisted project document against the canonical graph schema. */
export function isValidProjectDocument(
  value: unknown,
): value is RinoProjectDocumentV1 {
  return validators().projectDocument(value);
}

/** Returns a bounded validation summary for a rejected project document. */
export function describeProjectDocumentErrors(value: unknown): string {
  const compiled = validators();
  if (compiled.projectDocument(value)) {
    return "";
  }
  return describeErrors(compiled.projectDocument);
}

/** Validates one registry snapshot against the canonical registry schema. */
export function isValidRegistrySnapshot(
  value: unknown,
): value is RinoNodeRegistrySnapshotV1 {
  return validators().registrySnapshot(value);
}

/** Returns a bounded validation summary for a rejected registry snapshot. */
export function describeRegistrySnapshotErrors(value: unknown): string {
  const compiled = validators();
  if (compiled.registrySnapshot(value)) {
    return "";
  }
  return describeErrors(compiled.registrySnapshot);
}

/** Validates one persisted project.rino.json manifest. */
export function isValidProjectManifest(
  value: unknown,
): value is ProjectManifestV1 {
  return definitionValidator(GRAPH_SCHEMA_ID, "ProjectManifestV1")(value);
}

/** Returns a bounded validation summary for a rejected project manifest. */
export function describeProjectManifestErrors(value: unknown): string {
  const validator = definitionValidator(GRAPH_SCHEMA_ID, "ProjectManifestV1");
  return validator(value) ? "" : describeErrors(validator);
}

/** Validates one persisted graph file. */
export function isValidGraphDocument(value: unknown): value is GraphDocumentV1 {
  return definitionValidator(GRAPH_SCHEMA_ID, "GraphDocumentV1")(value);
}

/** Returns a bounded validation summary for a rejected graph file. */
export function describeGraphDocumentErrors(value: unknown): string {
  const validator = definitionValidator(GRAPH_SCHEMA_ID, "GraphDocumentV1");
  return validator(value) ? "" : describeErrors(validator);
}

/** Validates a value against one named definition of the graph schema. */
export function isValidGraphDefinition(
  definition: string,
  value: unknown,
): boolean {
  return definitionValidator(GRAPH_SCHEMA_ID, definition)(value);
}

/** Validates a value against one named definition of the registry schema. */
export function isValidRegistryDefinition(
  definition: string,
  value: unknown,
): boolean {
  return definitionValidator(REGISTRY_SCHEMA_ID, definition)(value);
}

/** Validates one graph validation report against the canonical diagnostics schema. */
export function isValidDiagnosticReport(
  value: unknown,
): value is RinoGraphDiagnosticReportV1 {
  return validators().diagnosticReport(value);
}
