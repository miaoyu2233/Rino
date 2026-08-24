import {
  generateInstallationCode,
  isInstallationCode,
  type RandomBytesProvider,
} from "../platform/installation-identity";
import { parsePersistentVariablesByDocument } from "./persistent-variable-data";
import type { PersistentVariableValueV1 } from "@rino/contracts";

export const APPLICATION_DATA_STORAGE_KEY = "rino.application-data.v1";
export const APPLICATION_DATA_VERSION = 1;

export interface ApplicationDataDocumentV1 {
  version: 1;
  installationCode: string;
  assetNameOrdinals: Record<string, number>;
  persistentVariablesByDocument: Record<string, PersistentVariableValueV1[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAssetNameOrdinals(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 10_000)
      .filter(
        (entry): entry is [string, number] =>
          entry[0].length > 0 &&
          Array.from(entry[0]).length <= 180 &&
          typeof entry[1] === "number" &&
          Number.isSafeInteger(entry[1]) &&
          entry[1] > 0,
      ),
  );
}

export function normalizeAssetNameOrdinalKey(visibleName: string): string {
  return visibleName.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function parseApplicationDataDocument(
  serializedDocument: string | null,
): ApplicationDataDocumentV1 | undefined {
  if (serializedDocument === null) {
    return undefined;
  }
  try {
    const candidate: unknown = JSON.parse(serializedDocument);
    if (
      !isRecord(candidate) ||
      candidate["version"] !== APPLICATION_DATA_VERSION ||
      !isInstallationCode(candidate["installationCode"])
    ) {
      return undefined;
    }
    return {
      version: APPLICATION_DATA_VERSION,
      installationCode: candidate["installationCode"],
      assetNameOrdinals: parseAssetNameOrdinals(candidate["assetNameOrdinals"]),
      persistentVariablesByDocument: parsePersistentVariablesByDocument(
        candidate["persistentVariablesByDocument"],
      ),
    };
  } catch {
    return undefined;
  }
}

export function createApplicationDataDocument(
  randomBytes?: RandomBytesProvider,
): ApplicationDataDocumentV1 {
  return {
    version: APPLICATION_DATA_VERSION,
    installationCode: generateInstallationCode(randomBytes),
    assetNameOrdinals: {},
    persistentVariablesByDocument: {},
  };
}
