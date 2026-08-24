import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

import type { FormatsPlugin } from "ajv-formats";

import type { RinoProtocolEnvelopeV1 } from "../generated/typescript/protocol-envelope-v1.js";

interface FixtureCase {
  file: string;
  valid: boolean;
}

interface FixtureManifest {
  cases: FixtureCase[];
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDirectory, "../..");
const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as unknown as FormatsPlugin;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFixtureCase(value: unknown): FixtureCase {
  if (
    !isRecord(value) ||
    typeof value.file !== "string" ||
    typeof value.valid !== "boolean"
  ) {
    throw new Error("Fixture manifest contains an invalid case.");
  }
  return { file: value.file, valid: value.valid };
}

function readFixtureManifest(value: unknown): FixtureManifest {
  if (!isRecord(value) || !Array.isArray(value.cases)) {
    throw new Error("Fixture manifest is invalid.");
  }
  return { cases: value.cases.map(readFixtureCase) };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

const schemaValue = await readJson(
  resolve(projectRoot, "schemas/protocol-envelope-v1.schema.json"),
);
if (!isRecord(schemaValue)) {
  throw new Error("Canonical schema must be an object.");
}

const manifest = readFixtureManifest(
  await readJson(resolve(projectRoot, "fixtures/manifest.json")),
);
const validatorEngine = new Ajv2020({
  allErrors: true,
  allowUnionTypes: false,
  strict: true,
  validateFormats: true,
});
addFormats(validatorEngine);
const validateEnvelope =
  validatorEngine.compile<RinoProtocolEnvelopeV1>(schemaValue);

let rejectedNonFiniteNumber = false;
try {
  JSON.parse('{"value":NaN}');
} catch (error: unknown) {
  if (error instanceof SyntaxError) {
    rejectedNonFiniteNumber = true;
  } else {
    throw error;
  }
}
if (!rejectedNonFiniteNumber) {
  throw new Error("TypeScript JSON parsing accepted a non-finite number.");
}

let validCaseCount = 0;
let invalidCaseCount = 0;
for (const fixtureCase of manifest.cases) {
  const fixture = await readJson(resolve(projectRoot, "fixtures", fixtureCase.file));
  if (validateEnvelope(fixture)) {
    if (!fixtureCase.valid) {
      throw new Error(
        `TypeScript accepted invalid fixture ${fixtureCase.file}.`,
      );
    }
    const envelope: RinoProtocolEnvelopeV1 = fixture;
    const roundTrip: unknown = JSON.parse(JSON.stringify(envelope));
    if (!validateEnvelope(roundTrip)) {
      throw new Error(`TypeScript round trip failed for ${fixtureCase.file}.`);
    }
    validCaseCount += 1;
  } else {
    if (fixtureCase.valid) {
      throw new Error(
        `TypeScript rejected valid fixture ${fixtureCase.file}.`,
      );
    }
    invalidCaseCount += 1;
  }
}

console.log(
  JSON.stringify({
    invalidCaseCount,
    language: "typescript",
    totalCaseCount: manifest.cases.length,
    validCaseCount,
  }),
);
