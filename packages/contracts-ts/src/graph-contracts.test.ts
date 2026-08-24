import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { rinoGraphV1Schema } from "./generated/rino-graph-v1.schema";
import { rinoIpcV1Schema } from "./generated/rino-ipc-v1.schema";
import { rinoRegistryV1Schema } from "./generated/rino-registry-v1.schema";
import {
  describeGraphDocumentErrors,
  describeProjectDocumentErrors,
  describeProjectManifestErrors,
  describeRegistrySnapshotErrors,
  isValidGraphDocument,
  isValidProjectDocument,
  isValidProjectManifest,
  isValidRegistrySnapshot,
} from "./validation";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "../../..");
const fixturesRoot = resolve(repositoryRoot, "contracts/fixtures");

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

function readCanonical(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(resolve(repositoryRoot, relativePath), "utf8"),
  ) as unknown;
}

const variableKinds = [
  "bool",
  "number",
  "string",
  "point",
  "rect",
  "imageRef",
] as const;

function variableId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function variableDefinition(index: number, valueKind: string) {
  return {
    variableId: variableId(index),
    name: `variable-${String(index)}`,
    valueKind,
    persistent: index % 2 === 0,
  };
}

function graphDocument(variables?: unknown[]) {
  const graph: Record<string, unknown> = {
    graphId: "1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea",
    name: "主图",
    kind: "entry",
    nodes: [],
    edges: [],
  };
  if (variables !== undefined) {
    graph["variables"] = variables;
  }
  return {
    schemaVersion: 1,
    documentId: "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
    metadata: {
      name: "新建项目",
      createdAt: "2026-07-26T09:00:00Z",
      updatedAt: "2026-07-26T09:00:00Z",
    },
    entryGraphId: graph["graphId"],
    graphs: [graph],
    assets: [],
    requiredCapabilities: [],
  };
}

function functionGraphDocument(
  signature: unknown = { inputs: [], outputs: [] },
  kind: "entry" | "function" = "function",
) {
  const document = graphDocument();
  const graph = document.graphs[0];
  if (graph === undefined)
    throw new Error("Expected graph document to contain a graph");
  graph["kind"] = kind;
  graph["functionSignature"] = signature;
  return document;
}

function functionParameter(index: number, prefix: "input" | "output") {
  return {
    parameterId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    portId: `${prefix}${String(index)}`,
    name: `${prefix} ${String(index)}`,
    valueKind: index % 2 === 0 ? "number" : "string",
  };
}

describe("canonical graph and registry artifacts", () => {
  it("embeds each canonical schema unchanged", () => {
    expect(rinoGraphV1Schema).toEqual(
      readCanonical("contracts/graph/rino-graph-v1.schema.json"),
    );
    expect(rinoRegistryV1Schema).toEqual(
      readCanonical("contracts/registry/rino-registry-v1.schema.json"),
    );
  });

  it("keeps the shared JSON value definition identical across contracts", () => {
    // The definition is duplicated per contract so every schema stays self-contained for
    // the generators. This test is what keeps the copies from drifting apart.
    const definitions = [
      rinoIpcV1Schema.$defs,
      rinoGraphV1Schema.$defs,
      rinoRegistryV1Schema.$defs,
    ];

    for (const candidate of definitions.slice(1)) {
      expect(candidate.JsonValue).toEqual(definitions[0]?.JsonValue);
      expect(candidate.JsonObject).toEqual(definitions[0]?.JsonObject);
    }
  });
});

describe("project document fixtures", () => {
  for (const fixture of readFixtures("graph/valid")) {
    it(`accepts ${fixture.name}`, () => {
      expect(isValidProjectDocument(fixture.value)).toBe(true);

      const roundTrip: unknown = JSON.parse(JSON.stringify(fixture.value));
      expect(isValidProjectDocument(roundTrip)).toBe(true);
    });
  }

  for (const fixture of readFixtures("graph/invalid")) {
    it(`rejects ${fixture.name} with a bounded diagnostic`, () => {
      expect(isValidProjectDocument(fixture.value)).toBe(false);

      const summary = describeProjectDocumentErrors(fixture.value);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.length).toBeLessThan(512);
    });
  }
});

