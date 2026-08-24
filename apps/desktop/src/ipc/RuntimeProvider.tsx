import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { reportProblem } from "../diagnostics/diagnostic-store";
import { useDocumentStore } from "../graph/store/document-store";
import { useApplicationDataStore } from "../preferences/application-data-store";
import {
  cancelUiAnimationFrame,
  requestUiAnimationFrame,
} from "../preferences/ui-animation-frame-scheduler";
import { RuntimeClient } from "./runtime-client";
import { RuntimeContext, type RuntimeContextValue } from "./runtime-context";
import {
  consumePersistentVariableRun,
  resetPersistentVariableRunContext,
} from "./persistent-variable-run-context";
import {
  isExecutionPresentationEvent,
  isGraphRunTerminal,
  useRuntimeExecutionStore,
} from "./runtime-execution-store";
import { RuntimeEventFrameBuffer } from "./runtime-event-frame-buffer";
import { useRuntimeStore } from "./runtime-store";
import {
  createDesktopRuntimeTransport,
  isDesktopRuntimeAvailable,
  type RuntimeTransport,
} from "./runtime-transport";
import type { RuntimeEvent } from "./runtime-contract";

export interface RuntimeProviderProps {
  children: ReactNode;
  /** Supplied by tests to exercise the real client against a substitutable boundary. */
  transport?: RuntimeTransport;
  /** Starting the runtime automatically is the product behavior; tests opt out. */
  startAutomatically?: boolean;
}

function reportPersistentVariableUpdateRejected(): void {
  reportProblem({
    severity: "error",
    source: "runtime",
    titleKey: "runtime.problems.persistentVariableUpdateRejected.title",
    descriptionKey:
      "runtime.problems.persistentVariableUpdateRejected.description",
    code: "PERSISTENT_VARIABLE_UPDATE_REJECTED",
  });
}

function applyPersistentVariableTerminalEvent(event: RuntimeEvent): void {
  const result = consumePersistentVariableRun(
    event.runId,
    typeof event.payload["graphId"] === "string"
      ? event.payload["graphId"]
      : undefined,
    event.generation,
  );
  if (result.status === "ignored") {
    return;
  }
  if (result.status === "invalid") {
    reportPersistentVariableUpdateRejected();
    return;
  }
  const updates = event.payload["persistentVariableUpdates"];
  if (updates === undefined) {
    return;
  }
  if (!Array.isArray(updates)) {
    reportPersistentVariableUpdateRejected();
    return;
  }
  const document = useDocumentStore.getState().history?.document;
  if (
    document === undefined ||
    document.documentId !== result.registration.documentId
  ) {
    reportPersistentVariableUpdateRejected();
    return;
  }
  const mutation = useApplicationDataStore
    .getState()
    .mergePersistentVariableUpdates(
      result.registration.documentId,
      document,
      updates,
      result.registration.graphId,
    );
  if (!mutation.ok) {
    reportPersistentVariableUpdateRejected();
    return;
  }
  if (mutation.storageStatus === "memoryOnly") {
    reportProblem({
      severity: "warning",
      source: "runtime",
      titleKey: "runtime.problems.persistentVariableStorageTemporary.title",
      descriptionKey:
        "runtime.problems.persistentVariableStorageTemporary.description",
      code: "PERSISTENT_VARIABLE_STORAGE_MEMORY_ONLY",
    });
  }
}

