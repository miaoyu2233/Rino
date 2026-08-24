import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationFrame } from "../app-shell/ApplicationFrame";
import { openProjectDocument } from "../graph/store/project-lifecycle";
import { TooltipProvider } from "../components/ui/Tooltip";
import { ThemeProvider } from "../design-system/theme/ThemeProvider";
import { applicationI18n } from "../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import { LocaleProvider } from "../localization/LocaleProvider";
import { useDiagnosticStore } from "../diagnostics/diagnostic-store";
import { defaultLayoutPreferences } from "../preferences/layout-preferences";
import { useLayoutPreferenceStore } from "../preferences/layout-preference-store";
import { useApplicationDataStore } from "../preferences/application-data-store";
import {
  currentPersistentVariableRun,
  registerPersistentVariableRun,
  resetPersistentVariableRunContext,
} from "./persistent-variable-run-context";
import { RuntimeCommandError } from "./runtime-client";
import { RuntimeProvider } from "./RuntimeProvider";
import type { RuntimeEvent, RuntimeStatus } from "./runtime-contract";
import { useRuntimeStore } from "./runtime-store";
import type { RuntimeTransport } from "./runtime-transport";

function readyStatus(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    state: "ready",
    generation: 1,
    automaticRestarts: 0,
    protocolVersion: 1,
    maximumFrameBytes: 1_048_576,
    runtimeVersion: "0.1.0",
    runtimeMode: "source",
    ...overrides,
  };
}

interface ScriptedTransport extends RuntimeTransport {
  emit: (event: RuntimeEvent) => void;
  restartCalls: () => number;
}