describe("graph variables", () => {
  it("keeps graphs without variables valid", () => {
    expect(isValidProjectDocument(graphDocument())).toBe(true);
  });

  it("accepts all variable value kinds and round-trips their definitions", () => {
    const document = graphDocument(
      variableKinds.map((valueKind, index) =>
        variableDefinition(index + 1, valueKind),
      ),
    );

    expect(isValidProjectDocument(document)).toBe(true);
    const roundTrip: unknown = JSON.parse(JSON.stringify(document));
    expect(isValidProjectDocument(roundTrip)).toBe(true);
    expect(roundTrip).toEqual(document);
  });

  it("rejects too many variables, unknown fields, and blank names", () => {
    const tooMany = graphDocument(
      Array.from({ length: 129 }, (_, index) =>
        variableDefinition(index + 1, "number"),
      ),
    );
    expect(isValidProjectDocument(tooMany)).toBe(false);

    const unknownField = graphDocument([
      { ...variableDefinition(1, "string"), unexpected: true },
    ]);
    expect(isValidProjectDocument(unknownField)).toBe(false);

    const blankName = graphDocument([
      { ...variableDefinition(1, "bool"), name: " \t\n" },
    ]);
    expect(isValidProjectDocument(blankName)).toBe(false);
  });
});

describe("function graph signatures", () => {
  it("declares the function kind, signature definitions, and conditional rules in the raw schema", () => {
    expect(rinoGraphV1Schema.$defs.GraphKindV1).toMatchObject({
      enum: ["entry", "function"],
    });
    expect(rinoGraphV1Schema.$defs.FunctionParameterV1).toMatchObject({
      required: ["parameterId", "portId", "name", "valueKind"],
    });
    expect(rinoGraphV1Schema.$defs.FunctionSignatureV1).toMatchObject({
      required: ["inputs", "outputs"],
    });
    expect(rinoGraphV1Schema.$defs.GraphV1).toMatchObject({
      if: { properties: { kind: { const: "function" } } },
      then: { required: ["functionSignature"] },
      else: {
        if: { properties: { kind: { const: "entry" } } },
        then: { not: { required: ["functionSignature"] } },
      },
    });
  });

  it("accepts entry graphs and an empty function signature", () => {
    expect(isValidProjectDocument(graphDocument())).toBe(true);
    expect(isValidProjectDocument(functionGraphDocument())).toBe(true);
  });

  it("accepts sixteen author-ordered inputs and outputs", () => {
    const signature = {
      inputs: Array.from({ length: 16 }, (_, index) =>
        functionParameter(index + 1, "input"),
      ),
      outputs: Array.from({ length: 16 }, (_, index) =>
        functionParameter(index + 17, "output"),
      ),
    };

    expect(isValidProjectDocument(functionGraphDocument(signature))).toBe(true);
  });

  it("rejects a missing function signature, an entry signature, and seventeen parameters", () => {
    const missingSignature = functionGraphDocument(undefined);
    const missingGraph = missingSignature.graphs[0];
    if (missingGraph === undefined)
      throw new Error("Expected missing signature graph");
    delete missingGraph["functionSignature"];
    expect(isValidProjectDocument(missingSignature)).toBe(false);

    expect(
      isValidProjectDocument(functionGraphDocument(undefined, "entry")),
    ).toBe(false);

    const tooMany = functionGraphDocument({
      inputs: Array.from({ length: 17 }, (_, index) =>
        functionParameter(index + 1, "input"),
      ),
      outputs: [],
    });
    expect(isValidProjectDocument(tooMany)).toBe(false);
  });
});

