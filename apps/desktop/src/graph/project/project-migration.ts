/** The schema version this build writes and can execute. */
export const CURRENT_PROJECT_SCHEMA_VERSION = 1;

/** One step that rewrites a manifest from one schema version to the next.
 *
 * A step receives the decoded JSON value rather than a typed manifest, because the shape
 * it reads belongs to a version this build no longer has a type for.
 */
export interface ProjectMigrationStep {
  readonly fromVersion: number;
  readonly toVersion: number;
  apply: (manifest: Record<string, unknown>) => Record<string, unknown>;
}

/** The ordered migration ladder.
 *
 * Version one is the first published format, so the ladder is empty. It exists now so
 * that the first real migration is a single entry rather than a new subsystem, and so
 * the version gate below is exercised from the day the format ships.
 */
export const PROJECT_MIGRATION_STEPS: readonly ProjectMigrationStep[] = [];

export type ProjectMigrationOutcome =
  | { status: "migrated"; manifest: Record<string, unknown>; applied: number }
  | { status: "unsupportedVersion"; foundVersion: number }
  | { status: "unreadableVersion" };

function readSchemaVersion(
  manifest: Record<string, unknown>,
): number | undefined {
  const value = manifest["schemaVersion"];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

/** Raises a decoded manifest to the current schema version.
 *
 * A newer-than-current version is refused rather than guessed at: opening it read-only
 * would still let a later save rewrite fields this build cannot see, and the user is
 * better served by being told to update the application.
 */
export function migrateProjectManifest(
  manifest: Record<string, unknown>,
  steps: readonly ProjectMigrationStep[] = PROJECT_MIGRATION_STEPS,
): ProjectMigrationOutcome {
  const foundVersion = readSchemaVersion(manifest);
  if (foundVersion === undefined) {
    return { status: "unreadableVersion" };
  }
  if (foundVersion > CURRENT_PROJECT_SCHEMA_VERSION) {
    return { status: "unsupportedVersion", foundVersion };
  }

  let current = manifest;
  let version = foundVersion;
  let applied = 0;
  while (version < CURRENT_PROJECT_SCHEMA_VERSION) {
    const step = steps.find((candidate) => candidate.fromVersion === version);
    if (!step) {
      return { status: "unsupportedVersion", foundVersion };
    }
    current = step.apply(current);
    version = step.toVersion;
    applied += 1;
  }

  return { status: "migrated", manifest: current, applied };
}
