import {
  definitionValidators as diagnosticsDefinitionValidators,
  rootValidator as diagnosticReportValidator,
} from "./generated/rino-diagnostics-v1.validators.js";
import type { RinoGraphDiagnosticReportV1 } from "./generated/rino-diagnostics-v1.types";
import {
  definitionValidators as graphDefinitionValidators,
  rootValidator as projectDocumentValidator,
} from "./generated/rino-graph-v1.validators.js";
import type {
  GraphDocumentV1,
  ProjectManifestV1,
  RinoProjectDocumentV1,
} from "./generated/rino-graph-v1.types";
import {
  definitionValidators as ipcDefinitionValidators,
  rootValidator as messageValidator,
} from "./generated/rino-ipc-v1.validators.js";
import type { RinoIpcMessageV1 } from "./generated/rino-ipc-v1.types";
import {
  definitionValidators as registryDefinitionValidators,
  rootValidator as registrySnapshotValidator,
} from "./generated/rino-registry-v1.validators.js";
import type { RinoNodeRegistrySnapshotV1 } from "./generated/rino-registry-v1.types";
import type { PayloadDefinitionName } from "./message-families";

const MAXIMUM_REPORTED_ERRORS = 4;

interface ValidationError {
  readonly instancePath: string;
  readonly keyword: string;
}

interface StaticValidator {
  (value: unknown): boolean;
  errors?: readonly ValidationError[] | null;
}

const schemaDefinitionValidators = {
  diagnostics: diagnosticsDefinitionValidators,
  graph: graphDefinitionValidators,
  ipc: ipcDefinitionValidators,
  registry: registryDefinitionValidators,
} as const;

function definitionValidator(
  definitions: ReadonlyMap<string, StaticValidator>,
  schemaName: string,
  definition: string,
): StaticValidator {
  const validator = definitions.get(definition);
  if (validator) {
    return validator;
  }
  throw new Error(`Unknown ${schemaName} schema definition: ${definition}.`);
}

/** Returns a bounded structural summary that never echoes the validated content. */
function describeErrors(validator: StaticValidator): string {
  const errors = validator.errors ?? [];
  return errors
    .slice(0, MAXIMUM_REPORTED_ERRORS)
    .map((error) => `${error.instancePath || "/"} ${error.keyword}`)
    .join("; ");
}

/** Validates one decoded JSON value against the canonical envelope schema. */
export function isValidMessage(value: unknown): value is RinoIpcMessageV1 {
  return messageValidator(value);
}

/** Returns a bounded validation summary for diagnostics without echoing payload data. */
export function describeMessageErrors(value: unknown): string {
  if (messageValidator(value)) {
    return "";
  }
  return describeErrors(messageValidator);
}

/** Validates a message payload or result against one named canonical definition. */
export function isValidPayload(
  definition: PayloadDefinitionName,
  value: unknown,
): boolean {
  return definitionValidator(
    schemaDefinitionValidators.ipc,
    "IPC",
    definition,
  )(value);
}

/** Validates one persisted project document against the canonical graph schema. */
export function isValidProjectDocument(
  value: unknown,
): value is RinoProjectDocumentV1 {
  return projectDocumentValidator(value);
}

/** Returns a bounded validation summary for a rejected project document. */
export function describeProjectDocumentErrors(value: unknown): string {
  if (projectDocumentValidator(value)) {
    return "";
  }
  return describeErrors(projectDocumentValidator);
}

/** Validates one registry snapshot against the canonical registry schema. */
export function isValidRegistrySnapshot(
  value: unknown,
): value is RinoNodeRegistrySnapshotV1 {
  return registrySnapshotValidator(value);
}

/** Returns a bounded validation summary for a rejected registry snapshot. */
export function describeRegistrySnapshotErrors(value: unknown): string {
  if (registrySnapshotValidator(value)) {
    return "";
  }
  return describeErrors(registrySnapshotValidator);
}

/** Validates one persisted project.rino.json manifest. */
export function isValidProjectManifest(
  value: unknown,
): value is ProjectManifestV1 {
  return definitionValidator(
    schemaDefinitionValidators.graph,
    "graph",
    "ProjectManifestV1",
  )(value);
}

/** Returns a bounded validation summary for a rejected project manifest. */
export function describeProjectManifestErrors(value: unknown): string {
  const validator = definitionValidator(
    schemaDefinitionValidators.graph,
    "graph",
    "ProjectManifestV1",
  );
  return validator(value) ? "" : describeErrors(validator);
}

/** Validates one persisted graph file. */
export function isValidGraphDocument(value: unknown): value is GraphDocumentV1 {
  return definitionValidator(
    schemaDefinitionValidators.graph,
    "graph",
    "GraphDocumentV1",
  )(value);
}

/** Returns a bounded validation summary for a rejected graph file. */
export function describeGraphDocumentErrors(value: unknown): string {
  const validator = definitionValidator(
    schemaDefinitionValidators.graph,
    "graph",
    "GraphDocumentV1",
  );
  return validator(value) ? "" : describeErrors(validator);
}

/** Validates a value against one named definition of the graph schema. */
export function isValidGraphDefinition(
  definition: string,
  value: unknown,
): boolean {
  return definitionValidator(
    schemaDefinitionValidators.graph,
    "graph",
    definition,
  )(value);
}

/** Validates a value against one named definition of the registry schema. */
export function isValidRegistryDefinition(
  definition: string,
  value: unknown,
): boolean {
  return definitionValidator(
    schemaDefinitionValidators.registry,
    "registry",
    definition,
  )(value);
}

/** Validates one graph validation report against the canonical diagnostics schema. */
export function isValidDiagnosticReport(
  value: unknown,
): value is RinoGraphDiagnosticReportV1 {
  return diagnosticReportValidator(value);
}