describe("repeat hint metadata", () => {
  it("accepts and round-trips a presentation hint attached to an execution edge", () => {
    const document = graphDocument();
    const graph = document.graphs[0];
    if (graph === undefined) {
      throw new Error("The document must contain one graph.");
    }
    graph["edges"] = [
      {
        edgeId: "2c3d4e5f-6071-4283-9495-a6b7c8d9eafb",
        edgeKind: "execution",
        sourceNodeId: "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f",
        sourcePortId: "next",
        targetNodeId: "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80",
        targetPortId: "run",
      },
    ];
    graph["editorMetadata"] = {
      repeatHints: [
        {
          hintId: "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091",
          edgeId: "2c3d4e5f-6071-4283-9495-a6b7c8d9eafb",
          position: { x: 32, y: -48 },
        },
      ],
    };

    expect(isValidProjectDocument(document)).toBe(true);
    const roundTrip: unknown = JSON.parse(JSON.stringify(document));
    expect(roundTrip).toEqual(document);
    expect(isValidProjectDocument(roundTrip)).toBe(true);
  });

  it("rejects extra fields, invalid positions, and more than 500 hints", () => {
    const base = graphDocument();
    const graph = base.graphs[0];
    if (graph === undefined) {
      throw new Error("The document must contain one graph.");
    }
    const hint = {
      hintId: "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091",
      edgeId: "2c3d4e5f-6071-4283-9495-a6b7c8d9eafb",
      position: { x: 0, y: 0 },
    };
    graph["editorMetadata"] = {
      repeatHints: [{ ...hint, unexpected: true }],
    };
    expect(isValidProjectDocument(base)).toBe(false);

    graph["editorMetadata"] = {
      repeatHints: [{ ...hint, hintId: "not-a-uuid" }],
    };
    expect(isValidProjectDocument(base)).toBe(false);

    graph["editorMetadata"] = {
      repeatHints: [{ ...hint, position: { x: 1000001, y: 0 } }],
    };
    expect(isValidProjectDocument(base)).toBe(false);

    graph["editorMetadata"] = {
      repeatHints: Array.from({ length: 501 }, (_, index) => ({
        ...hint,
        hintId: `5f4b8a7e-92a3-4ebf-8ad2-${(index + 1)
          .toString(16)
          .padStart(12, "0")}`,
      })),
    };
    expect(isValidProjectDocument(base)).toBe(false);
  });
});

describe("on-disk project fixtures", () => {
  for (const fixture of readFixtures("manifest/valid")) {
    it(`accepts the manifest ${fixture.name}`, () => {
      expect(isValidProjectManifest(fixture.value)).toBe(true);
    });
  }

  for (const fixture of readFixtures("manifest/invalid")) {
    it(`rejects the manifest ${fixture.name} with a bounded diagnostic`, () => {
      expect(isValidProjectManifest(fixture.value)).toBe(false);

      const summary = describeProjectManifestErrors(fixture.value);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.length).toBeLessThan(512);
    });
  }

  for (const fixture of readFixtures("graph-file/valid")) {
    it(`accepts the graph file ${fixture.name}`, () => {
      expect(isValidGraphDocument(fixture.value)).toBe(true);
    });
  }

  for (const fixture of readFixtures("graph-file/invalid")) {
    it(`rejects the graph file ${fixture.name} with a bounded diagnostic`, () => {
      expect(isValidGraphDocument(fixture.value)).toBe(false);

      const summary = describeGraphDocumentErrors(fixture.value);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.length).toBeLessThan(512);
    });
  }
});

describe("registry snapshot fixtures", () => {
  for (const fixture of readFixtures("registry/valid")) {
    it(`accepts ${fixture.name}`, () => {
      expect(isValidRegistrySnapshot(fixture.value)).toBe(true);
    });
  }

  for (const fixture of readFixtures("registry/invalid")) {
    it(`rejects ${fixture.name} with a bounded diagnostic`, () => {
      expect(isValidRegistrySnapshot(fixture.value)).toBe(false);

      const summary = describeRegistrySnapshotErrors(fixture.value);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.length).toBeLessThan(512);
    });
  }
});

describe("diagnostic safety", () => {
  it("never echoes document content into a validation summary", () => {
    const document = {
      schemaVersion: 1,
      documentId: "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
      metadata: {
        name: "s3cret-project-name",
        createdAt: "2026-07-26T09:00:00Z",
        updatedAt: "2026-07-26T09:00:00Z",
      },
      entryGraphId: "1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea",
      graphs: [],
      assets: [],
      requiredCapabilities: [],
      unexpected: "s3cret-value",
    };

    const summary = describeProjectDocumentErrors(document);

    expect(summary).not.toContain("s3cret-project-name");
    expect(summary).not.toContain("s3cret-value");
  });
});