/** Connects the interface to the runtime host and keeps the runtime store current. */
export function RuntimeProvider({
  children,
  transport,
  startAutomatically = true,
}: RuntimeProviderProps) {
  const clientRef = useRef<RuntimeClient | null>(null);
  const setAvailability = useRuntimeStore((store) => store.setAvailability);
  const setStatus = useRuntimeStore((store) => store.setStatus);
  const markReadySignal = useRuntimeStore((store) => store.markReadySignal);
  const reset = useRuntimeStore((store) => store.reset);
  const resetExecution = useRuntimeExecutionStore((store) => store.reset);

  useEffect(() => {
    const resolvedTransport =
      transport ??
      (isDesktopRuntimeAvailable() ? createDesktopRuntimeTransport() : null);

    if (!resolvedTransport) {
      // Outside the desktop shell there is no runtime host. This is reported rather than
      // retried, because a browser preview is a development convenience, not a product
      // surface that can host the runtime.
      setAvailability("unavailable");
      resetPersistentVariableRunContext();
      return;
    }

    resetPersistentVariableRunContext();
    setAvailability("available");
    const executionEventBuffer = new RuntimeEventFrameBuffer(
      (events) => {
        useRuntimeExecutionStore.getState().applyEvents(events);
      },
      {
        request: requestUiAnimationFrame,
        cancel: cancelUiAnimationFrame,
      },
    );
    const client = new RuntimeClient(resolvedTransport, {
      onStatus: (status) => {
        const previousGeneration =
          useRuntimeStore.getState().status?.generation;
        if (
          status.state === "stopped" ||
          status.state === "stopping" ||
          status.state === "restarting"
        ) {
          resetPersistentVariableRunContext();
        }
        if (
          previousGeneration !== undefined &&
          previousGeneration !== status.generation
        ) {
          executionEventBuffer.clear();
          resetExecution();
          resetPersistentVariableRunContext();
          useDocumentStore.getState().setExecutionLocked(false);
        }
        setStatus(status);
      },
      onEvent: (event) => {
        const currentGeneration = useRuntimeStore.getState().status?.generation;
        if (
          currentGeneration !== undefined &&
          currentGeneration !== event.generation
        ) {
          resetPersistentVariableRunContext();
        }
        if (event.messageType === "system.ready") {
          markReadySignal();
        }
        const terminalRunEvent =
          event.messageType === "run.stateChanged" &&
          typeof event.payload["state"] === "string" &&
          isGraphRunTerminal(event.payload["state"]);
        if (isExecutionPresentationEvent(event)) {
          executionEventBuffer.enqueue(event, terminalRunEvent);
        }
        if (terminalRunEvent) {
          applyPersistentVariableTerminalEvent(event);
          useDocumentStore.getState().setExecutionLocked(false);
          if (event.payload["state"] === "failed") {
            const terminalError = event.payload["terminalError"];
            reportProblem({
              severity: "error",
              source: "runtime",
              titleKey: "runtime.problems.runFailed.title",
              descriptionKey: "runtime.problems.runFailed.description",
              code:
                typeof terminalError === "object" &&
                terminalError !== null &&
                "code" in terminalError &&
                typeof terminalError.code === "string"
                  ? terminalError.code
                  : "GRAPH_RUN_FAILED",
            });
          }
        }
      },
      onDiagnostic: () => {
        // Runtime diagnostics are already redacted and bounded by the runtime. They are
        // surfaced through the Logs panel in a later task rather than raised as problems.
      },
    });
    clientRef.current = client;

    void client
      .connect()
      .then(async () => (startAutomatically ? client.start() : undefined))
      .catch(() => {
        reportProblem({
          severity: "error",
          source: "runtime",
          titleKey: "runtime.problems.startFailed.title",
          descriptionKey: "runtime.problems.startFailed.description",
          code: "RUNTIME_START_FAILED",
        });
      });

    return () => {
      client.dispose();
      executionEventBuffer.dispose();
      clientRef.current = null;
      resetExecution();
      resetPersistentVariableRunContext();
      useDocumentStore.getState().setExecutionLocked(false);
      reset();
    };
  }, [
    markReadySignal,
    reset,
    resetExecution,
    setAvailability,
    setStatus,
    startAutomatically,
    transport,
  ]);

  const value = useMemo<RuntimeContextValue>(
    () => ({
      start: async () => {
        const client = clientRef.current;
        if (!client) {
          throw new Error("The runtime client is not connected.");
        }
        return client.start();
      },
      restart: async () => {
        const client = clientRef.current;
        if (!client) {
          throw new Error("The runtime client is not connected.");
        }
        return client.restart();
      },
      shutdown: async () => {
        const client = clientRef.current;
        if (!client) {
          throw new Error("The runtime client is not connected.");
        }
        return client.shutdown();
      },
      readPreview: async (previewToken) => {
        const client = clientRef.current;
        if (!client) {
          throw new Error("The runtime client is not connected.");
        }
        return client.readPreview(previewToken);
      },
      readCapture: async (captureToken) => {
        const client = clientRef.current;
        if (!client) {
          throw new Error("The runtime client is not connected.");
        }
        return client.readCapture(captureToken);
      },
      request: async (request, payload) => {
        const client = clientRef.current;
        if (!client) {
          throw new Error("The runtime client is not connected.");
        }
        return client.request(request, payload);
      },
    }),
    [],
  );

  return (
    <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
  );
}
