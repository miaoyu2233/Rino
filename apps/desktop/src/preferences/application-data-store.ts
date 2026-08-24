import type { PersistentVariableValueV1 } from "@rino/contracts";
import { create } from "zustand";

import {
  APPLICATION_DATA_STORAGE_KEY,
  createApplicationDataDocument,
  normalizeAssetNameOrdinalKey,
  parseApplicationDataDocument,
  type ApplicationDataDocumentV1,
} from "./application-data";
import {
  variablesForGraph,
  type VariableDocumentSource,
} from "../graph/variables/variable-authoring";
import {
  MAX_PERSISTENT_VARIABLE_DOCUMENTS,
  clonePersistentVariableValues,
  isUuid,
  selectPersistentVariableInitialValues,
  validatePersistentVariableValues,
} from "./persistent-variable-data";

export type ApplicationDataStorageStatus = "stored" | "memoryOnly";

export type PersistentVariableMutationFailureReason =
  | "invalidDocumentId"
  | "documentLimitExceeded"
  | "invalidValues"
  | "unknownVariable"
  | "nonPersistentVariable"
  | "valueKindMismatch"
  | "duplicateVariableId"
  | "storageUnavailable";

export type PersistentVariableMutationResult =
  | { ok: true; storageStatus: ApplicationDataStorageStatus }
  | {
      ok: false;
      reason: PersistentVariableMutationFailureReason;
      storageStatus: ApplicationDataStorageStatus;
    };

interface ApplicationDataState {
  installationCode: string | undefined;
  assetNameOrdinals: Record<string, number>;
  persistentVariablesByDocument: Record<string, PersistentVariableValueV1[]>;
  storageStatus: ApplicationDataStorageStatus;
  nextAssetNameOrdinal: (visibleName: string) => number;
  recordAssetNameOrdinal: (visibleName: string, ordinal: number) => void;
  readPersistentVariableInitialValues: (
    documentId: string,
    document: VariableDocumentSource,
    graphId?: string,
  ) => PersistentVariableValueV1[];
  mergePersistentVariableUpdates: (
    documentId: string,
    document: VariableDocumentSource,
    updates: readonly unknown[],
    graphId?: string,
  ) => PersistentVariableMutationResult;
  clearPersistentVariablesForDocument: (
    documentId: string,
  ) => PersistentVariableMutationResult;
  clearAllPersistentVariables: () => PersistentVariableMutationResult;
}

function persistApplicationData(
  document: ApplicationDataDocumentV1,
): ApplicationDataStorageStatus {
  try {
    window.localStorage.setItem(
      APPLICATION_DATA_STORAGE_KEY,
      JSON.stringify(document),
    );
    return "stored";
  } catch {
    return "memoryOnly";
  }
}

function copyPersistentVariablesByDocument(
  values: Record<string, PersistentVariableValueV1[]>,
): Record<string, PersistentVariableValueV1[]> {
  return Object.fromEntries(
    Object.entries(values).map(([documentId, documentValues]) => [
      documentId,
      clonePersistentVariableValues(documentValues),
    ]),
  );
}

function mutationFailure(
  reason: PersistentVariableMutationFailureReason,
): PersistentVariableMutationResult {
  return {
    ok: false,
    reason,
    storageStatus: useApplicationDataStore.getState().storageStatus,
  };
}

function persistPersistentVariableMap(
  nextValues: Record<string, PersistentVariableValueV1[]>,
): PersistentVariableMutationResult {
  const state = useApplicationDataStore.getState();
  if (state.installationCode === undefined) {
    return mutationFailure("storageUnavailable");
  }
  const storageStatus = persistApplicationData({
    version: 1,
    installationCode: state.installationCode,
    assetNameOrdinals: state.assetNameOrdinals,
    persistentVariablesByDocument: nextValues,
  });
  useApplicationDataStore.setState({
    persistentVariablesByDocument:
      copyPersistentVariablesByDocument(nextValues),
    storageStatus,
  });
  return { ok: true, storageStatus };
}