function createTransport(
  initial: RuntimeStatus,
  startResult: () => Promise<RuntimeStatus>,
): ScriptedTransport {
  let emitEvent: ((event: RuntimeEvent) => void) | undefined;
  let restarts = 0;

  return {
    status: () => Promise.resolve(initial),
    start: startResult,
    restart: () => {
      restarts += 1;
      return Promise.resolve(readyStatus({ generation: 2 }));
    },
    shutdown: () => Promise.resolve(readyStatus({ state: "stopped" })),
    request: () => Promise.resolve({ state: "ok", uptimeMilliseconds: 1 }),
    readPreview: () =>
      Promise.resolve(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    readCapture: () =>
      Promise.resolve(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    subscribeToEvents: (handler) => {
      emitEvent = handler;
      return Promise.resolve(() => undefined);
    },
    subscribeToDiagnostics: () => Promise.resolve(() => undefined),
    emit: (event) => {
      emitEvent?.(event);
    },
    restartCalls: () => restarts,
  };
}

function renderShell(transport: RuntimeTransport) {
  return render(
    <LocaleProvider>
      <ThemeProvider>
        <TooltipProvider>
          <RuntimeProvider transport={transport}>
            <ApplicationFrame />
          </RuntimeProvider>
        </TooltipProvider>
      </ThemeProvider>
    </LocaleProvider>,
  );
}

function openPersistentDocument(
  documentId: string,
  graphId: string,
  variableId: string,
): void {
  openProjectDocument({
    schemaVersion: 1,
    documentId,
    metadata: {
      name: "运行测试",
      createdAt: "2026-08-20T00:00:00Z",
      updatedAt: "2026-08-20T00:00:00Z",
    },
    entryGraphId: graphId,
    graphs: [
      {
        graphId,
        name: "主图",
        kind: "entry",
        nodes: [],
        edges: [],
      },
    ],
    variables: [
      {
        variableId,
        name: "sharedCount",
        valueKind: "number",
        persistent: true,
      },
    ],
    assets: [],
    requiredCapabilities: [],
  });
}

describe("runtime integration in the application shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    useRuntimeStore.getState().reset();
    useDiagnosticStore.setState({ problems: [], notifications: [] });
    resetPersistentVariableRunContext();
    useApplicationDataStore.setState({
      installationCode: "RINO2026",
      assetNameOrdinals: {},
      persistentVariablesByDocument: {},
      storageStatus: "stored",
    });
    useLayoutPreferenceStore.setState({
      layout: { ...defaultLayoutPreferences },
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
  });

  it("shows the ready runtime state in the top bar", async () => {
    const transport = createTransport(readyStatus(), () =>
      Promise.resolve(readyStatus()),
    );

    renderShell(transport);

    await waitFor(() => {
      expect(screen.getByText("运行时就绪")).toBeInTheDocument();
    });
  });

  it("records the ready signal only for the current generation", async () => {
    const transport = createTransport(readyStatus(), () =>
      Promise.resolve(readyStatus()),
    );
    renderShell(transport);
    await waitFor(() => {
      expect(useRuntimeStore.getState().status?.state).toBe("ready");
    });

    transport.emit({
      generation: 1,
      messageType: "system.ready",
      eventId: "3c2b1a09-8f7e-4d6c-b5a4-938271605af0",
      sequence: 1,
      payload: { state: "ready" },
    });

    await waitFor(() => {
      expect(useRuntimeStore.getState().readySignalReceived).toBe(true);
    });

    // A stale event from a previous generation must not be applied.
    transport.emit({
      generation: 0,
      messageType: "system.healthChanged",
      eventId: "aa11bb22-cc33-4d44-8e55-ff6677889900",
      sequence: 99,
      payload: { state: "degraded" },
    });

    expect(useRuntimeStore.getState().status?.state).toBe("ready");
  });

  it("explains an incompatible runtime and offers no restart action", async () => {
    const failed = readyStatus({
      state: "failed",
      lastError: {
        code: "PROTOCOL_INCOMPATIBLE",
        messageKey: "runtime.error.protocolIncompatible",
        parameters: {},
        technicalDetail:
          "The runtime reported an unsupported protocol version.",
        retryability: "never",
      },
    });
    const transport = createTransport(failed, () => Promise.resolve(failed));

    renderShell(transport);

    const notice = await screen.findByRole("alert");
    expect(within(notice).getByText("运行时版本不兼容")).toBeInTheDocument();
    expect(
      within(notice).getByText("PROTOCOL_INCOMPATIBLE"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重启运行时" }),
    ).not.toBeInTheDocument();
  });

  it("offers a restart for a recoverable startup failure", async () => {
    const user = userEvent.setup();
    const failed = readyStatus({
      state: "failed",
      lastError: {
        code: "SIDECAR_UNAVAILABLE",
        messageKey: "runtime.error.sidecarUnavailable",
        parameters: {},
        technicalDetail: "The runtime process exited.",
        retryability: "safe",
      },
    });
    const transport = createTransport(failed, () => Promise.resolve(failed));

    renderShell(transport);
    const notice = await screen.findByRole("alert");
    expect(within(notice).getByText("运行时启动失败")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重启运行时" }));

    await waitFor(() => {
      expect(transport.restartCalls()).toBe(1);
    });
  });

  it("reports a start failure as a persistent problem", async () => {
    const transport = createTransport(readyStatus({ state: "stopped" }), () =>
      Promise.reject(
        new RuntimeCommandError({
          code: "SIDECAR_UNAVAILABLE",
          messageKey: "runtime.error.sidecarUnavailable",
          parameters: {},
          technicalDetail: "The runtime executable was not found.",
          retryability: "safe",
        }),
      ),
    );

    renderShell(transport);

    await waitFor(() => {
      expect(useDiagnosticStore.getState().problems[0]?.code).toBe(
        "RUNTIME_START_FAILED",
      );
    });
  });

  it("explains that a browser preview cannot host the runtime", async () => {
    render(
      <LocaleProvider>
        <ThemeProvider>
          <TooltipProvider>
            <RuntimeProvider>
              <ApplicationFrame />
            </RuntimeProvider>
          </TooltipProvider>
        </ThemeProvider>
      </LocaleProvider>,
    );

    const notice = await screen.findByRole("alert");
    expect(screen.getByText("运行时不可用")).toBeInTheDocument();
    expect(within(notice).getByText("当前环境无法运行图")).toBeInTheDocument();
  });

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "writes terminal persistent updates for %s runs",
    async (state) => {
      const documentId = "62000000-0000-4000-8000-000000000101";
      const graphId = "62000000-0000-4000-8000-000000000102";
      const runId = "62000000-0000-4000-8000-000000000103";
      const variableId = "62000000-0000-4000-8000-000000000104";
      const transport = createTransport(readyStatus(), () =>
        Promise.resolve(readyStatus()),
      );
      openPersistentDocument(documentId, graphId, variableId);
      renderShell(transport);
      await waitFor(() => {
        expect(useRuntimeStore.getState().status?.state).toBe("ready");
      });

      useApplicationDataStore.setState({
        installationCode: "RINO2026",
        persistentVariablesByDocument: {
          [documentId]: [{ variableId, valueKind: "number", value: 1 }],
        },
      });
      expect(
        registerPersistentVariableRun({
          runId,
          documentId,
          graphId,
          generation: 1,
          variables: [{ variableId, valueKind: "number" }],
        }),
      ).toBe(true);

      transport.emit({
        generation: 1,
        messageType: "run.stateChanged",
        eventId: "62000000-0000-4000-8000-000000000105",
        sequence: 1,
        runId,
        payload: {
          state,
          graphId,
          persistentVariableUpdates: [
            { variableId, valueKind: "number", value: 9 },
          ],
        },
      });

      await waitFor(() => {
        expect(
          useApplicationDataStore.getState().persistentVariablesByDocument[
            documentId
          ],
        ).toEqual([{ variableId, valueKind: "number", value: 9 }]);
      });
    },
  );

  it("does not apply running or cancelling events and rejects invalid updates", async () => {
    const documentId = "62000000-0000-4000-8000-000000000201";
    const graphId = "62000000-0000-4000-8000-000000000202";
    const runId = "62000000-0000-4000-8000-000000000203";
    const variableId = "62000000-0000-4000-8000-000000000204";
    const transport = createTransport(readyStatus(), () =>
      Promise.resolve(readyStatus()),
    );
    openPersistentDocument(documentId, graphId, variableId);
    renderShell(transport);
    await waitFor(() => {
      expect(useRuntimeStore.getState().status?.state).toBe("ready");
    });
    useApplicationDataStore.setState({
      installationCode: "RINO2026",
      persistentVariablesByDocument: {
        [documentId]: [{ variableId, valueKind: "number", value: 1 }],
      },
    });
    expect(
      registerPersistentVariableRun({
        runId,
        documentId,
        graphId,
        generation: 1,
        variables: [{ variableId, valueKind: "number" }],
      }),
    ).toBe(true);
    transport.emit({
      generation: 1,
      messageType: "run.stateChanged",
      eventId: "62000000-0000-4000-8000-000000000205",
      sequence: 1,
      runId,
      payload: { state: "running", graphId, persistentVariableUpdates: [] },
    });
    expect(
      useApplicationDataStore.getState().persistentVariablesByDocument[
        documentId
      ],
    ).toEqual([{ variableId, valueKind: "number", value: 1 }]);

    transport.emit({
      generation: 1,
      messageType: "run.stateChanged",
      eventId: "62000000-0000-4000-8000-000000000206",
      sequence: 2,
      runId,
      payload: { state: "cancelling", graphId, persistentVariableUpdates: [] },
    });
    expect(
      useApplicationDataStore.getState().persistentVariablesByDocument[
        documentId
      ],
    ).toEqual([{ variableId, valueKind: "number", value: 1 }]);
    expect(currentPersistentVariableRun()).toMatchObject({ runId });

    transport.emit({
      generation: 1,
      messageType: "run.stateChanged",
      eventId: "62000000-0000-4000-8000-000000000207",
      sequence: 3,
      runId,
      payload: {
        state: "succeeded",
        graphId,
        persistentVariableUpdates: [
          { variableId, valueKind: "number", value: 8 },
        ],
      },
    });
    await waitFor(() => {
      expect(
        useApplicationDataStore.getState().persistentVariablesByDocument[
          documentId
        ],
      ).toEqual([{ variableId, valueKind: "number", value: 8 }]);
    });

    expect(
      registerPersistentVariableRun({
        runId,
        documentId,
        graphId,
        generation: 1,
        variables: [{ variableId, valueKind: "number" }],
      }),
    ).toBe(true);
    expect(
      useApplicationDataStore.getState().persistentVariablesByDocument[
        documentId
      ],
    ).toEqual([{ variableId, valueKind: "number", value: 8 }]);
    transport.emit({
      generation: 1,
      messageType: "run.stateChanged",
      eventId: "62000000-0000-4000-8000-000000000208",
      sequence: 4,
      runId,
      payload: {
        state: "succeeded",
        graphId,
        persistentVariableUpdates: [
          { variableId, valueKind: "string", value: "wrong" },
        ],
      },
    });
    await waitFor(() => {
      expect(useDiagnosticStore.getState().problems[0]?.code).toBe(
        "PERSISTENT_VARIABLE_UPDATE_REJECTED",
      );
    });
    expect(
      useApplicationDataStore.getState().persistentVariablesByDocument[
        documentId
      ],
    ).toEqual([{ variableId, valueKind: "number", value: 8 }]);
  });

  it("consumes a terminal event without updates while keeping the previous value", async () => {
    const documentId = "62000000-0000-4000-8000-000000000301";
    const graphId = "62000000-0000-4000-8000-000000000302";
    const runId = "62000000-0000-4000-8000-000000000303";
    const variableId = "62000000-0000-4000-8000-000000000304";
    const transport = createTransport(readyStatus(), () =>
      Promise.resolve(readyStatus()),
    );
    openPersistentDocument(documentId, graphId, variableId);
    renderShell(transport);
    await waitFor(() => {
      expect(useRuntimeStore.getState().status?.state).toBe("ready");
    });
    useApplicationDataStore.setState({
      installationCode: "RINO2026",
      persistentVariablesByDocument: {
        [documentId]: [{ variableId, valueKind: "number", value: 4 }],
      },
    });
    expect(
      registerPersistentVariableRun({
        runId,
        documentId,
        graphId,
        generation: 1,
        variables: [{ variableId, valueKind: "number" }],
      }),
    ).toBe(true);

    transport.emit({
      generation: 1,
      messageType: "run.stateChanged",
      eventId: "62000000-0000-4000-8000-000000000305",
      sequence: 1,
      runId,
      payload: { state: "succeeded", graphId },
    });

    await waitFor(() => {
      expect(currentPersistentVariableRun()).toBeUndefined();
    });
    expect(
      useApplicationDataStore.getState().persistentVariablesByDocument[
        documentId
      ],
    ).toEqual([{ variableId, valueKind: "number", value: 4 }]);
  });

  it("keeps a memory update and reports a warning when local storage fails", async () => {
    const documentId = "62000000-0000-4000-8000-000000000401";
    const graphId = "62000000-0000-4000-8000-000000000402";
    const runId = "62000000-0000-4000-8000-000000000403";
    const variableId = "62000000-0000-4000-8000-000000000404";
    const transport = createTransport(readyStatus(), () =>
      Promise.resolve(readyStatus()),
    );
    openPersistentDocument(documentId, graphId, variableId);
    renderShell(transport);
    await waitFor(() => {
      expect(useRuntimeStore.getState().status?.state).toBe("ready");
    });
    useApplicationDataStore.setState({
      installationCode: "RINO2026",
      persistentVariablesByDocument: {
        [documentId]: [{ variableId, valueKind: "number", value: 2 }],
      },
      storageStatus: "stored",
    });
    expect(
      registerPersistentVariableRun({
        runId,
        documentId,
        graphId,
        generation: 1,
        variables: [{ variableId, valueKind: "number" }],
      }),
    ).toBe(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });

    transport.emit({
      generation: 1,
      messageType: "run.stateChanged",
      eventId: "62000000-0000-4000-8000-000000000405",
      sequence: 1,
      runId,
      payload: {
        state: "succeeded",
        graphId,
        persistentVariableUpdates: [
          { variableId, valueKind: "number", value: 11 },
        ],
      },
    });

    await waitFor(() => {
      expect(
        useApplicationDataStore.getState().persistentVariablesByDocument[
          documentId
        ],
      ).toEqual([{ variableId, valueKind: "number", value: 11 }]);
      expect(useApplicationDataStore.getState().storageStatus).toBe(
        "memoryOnly",
      );
      expect(useDiagnosticStore.getState().problems[0]?.code).toBe(
        "PERSISTENT_VARIABLE_STORAGE_MEMORY_ONLY",
      );
    });
  });

  it("clears the run context on a new generation so a late terminal event cannot write", async () => {
    const documentId = "62000000-0000-4000-8000-000000000501";
    const graphId = "62000000-0000-4000-8000-000000000502";
    const runId = "62000000-0000-4000-8000-000000000503";
    const variableId = "62000000-0000-4000-8000-000000000504";
    const transport = createTransport(readyStatus(), () =>
      Promise.resolve(readyStatus()),
    );
    openPersistentDocument(documentId, graphId, variableId);
    renderShell(transport);
    await waitFor(() => {
      expect(useRuntimeStore.getState().status?.state).toBe("ready");
    });
    useApplicationDataStore.setState({
      installationCode: "RINO2026",
      persistentVariablesByDocument: {
        [documentId]: [{ variableId, valueKind: "number", value: 3 }],
      },
    });
    expect(
      registerPersistentVariableRun({
        runId,
        documentId,
        graphId,
        generation: 1,
        variables: [{ variableId, valueKind: "number" }],
      }),
    ).toBe(true);

    transport.emit({
      generation: 2,
      messageType: "system.healthChanged",
      eventId: "62000000-0000-4000-8000-000000000505",
      sequence: 1,
      payload: { state: "ok" },
    });
    expect(currentPersistentVariableRun()).toBeUndefined();
    transport.emit({
      generation: 2,
      messageType: "run.stateChanged",
      eventId: "62000000-0000-4000-8000-000000000506",
      sequence: 2,
      runId,
      payload: {
        state: "succeeded",
        graphId,
        persistentVariableUpdates: [
          { variableId, valueKind: "number", value: 99 },
        ],
      },
    });

    expect(
      useApplicationDataStore.getState().persistentVariablesByDocument[
        documentId
      ],
    ).toEqual([{ variableId, valueKind: "number", value: 3 }]);
  });
});
