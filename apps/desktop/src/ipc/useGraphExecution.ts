import { useCallback } from "react";

import { reportProblem } from "../diagnostics/diagnostic-store";
import {
  useRegistryRuntimeGeneration,
  useRegistrySource,
} from "../graph/registry/registry-store";
import {
  useActiveDocument,
  useDocumentStore,
} from "../graph/store/document-store";
import { useEditorSessionStore } from "../graph/store/editor-session-store";
import { variablesForGraph } from "../graph/variables/variable-authoring";
import { RuntimeCommandError } from "./runtime-client";
import { registerPersistentVariableRun } from "./persistent-variable-run-context";
import { useApplicationDataStore } from "../preferences/application-data-store";
import {
  isGraphRunActive,
  useRuntimeExecutionStore,
} from "./runtime-execution-store";
import { acceptsRequests } from "./runtime-contract";
import { useRuntimeStore } from "./runtime-store";
import { useRuntime } from "./useRuntime";

function reportRunRequestFailure(cause: unknown): void {
  const code =
    cause instanceof RuntimeCommandError
      ? cause.error.code
      : "GRAPH_RUN_REQUEST_FAILED";
  reportProblem({
    severity: "error",
    source: "runtime",
    titleKey: "runtime.problems.runRequestFailed.title",
    descriptionKey: "runtime.problems.runRequestFailed.description",
    code,
  });
}

function reportGraphNotExecutable(report: Record<string, unknown>): void {
  const diagnostics = report["diagnostics"];
  reportProblem({
    severity: "error",
    source: "runtime",
    titleKey: "runtime.problems.graphNotExecutable.title",
    descriptionKey: "runtime.problems.graphNotExecutable.description",
    parameters: { count: Array.isArray(diagnostics) ? diagnostics.length : 0 },
    code: "GRAPH_NOT_EXECUTABLE",
  });
}

export function useGraphExecution() {
  const runtime = useRuntime();
  const document = useActiveDocument();
  const activeGraphId = useEditorSessionStore((state) => state.activeGraphId);
  const runtimeState = useRuntimeStore((state) => state.status?.state);
  const runtimeGeneration = useRuntimeStore(
    (state) => state.status?.generation,
  );
  const registrySource = useRegistrySource();
  const registryGeneration = useRegistryRuntimeGeneration();
  const run = useRuntimeExecutionStore((state) => state.run);
  const beginRun = useRuntimeExecutionStore((state) => state.beginRun);
  const acceptRun = useRuntimeExecutionStore((state) => state.acceptRun);
  const failToStart = useRuntimeExecutionStore((state) => state.failToStart);
  const setExecutionLocked = useDocumentStore(
    (state) => state.setExecutionLocked,
  );
  const runId = run?.runId;
  const runState = run?.state;

  const runGraph = useCallback(async () => {
    if (
      document === undefined ||
      activeGraphId === undefined ||
      runtimeState === undefined ||
      !acceptsRequests(runtimeState) ||
      registrySource !== "runtime" ||
      registryGeneration !== runtimeGeneration ||
      runtimeGeneration === undefined ||
      isGraphRunActive(runState)
    ) {
      return;
    }
    const activeGraph = document.graphs.find(
      (graph) => graph.graphId === activeGraphId,
    );
    if (activeGraph === undefined) {
      return;
    }
    const runGeneration = runtimeGeneration;
    beginRun(activeGraphId, runGeneration);
    setExecutionLocked(true);
    try {
      const validation = await runtime.request("graphValidate", { document });
      if (
        useRuntimeStore.getState().status?.generation !== runGeneration ||
        useRuntimeExecutionStore.getState().run?.generation !== runGeneration
      ) {
        return;
      }
      if (!validation.executable) {
        if (failToStart(runGeneration)) {
          setExecutionLocked(false);
          reportGraphNotExecutable(validation.report);
        }
        return;
      }
      const projectVariables = variablesForGraph(document, activeGraphId);
      const initialPersistentVariables = useApplicationDataStore
        .getState()
        .readPersistentVariableInitialValues(
          document.documentId,
          document,
          activeGraphId,
        );
      const runStartPayload = {
        document,
        graphId: activeGraphId,
        ...(initialPersistentVariables.length > 0
          ? { initialPersistentVariables }
          : {}),
      };
      const result = await runtime.request("runStart", runStartPayload);
      if (
        useRuntimeStore.getState().status?.generation !== runGeneration ||
        useRuntimeExecutionStore.getState().run?.generation !== runGeneration
      ) {
        if (failToStart(runGeneration)) {
          setExecutionLocked(false);
        }
        return;
      }
      if (!acceptRun(result, runGeneration)) {
        if (failToStart(runGeneration)) {
          setExecutionLocked(false);
        }
        return;
      }
      const registered = registerPersistentVariableRun({
        runId: result.runId,
        documentId: document.documentId,
        graphId: result.graphId,
        generation: runGeneration,
        variables: projectVariables.flatMap((variable) =>
          !variable.persistent || variable.valueKind === "imageRef"
            ? []
            : [
                {
                  variableId: variable.variableId,
                  valueKind: variable.valueKind,
                },
              ],
        ),
      });
      if (!registered) {
        reportProblem({
          severity: "error",
          source: "runtime",
          titleKey: "runtime.problems.persistentVariableContextFailed.title",
          descriptionKey:
            "runtime.problems.persistentVariableContextFailed.description",
          code: "PERSISTENT_VARIABLE_CONTEXT_FAILED",
        });
      }
    } catch (cause: unknown) {
      if (failToStart(runGeneration)) {
        setExecutionLocked(false);
        reportRunRequestFailure(cause);
      }
    }
  }, [
    acceptRun,
    activeGraphId,
    beginRun,
    document,
    failToStart,
    registryGeneration,
    registrySource,
    runState,
    runtime,
    runtimeGeneration,
    runtimeState,
    setExecutionLocked,
  ]);

  const cancelRun = useCallback(async () => {
    if (!isGraphRunActive(runState) || runId === undefined) {
      return;
    }
    try {
      await runtime.request("runCancel", { runId });
    } catch (cause: unknown) {
      reportRunRequestFailure(cause);
    }
  }, [runId, runState, runtime]);

  return {
    run,
    runGraph,
    cancelRun,
    canRun:
      document !== undefined &&
      activeGraphId !== undefined &&
      runtimeState !== undefined &&
      acceptsRequests(runtimeState) &&
      registrySource === "runtime" &&
      registryGeneration === runtimeGeneration &&
      !isGraphRunActive(runState),
    canCancel: isGraphRunActive(runState) && runId !== undefined,
  };
}
