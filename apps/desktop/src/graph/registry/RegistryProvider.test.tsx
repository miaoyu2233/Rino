import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagnosticStore } from "../../diagnostics/diagnostic-store";
import type { RuntimeContextValue } from "../../ipc/runtime-context";
import { RuntimeContext } from "../../ipc/runtime-context";
import { useRuntimeStore } from "../../ipc/runtime-store";
import { developmentRegistrySnapshot } from "./development-registry";
import { useRegistryStore } from "./registry-store";
import { RegistryProvider } from "./RegistryProvider";

function readyStatus(generation: number) {
  return {
    state: "ready" as const,
    generation,
    automaticRestarts: 0,
    protocolVersion: 1,
    maximumFrameBytes: 1_048_576,
    runtimeVersion: "0.1.0",
    runtimeMode: "source",
  };
}

function runtimeContext(
  request: RuntimeContextValue["request"],
): RuntimeContextValue {
  return {
    start: () => Promise.resolve(readyStatus(1)),
    restart: () => Promise.resolve(readyStatus(2)),
    shutdown: () =>
      Promise.resolve({ ...readyStatus(1), state: "stopped" as const }),
    readPreview: () => Promise.resolve(new Uint8Array()),
    readCapture: () => Promise.resolve(new Uint8Array()),
    request,
  };
}

function requestDouble(
  implementation: () => Promise<unknown>,
): RuntimeContextValue["request"] {
  return vi.fn(implementation) as unknown as RuntimeContextValue["request"];
}

function renderRegistryProvider(context: RuntimeContextValue) {
  return render(
    <RuntimeContext.Provider value={context}>
      <RegistryProvider>
        <span>ready</span>
      </RegistryProvider>
    </RuntimeContext.Provider>,
  );
}

beforeEach(() => {
  useRegistryStore.getState().clearSnapshot();
  useRuntimeStore.setState({
    availability: "available",
    status: readyStatus(1),
    readySignalReceived: true,
  });
  useDiagnosticStore.setState({ problems: [], notifications: [] });
});

describe("RegistryProvider", () => {
  it("replaces development definitions with the authoritative generation", async () => {
    const request = requestDouble(() =>
      Promise.resolve({ registry: developmentRegistrySnapshot() }),
    );

    renderRegistryProvider(runtimeContext(request));

    await waitFor(() => {
      expect(useRegistryStore.getState()).toMatchObject({
        source: "runtime",
        runtimeGeneration: 1,
      });
    });
    expect(request).toHaveBeenCalledWith("registryGet", {});
  });

  it("ignores a late registry from an obsolete Sidecar generation", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;
    const request = requestDouble(
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = resolve;
            }),
        ),
    );

    renderRegistryProvider(runtimeContext(request));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    act(() => {
      useRuntimeStore.getState().setStatus(readyStatus(2));
    });
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(2);
    });

    act(() => {
      resolveSecond?.({ registry: developmentRegistrySnapshot() });
    });
    await waitFor(() => {
      expect(useRegistryStore.getState().runtimeGeneration).toBe(2);
    });
    act(() => {
      resolveFirst?.({ registry: developmentRegistrySnapshot() });
    });
    await waitFor(() => {
      expect(useRegistryStore.getState().runtimeGeneration).toBe(2);
    });
  });

  it("keeps test-only development definitions separate after an invalid result", async () => {
    const request = requestDouble(() => Promise.resolve({ registry: {} }));

    renderRegistryProvider(runtimeContext(request));

    await waitFor(() => {
      expect(useDiagnosticStore.getState().problems[0]?.code).toBe(
        "RUNTIME_REGISTRY_LOAD_FAILED",
      );
    });
    expect(useRegistryStore.getState().source).toBe("development");
    expect(useRegistryStore.getState().runtimeGeneration).toBeUndefined();
  });

  it("drops a runtime registry when its Sidecar is no longer request-capable", async () => {
    const request = requestDouble(() =>
      Promise.resolve({ registry: developmentRegistrySnapshot() }),
    );
    renderRegistryProvider(runtimeContext(request));
    await waitFor(() => {
      expect(useRegistryStore.getState().source).toBe("runtime");
    });

    act(() => {
      useRuntimeStore
        .getState()
        .setStatus({ ...readyStatus(1), state: "failed" });
    });

    await waitFor(() => {
      expect(useRegistryStore.getState().source).toBe("development");
    });
  });
});
