import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagnosticStore } from "../diagnostics/diagnostic-store";
import { createEmptyProject } from "../graph/project-factory";
import { developmentRegistrySnapshot } from "../graph/registry/development-registry";
import { useRegistryStore } from "../graph/registry/registry-store";
import { useDocumentStore } from "../graph/store/document-store";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../graph/store/project-lifecycle";
import { useEditorSessionStore } from "../graph/store/editor-session-store";
import { useApplicationDataStore } from "../preferences/application-data-store";
import { RuntimeContext, type RuntimeContextValue } from "./runtime-context";
import {
  currentPersistentVariableRun,
  resetPersistentVariableRunContext,
} from "./persistent-variable-run-context";
import { useRuntimeExecutionStore } from "./runtime-execution-store";
import { useRuntimeStore } from "./runtime-store";
import { useGraphExecution } from "./useGraphExecution";

const REGISTRY_VERSION = "a".repeat(64);
const SECOND_GRAPH_ID = "62000000-0000-4000-8000-0000000000aa";

function identifierFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `62000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
  };
}

function requestDouble(
  implementation: (request: string) => Promise<unknown>,
): RuntimeContextValue["request"] {
  return vi.fn(implementation) as unknown as RuntimeContextValue["request"];
}

function context(request: RuntimeContextValue["request"]): RuntimeContextValue {
  const status = useRuntimeStore.getState().status;
  if (status === undefined) {
    throw new Error("The test runtime status is not initialized.");
  }
  return {
    start: () => Promise.resolve(status),
    restart: () => Promise.resolve(status),
    shutdown: () => Promise.resolve({ ...status, state: "stopped" }),
    readPreview: () => Promise.resolve(new Uint8Array()),
    readCapture: () => Promise.resolve(new Uint8Array()),
    request,
  };
}

function RunHarness() {
  const execution = useGraphExecution();
  return (
    <button
      type="button"
      disabled={!execution.canRun}
      onClick={() => void execution.runGraph()}
    >
      Run
    </button>
  );
}

function renderHarness(request: RuntimeContextValue["request"]) {
  return render(
    <RuntimeContext.Provider value={context(request)}>
      <RunHarness />
    </RuntimeContext.Provider>,
  );
}

beforeEach(() => {
  closeProjectDocument();
  useRuntimeExecutionStore.getState().reset();
  resetPersistentVariableRunContext();
  useDiagnosticStore.setState({ problems: [], notifications: [] });
  useRuntimeStore.setState({
    availability: "available",
    status: {
      state: "ready",
      generation: 1,
      automaticRestarts: 0,
      protocolVersion: 1,
      maximumFrameBytes: 1_048_576,
    },
    readySignalReceived: true,
  });
  useRegistryStore
    .getState()
    .installSnapshot(developmentRegistrySnapshot(), "runtime", 1);
  openProjectDocument(
    createEmptyProject({
      name: "Runtime validation",
      entryGraphName: "Main",
      createdAt: "2026-07-27T00:00:00Z",
      createIdentifier: identifierFactory(),
    }),
  );
  useApplicationDataStore.setState({
    installationCode: "RINO2026",
    assetNameOrdinals: {},
    persistentVariablesByDocument: {},
    storageStatus: "stored",
  });
});

describe("useGraphExecution", () => {
  it("validates the frozen document before starting a run", async () => {
    const user = userEvent.setup();
    const project = useDocumentStore.getState().history?.document;
    if (project === undefined) {
      throw new Error("Expected an open test project.");
    }
    const request = requestDouble((requestName) => {
      if (requestName === "graphValidate") {
        return Promise.resolve({
          executable: true,
          report: { diagnostics: [] },
        });
      }
      if (requestName === "runStart") {
        return Promise.resolve({
          accepted: true,
          runId: "62000000-0000-4000-8000-000000000099",
          graphId: project.entryGraphId,
          registryVersion: REGISTRY_VERSION,
        });
      }
      throw new Error(`Unexpected request: ${requestName}`);
    });
    renderHarness(request);

    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(useRuntimeExecutionStore.getState().run).toMatchObject({
        state: "running",
        graphId: project.entryGraphId,
      });
    });
    expect(request).toHaveBeenNthCalledWith(1, "graphValidate", {
      document: project,
    });
    expect(request).toHaveBeenNthCalledWith(2, "runStart", {
      document: project,
      graphId: project.entryGraphId,
    });
    expect(useDocumentStore.getState().executionLocked).toBe(true);
  });

  it("starts the currently active task rather than the persisted default", async () => {
    const user = userEvent.setup();
    const project = useDocumentStore.getState().history?.document;
    if (project === undefined) {
      throw new Error("Expected an open test project.");
    }
    const multiTaskProject = {
      ...project,
      graphs: [
        ...project.graphs,
        {
          graphId: SECOND_GRAPH_ID,
          name: "刷金币",
          kind: "entry" as const,
          nodes: [],
          edges: [],
        },
      ],
    };
    openProjectDocument(multiTaskProject);
    useEditorSessionStore.getState().setActiveGraph(SECOND_GRAPH_ID);

    const request = requestDouble((requestName) => {
      if (requestName === "graphValidate") {
        return Promise.resolve({
          executable: true,
          report: { diagnostics: [] },
        });
      }
      if (requestName === "runStart") {
        return Promise.resolve({
          accepted: true,
          runId: "62000000-0000-4000-8000-000000000099",
          graphId: SECOND_GRAPH_ID,
          registryVersion: REGISTRY_VERSION,
        });
      }
      throw new Error(`Unexpected request: ${requestName}`);
    });
    renderHarness(request);

    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(useRuntimeExecutionStore.getState().run).toMatchObject({
        state: "running",
        graphId: SECOND_GRAPH_ID,
      });
    });
    expect(request).toHaveBeenNthCalledWith(2, "runStart", {
      document: multiTaskProject,
      graphId: SECOND_GRAPH_ID,
    });
  });

  it("includes matching persistent initial values and registers the accepted run", async () => {
    const user = userEvent.setup();
    const project = useDocumentStore.getState().history?.document;
    if (project === undefined) {
      throw new Error("Expected an open test project.");
    }
    const variableId = "62000000-0000-4000-8000-0000000000ab";
    const persistentProject = {
      ...project,
      variables: [
        {
          variableId,
          name: "count",
          valueKind: "number" as const,
          persistent: true,
        },
      ],
    };
    openProjectDocument(persistentProject);
    useApplicationDataStore.setState({
      persistentVariablesByDocument: {
        [project.documentId]: [{ variableId, valueKind: "number", value: 7 }],
      },
    });
    const request = requestDouble((requestName) => {
      if (requestName === "graphValidate") {
        return Promise.resolve({
          executable: true,
          report: { diagnostics: [] },
        });
      }
      if (requestName === "runStart") {
        return Promise.resolve({
          accepted: true,
          runId: "62000000-0000-4000-8000-0000000000ac",
          graphId: persistentProject.entryGraphId,
          registryVersion: REGISTRY_VERSION,
        });
      }
      throw new Error(`Unexpected request: ${requestName}`);
    });
    renderHarness(request);

    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(useRuntimeExecutionStore.getState().run?.state).toBe("running");
    });
    expect(request).toHaveBeenNthCalledWith(2, "runStart", {
      document: persistentProject,
      graphId: persistentProject.entryGraphId,
      initialPersistentVariables: [
        { variableId, valueKind: "number", value: 7 },
      ],
    });
    expect(currentPersistentVariableRun()).toMatchObject({
      runId: "62000000-0000-4000-8000-0000000000ac",
      documentId: project.documentId,
      graphId: persistentProject.entryGraphId,
    });
  });

  it("does not register a run accepted after the runtime generation changed", async () => {
    const user = userEvent.setup();
    let resolveRunStart:
      | ((result: {
          accepted: true;
          runId: string;
          graphId: string;
          registryVersion: string;
        }) => void)
      | undefined;
    const runStart = new Promise<{
      accepted: true;
      runId: string;
      graphId: string;
      registryVersion: string;
    }>((resolve) => {
      resolveRunStart = resolve;
    });
    const project = useDocumentStore.getState().history?.document;
    if (project === undefined) {
      throw new Error("Expected an open test project.");
    }
    const request = requestDouble((requestName) => {
      if (requestName === "graphValidate") {
        return Promise.resolve({
          executable: true,
          report: { diagnostics: [] },
        });
      }
      if (requestName === "runStart") {
        return runStart;
      }
      throw new Error(`Unexpected request: ${requestName}`);
    });
    renderHarness(request);
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(2);
    });

    useRuntimeStore.setState({
      status: {
        state: "ready",
        generation: 2,
        automaticRestarts: 0,
        protocolVersion: 1,
        maximumFrameBytes: 1_048_576,
      },
    });
    resolveRunStart?.({
      accepted: true,
      runId: "62000000-0000-4000-8000-0000000000ad",
      graphId: project.entryGraphId,
      registryVersion: REGISTRY_VERSION,
    });

    await waitFor(() => {
      expect(useRuntimeExecutionStore.getState().run).toBeUndefined();
    });
    expect(currentPersistentVariableRun()).toBeUndefined();
    expect(useDocumentStore.getState().executionLocked).toBe(false);
  });

  it("unlocks and reports authoritative validation failures without run.start", async () => {
    const user = userEvent.setup();
    const request = requestDouble(() =>
      Promise.resolve({
        executable: false,
        report: { diagnostics: [{ code: "ENTRY_NODE_MISSING" }] },
      }),
    );
    renderHarness(request);

    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(useDiagnosticStore.getState().problems[0]).toMatchObject({
        code: "GRAPH_NOT_EXECUTABLE",
        parameters: { count: 1 },
      });
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(useRuntimeExecutionStore.getState().run).toBeUndefined();
    expect(useDocumentStore.getState().executionLocked).toBe(false);
  });

  it("disables running when the registry belongs to another generation", () => {
    useRegistryStore
      .getState()
      .installSnapshot(developmentRegistrySnapshot(), "runtime", 2);
    const request = requestDouble(() => Promise.resolve({}));

    renderHarness(request);

    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });
});
