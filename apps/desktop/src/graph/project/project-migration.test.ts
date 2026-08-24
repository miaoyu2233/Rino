import { describe, expect, it } from "vitest";

import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  migrateProjectManifest,
  PROJECT_MIGRATION_STEPS,
  type ProjectMigrationStep,
} from "./project-migration";

/** A ladder from an imagined earlier format, so the harness is exercised before the first
 * real migration exists. */
const PRETEND_LADDER: readonly ProjectMigrationStep[] = [
  {
    fromVersion: -1,
    toVersion: 0,
    apply: (manifest) => ({ ...manifest, schemaVersion: 0, raisedFrom: -1 }),
  },
  {
    fromVersion: 0,
    toVersion: 1,
    apply: (manifest) => ({
      ...manifest,
      schemaVersion: 1,
      raisedFromZero: true,
    }),
  },
];

describe("the project migration harness", () => {
  it("ships with no step, because version one is the first published format", () => {
    expect(PROJECT_MIGRATION_STEPS).toHaveLength(0);
    expect(CURRENT_PROJECT_SCHEMA_VERSION).toBe(1);
  });

  it("returns a current manifest untouched", () => {
    const manifest = { schemaVersion: 1, documentId: "x" };

    expect(migrateProjectManifest(manifest)).toEqual({
      status: "migrated",
      manifest,
      applied: 0,
    });
  });

  it("applies every step between the stored version and the current one", () => {
    const outcome = migrateProjectManifest(
      { schemaVersion: -1, documentId: "x" },
      PRETEND_LADDER,
    );

    expect(outcome).toEqual({
      status: "migrated",
      manifest: {
        schemaVersion: 1,
        documentId: "x",
        raisedFrom: -1,
        raisedFromZero: true,
      },
      applied: 2,
    });
  });

  it("refuses a version newer than this build writes", () => {
    expect(migrateProjectManifest({ schemaVersion: 2 })).toEqual({
      status: "unsupportedVersion",
      foundVersion: 2,
    });
  });

  it("refuses an older version no step can raise", () => {
    expect(migrateProjectManifest({ schemaVersion: 0 })).toEqual({
      status: "unsupportedVersion",
      foundVersion: 0,
    });
  });

  it("reports a manifest whose version cannot be read at all", () => {
    expect(migrateProjectManifest({ schemaVersion: "one" })).toEqual({
      status: "unreadableVersion",
    });
    expect(migrateProjectManifest({})).toEqual({ status: "unreadableVersion" });
  });
});
