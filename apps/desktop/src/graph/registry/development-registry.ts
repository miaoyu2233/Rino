import {
  isValidRegistrySnapshot,
  type RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";

import coreDefinitions from "../../../../../contracts/fixtures/registry/valid/core-definitions.json";
import { useRegistryStore } from "./registry-store";

/** The node definitions the editor uses before a runtime is available.
 *
 * The Python runtime owns the authoritative registry and sends it once connected; until
 * that exists the editor needs definitions to render, type-check, and validate against.
 * The snapshot is the shared contract example, so the editor and the cross-language
 * parity tests cannot disagree about the same definitions, and it is validated here
 * rather than trusted.
 *
 * Installing it is an explicit call from application start-up, never a fallback inside a
 * lookup, so a runtime registry can only be replaced by another deliberate installation.
 */
export function developmentRegistrySnapshot(): RinoNodeRegistrySnapshotV1 {
  const snapshot: unknown = coreDefinitions;
  if (!isValidRegistrySnapshot(snapshot)) {
    throw new TypeError(
      "The development node registry does not match the registry schema.",
    );
  }
  return snapshot;
}

export function installDevelopmentRegistry(): void {
  useRegistryStore
    .getState()
    .installSnapshot(developmentRegistrySnapshot(), "development");
}