export const useApplicationDataStore = create<ApplicationDataState>(
  (set, get) => ({
    installationCode: undefined,
    assetNameOrdinals: {},
    persistentVariablesByDocument: {},
    storageStatus: "memoryOnly",
    nextAssetNameOrdinal: (visibleName) => {
      const key = normalizeAssetNameOrdinalKey(visibleName);
      return (get().assetNameOrdinals[key] ?? 0) + 1;
    },
    recordAssetNameOrdinal: (visibleName, ordinal) => {
      const key = normalizeAssetNameOrdinalKey(visibleName);
      if (!Number.isSafeInteger(ordinal) || ordinal < 1 || key.length === 0) {
        return;
      }
      set((state) => {
        const installationCode = state.installationCode;
        if (
          installationCode === undefined ||
          ordinal <= (state.assetNameOrdinals[key] ?? 0)
        ) {
          return state;
        }
        const assetNameOrdinals = {
          ...state.assetNameOrdinals,
          [key]: ordinal,
        };
        return {
          assetNameOrdinals,
          storageStatus: persistApplicationData({
            version: 1,
            installationCode,
            assetNameOrdinals,
            persistentVariablesByDocument: state.persistentVariablesByDocument,
          }),
        };
      });
    },
    readPersistentVariableInitialValues: (documentId, document, graphId) => {
      if (!isUuid(documentId)) {
        return [];
      }
      return selectPersistentVariableInitialValues(
        document,
        get().persistentVariablesByDocument[documentId] ?? [],
        graphId,
      );
    },
    mergePersistentVariableUpdates: (
      documentId,
      document,
      updates,
      graphId,
    ) => {
      if (!isUuid(documentId)) {
        return mutationFailure("invalidDocumentId");
      }
      const validation = validatePersistentVariableValues(
        variablesForGraph(document, graphId),
        updates,
      );
      if (!validation.ok) {
        const reason =
          validation.reason === "unknownVariable"
            ? "unknownVariable"
            : validation.reason === "nonPersistentVariable"
              ? "nonPersistentVariable"
              : validation.reason === "valueKindMismatch"
                ? "valueKindMismatch"
                : validation.reason === "duplicateVariableId"
                  ? "duplicateVariableId"
                  : "invalidValues";
        return mutationFailure(reason);
      }
      if (validation.values.length === 0) {
        return { ok: true, storageStatus: get().storageStatus };
      }
      const current = get().persistentVariablesByDocument;
      if (
        !Object.hasOwn(current, documentId) &&
        Object.entries(current).length >= MAX_PERSISTENT_VARIABLE_DOCUMENTS
      ) {
        return mutationFailure("documentLimitExceeded");
      }
      const existing = current[documentId] ?? [];
      const valuesById = new Map(
        existing.map((value) => [value.variableId, value]),
      );
      for (const value of validation.values) {
        valuesById.set(value.variableId, value);
      }
      const nextValues = {
        ...current,
        [documentId]: clonePersistentVariableValues([...valuesById.values()]),
      };
      return persistPersistentVariableMap(nextValues);
    },
    clearPersistentVariablesForDocument: (documentId) => {
      if (!isUuid(documentId)) {
        return mutationFailure("invalidDocumentId");
      }
      const current = get().persistentVariablesByDocument;
      if (!Object.hasOwn(current, documentId)) {
        return { ok: true, storageStatus: get().storageStatus };
      }
      const nextValues = Object.entries(current).reduce<typeof current>(
        (values, [key, storedValues]) => {
          if (key !== documentId) values[key] = storedValues;
          return values;
        },
        {},
      );
      return persistPersistentVariableMap(nextValues);
    },
    clearAllPersistentVariables: () => {
      if (Object.keys(get().persistentVariablesByDocument).length === 0) {
        return { ok: true, storageStatus: get().storageStatus };
      }
      return persistPersistentVariableMap({});
    },
  }),
);

export function initializeApplicationData(): void {
  if (typeof window === "undefined") {
    return;
  }

  let serializedDocument: string | null = null;
  let storageReadable = true;
  try {
    serializedDocument = window.localStorage.getItem(
      APPLICATION_DATA_STORAGE_KEY,
    );
  } catch {
    storageReadable = false;
  }

  const existing = parseApplicationDataDocument(serializedDocument);
  const document = existing ?? createApplicationDataDocument();
  const storageStatus = storageReadable
    ? existing === undefined
      ? persistApplicationData(document)
      : "stored"
    : "memoryOnly";

  useApplicationDataStore.setState({
    installationCode: document.installationCode,
    assetNameOrdinals: document.assetNameOrdinals,
    persistentVariablesByDocument: document.persistentVariablesByDocument,
    storageStatus,
  });
}

export function currentInstallationCode(): string {
  let installationCode = useApplicationDataStore.getState().installationCode;
  if (installationCode === undefined) {
    initializeApplicationData();
    installationCode = useApplicationDataStore.getState().installationCode;
  }
  if (installationCode === undefined) {
    throw new Error("Application data is unavailable before initialization.");
  }
  return installationCode;
}
