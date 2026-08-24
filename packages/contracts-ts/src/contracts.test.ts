import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { rinoIpcV1Schema } from "./generated/rino-ipc-v1.schema";
import type {
  PersistentBoolVariableV1,
  PersistentNumberVariableV1,
  PersistentPointVariableV1,
  PersistentRectVariableV1,
  PersistentStringVariableV1,
  PersistentVariableValueV1,
} from "./index";
import {
  eventFamilies,
  isEventType,
  isRequestType,
  requestFamilies,
} from "./message-families";
import {
  describeMessageErrors,
  isValidMessage,
  isValidPayload,
} from "./validation";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "../../..");
const fixturesRoot = resolve(repositoryRoot, "contracts/fixtures");
const canonicalSchemaPath = resolve(
  repositoryRoot,
  "contracts/ipc/rino-ipc-v1.schema.json",
);

interface Fixture {
  name: string;
  value: unknown;
}

function readFixtures(directory: string): Fixture[] {
  const directoryPath = join(fixturesRoot, directory);
  return readdirSync(directoryPath)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      value: JSON.parse(
        readFileSync(join(directoryPath, name), "utf8"),
      ) as unknown,
    }));
}

interface EnvelopeShape {
  messageKind: string;
  messageType: string;
  payload?: unknown;
  result?: unknown;
}

function asEnvelopeShape(value: unknown): EnvelopeShape {
  return value as EnvelopeShape;
}

function boundPayload(value: unknown): {
  definitionKnown: boolean;
  valid: boolean;
} {
  const envelope = asEnvelopeShape(value);
  if (
    envelope.messageKind === "request" &&
    isRequestType(envelope.messageType)
  ) {
    const family = requestFamilies[envelope.messageType];
    return {
      definitionKnown: true,
      valid: isValidPayload(family.requestPayload, envelope.payload),
    };
  }
  if (
    envelope.messageKind === "response" &&
    isRequestType(envelope.messageType) &&
    envelope.result !== undefined
  ) {
    const family = requestFamilies[envelope.messageType];
    return {
      definitionKnown: true,
      valid: isValidPayload(family.result, envelope.result),
    };
  }
  if (envelope.messageKind === "event" && isEventType(envelope.messageType)) {
    return {
      definitionKnown: true,
      valid: isValidPayload(
        eventFamilies[envelope.messageType],
        envelope.payload,
      ),
    };
  }
  return { definitionKnown: false, valid: true };
}

describe("canonical schema artifacts", () => {
  it("matches the canonical schema byte for byte", () => {
    const canonical: unknown = JSON.parse(
      readFileSync(canonicalSchemaPath, "utf8"),
    );
    expect(rinoIpcV1Schema).toEqual(canonical);
  });

  it("rejects non-finite JSON numbers at the parser boundary", () => {
    const parse = (text: string): unknown => JSON.parse(text) as unknown;

    expect(() => parse('{"value":NaN}')).toThrow(SyntaxError);
    expect(() => parse('{"value":Infinity}')).toThrow(SyntaxError);
  });
});

describe("public IPC persistent variable types", () => {
  it("exports the discriminated value union from the package entrypoint", () => {
    const boolValue: PersistentBoolVariableV1 = {
      variableId: "90000000-0000-4000-8000-000000000010",
      valueKind: "bool",
      value: true,
    };
    const numberValue: PersistentNumberVariableV1 = {
      variableId: "90000000-0000-4000-8000-000000000011",
      valueKind: "number",
      value: 1.5,
    };
    const stringValue: PersistentStringVariableV1 = {
      variableId: "90000000-0000-4000-8000-000000000012",
      valueKind: "string",
      value: "saved",
    };
    const pointValue: PersistentPointVariableV1 = {
      variableId: "90000000-0000-4000-8000-000000000013",
      valueKind: "point",
      value: { x: 1, y: 2 },
    };
    const rectValue: PersistentRectVariableV1 = {
      variableId: "90000000-0000-4000-8000-000000000014",
      valueKind: "rect",
      value: { x: 1, y: 2, width: 3, height: 4 },
    };
    const values: PersistentVariableValueV1[] = [
      boolValue,
      numberValue,
      stringValue,
      pointValue,
      rectValue,
    ];

    expect(values.map((value) => value.valueKind)).toEqual([
      "bool",
      "number",
      "string",
      "point",
      "rect",
    ]);
  });
});

describe("shared valid fixtures", () => {
  for (const fixture of readFixtures("valid")) {
    it(`accepts ${fixture.name} and its bound payload`, () => {
      expect(isValidMessage(fixture.value)).toBe(true);
      expect(boundPayload(fixture.value).valid).toBe(true);

      const roundTrip: unknown = JSON.parse(JSON.stringify(fixture.value));
      expect(isValidMessage(roundTrip)).toBe(true);
    });
  }
});

describe("shared invalid fixtures", () => {
  for (const fixture of readFixtures("invalid")) {
    it(`rejects ${fixture.name} with a bounded diagnostic`, () => {
      expect(isValidMessage(fixture.value)).toBe(false);
      const summary = describeMessageErrors(fixture.value);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.length).toBeLessThan(512);
    });
  }
});

describe("shared payload-invalid fixtures", () => {
  for (const fixture of readFixtures("payload-invalid")) {
    it(`accepts the envelope but rejects the payload of ${fixture.name}`, () => {
      expect(isValidMessage(fixture.value)).toBe(true);
      const binding = boundPayload(fixture.value);
      expect(binding.definitionKnown).toBe(true);
      expect(binding.valid).toBe(false);
    });
  }
});
