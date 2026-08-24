import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RinoProjectDocumentV1 } from "@rino/contracts";

import {
  APPLICATION_DATA_STORAGE_KEY,
  parseApplicationDataDocument,
} from "./application-data";
import {
  currentInstallationCode,
  initializeApplicationData,
  useApplicationDataStore,
} from "./application-data-store";

const DOCUMENT_ID = "62000000-0000-4000-8000-000000000001";
const BOOL_ID = "62000000-0000-4000-8000-000000000002";
const NUMBER_ID = "62000000-0000-4000-8000-000000000003";
const STRING_ID = "62000000-0000-4000-8000-000000000004";
const IMAGE_ID = "62000000-0000-4000-8000-000000000005";

function persistentDocument(): Pick<RinoProjectDocumentV1, "variables"> {
  return {
    variables: [
      {
        variableId: BOOL_ID,
        name: "enabled",
        valueKind: "bool",
        persistent: true,
      },
      {
        variableId: NUMBER_ID,
        name: "count",
        valueKind: "number",
        persistent: false,
      },
      {
        variableId: STRING_ID,
        name: "label",
        valueKind: "string",
        persistent: true,
      },
      {
        variableId: IMAGE_ID,
        name: "image",
        valueKind: "imageRef",
        persistent: true,
      },
    ],
  };
}

describe("application data store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useApplicationDataStore.setState({
      installationCode: undefined,
      assetNameOrdinals: {},
      persistentVariablesByDocument: {},
      storageStatus: "memoryOnly",
    });
  });

  it("keeps an existing installation code", () => {
    window.localStorage.setItem(
      APPLICATION_DATA_STORAGE_KEY,
      JSON.stringify({ version: 1, installationCode: "RINO2026" }),
    );

    initializeApplicationData();

    expect(currentInstallationCode()).toBe("RINO2026");
    expect(useApplicationDataStore.getState().storageStatus).toBe("stored");
  });

  it("generates and persists a code on first use", () => {
    initializeApplicationData();

    const state = useApplicationDataStore.getState();
    expect(state.installationCode).toMatch(
      /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{8}$/u,
    );
    expect(state.storageStatus).toBe("stored");
    expect(
      JSON.parse(
        window.localStorage.getItem(APPLICATION_DATA_STORAGE_KEY) ?? "null",
      ),
    ).toEqual({
      version: 1,
      installationCode: state.installationCode,
      assetNameOrdinals: {},
      persistentVariablesByDocument: {},
    });
  });

  it("reports memory-only state when persistence fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("blocked");
    });

    initializeApplicationData();

    expect(useApplicationDataStore.getState().installationCode).toBeDefined();
    expect(useApplicationDataStore.getState().storageStatus).toBe("memoryOnly");
  });

  it("keeps monotonic ordinals for normalized visible names", () => {
    window.localStorage.setItem(
      APPLICATION_DATA_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        installationCode: "RINO2026",
        assetNameOrdinals: { 退出按钮: 2 },
      }),
    );
    initializeApplicationData();

    expect(
      useApplicationDataStore.getState().nextAssetNameOrdinal(" 退出按钮 "),
    ).toBe(3);
    useApplicationDataStore.getState().recordAssetNameOrdinal("退出按钮", 3);

    expect(
      useApplicationDataStore.getState().nextAssetNameOrdinal("退出按钮"),
    ).toBe(4);
    expect(
      parseApplicationDataDocument(
        window.localStorage.getItem(APPLICATION_DATA_STORAGE_KEY),
      )?.assetNameOrdinals,
    ).toEqual({ 退出按钮: 3 });
  });

  it("reads and merges persistent values in graph order without touching ordinals", () => {
    window.localStorage.setItem(
      APPLICATION_DATA_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        installationCode: "RINO2026",
        assetNameOrdinals: { asset: 4 },
      }),
    );
    initializeApplicationData();
    const document = persistentDocument();
    expect(
      useApplicationDataStore
        .getState()
        .mergePersistentVariableUpdates(DOCUMENT_ID, document, [
          { variableId: STRING_ID, valueKind: "string", value: "hello" },
          { variableId: BOOL_ID, valueKind: "bool", value: true },
        ]),
    ).toMatchObject({ ok: true });
    expect(
      useApplicationDataStore
        .getState()
        .readPersistentVariableInitialValues(DOCUMENT_ID, document),
    ).toEqual([
      { variableId: BOOL_ID, valueKind: "bool", value: true },
      { variableId: STRING_ID, valueKind: "string", value: "hello" },
    ]);
    expect(
      useApplicationDataStore
        .getState()
        .mergePersistentVariableUpdates(DOCUMENT_ID, document, []),
    ).toMatchObject({ ok: true });
    expect(
      useApplicationDataStore.getState().persistentVariablesByDocument[
        DOCUMENT_ID
      ],
    ).toEqual([
      { variableId: STRING_ID, valueKind: "string", value: "hello" },
      { variableId: BOOL_ID, valueKind: "bool", value: true },
    ]);
    useApplicationDataStore.getState().recordAssetNameOrdinal("asset", 5);
    expect(
      JSON.parse(
        window.localStorage.getItem(APPLICATION_DATA_STORAGE_KEY) ?? "null",
      ),
    ).toMatchObject({
      assetNameOrdinals: { asset: 5 },
      persistentVariablesByDocument: {
        [DOCUMENT_ID]: [
          { variableId: STRING_ID, valueKind: "string", value: "hello" },
          { variableId: BOOL_ID, valueKind: "bool", value: true },
        ],
      },
    });
  });

  it("reads and merges values from the active legacy graph", () => {
    initializeApplicationData();
    const graphId = "62000000-0000-4000-8000-000000000006";
    const legacyDocument = {
      graphs: [
        {
          graphId,
          name: "旧任务",
          kind: "entry" as const,
          nodes: [],
          edges: [],
          variables: [
            {
              variableId: NUMBER_ID,
              name: "legacyCount",
              valueKind: "number" as const,
              persistent: true,
            },
          ],
        },
      ],
    };

    expect(
      useApplicationDataStore
        .getState()
        .mergePersistentVariableUpdates(
          DOCUMENT_ID,
          legacyDocument,
          [{ variableId: NUMBER_ID, valueKind: "number", value: 9 }],
          graphId,
        ),
    ).toMatchObject({ ok: true });
    expect(
      useApplicationDataStore
        .getState()
        .readPersistentVariableInitialValues(
          DOCUMENT_ID,
          legacyDocument,
          graphId,
        ),
    ).toEqual([{ variableId: NUMBER_ID, valueKind: "number", value: 9 }]);
  });

  it("rejects invalid updates and prevents a sixty-fifth document", () => {
    initializeApplicationData();
    const document = persistentDocument();
    expect(
      useApplicationDataStore
        .getState()
        .mergePersistentVariableUpdates(DOCUMENT_ID, document, [
          { variableId: NUMBER_ID, valueKind: "number", value: 1 },
        ]),
    ).toMatchObject({ ok: false, reason: "nonPersistentVariable" });
    const existing = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [
        `62000000-0000-4000-8000-${(100 + index).toString(16).padStart(12, "0")}`,
        [],
      ]),
    );
    useApplicationDataStore.setState({
      persistentVariablesByDocument: existing,
    });
    expect(
      useApplicationDataStore
        .getState()
        .mergePersistentVariableUpdates(DOCUMENT_ID, document, [
          { variableId: BOOL_ID, valueKind: "bool", value: true },
        ]),
    ).toMatchObject({ ok: false, reason: "documentLimitExceeded" });
  });

  it("keeps memory state when local storage rejects a terminal update and supports clear APIs", () => {
    initializeApplicationData();
    const document = persistentDocument();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    const result = useApplicationDataStore
      .getState()
      .mergePersistentVariableUpdates(DOCUMENT_ID, document, [
        { variableId: BOOL_ID, valueKind: "bool", value: true },
      ]);
    expect(result).toEqual({ ok: true, storageStatus: "memoryOnly" });
    expect(
      useApplicationDataStore.getState().persistentVariablesByDocument[
        DOCUMENT_ID
      ],
    ).toEqual([{ variableId: BOOL_ID, valueKind: "bool", value: true }]);
    expect(
      useApplicationDataStore
        .getState()
        .clearPersistentVariablesForDocument(DOCUMENT_ID),
    ).toMatchObject({ ok: true, storageStatus: "memoryOnly" });
    expect(
      useApplicationDataStore.getState().clearAllPersistentVariables(),
    ).toMatchObject({ ok: true, storageStatus: "memoryOnly" });
  });
});
