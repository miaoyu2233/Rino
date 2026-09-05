import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invoke, isTauri } from "@tauri-apps/api/core";

import { useRegistryStore } from "../graph/registry/registry-store";
import { useRuntimeStore } from "../ipc/runtime-store";
import { StartupGate } from "./startup-gate";
import {
  completeStartupWindow,
  STARTUP_COMPLETE_RETRY_DELAY_MS,
  STARTUP_GATE_TIMEOUT_MS,
} from "./startup-gate-runtime";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);

function settleStores(
  runtime: "ready" | "failed" | "unavailable",
  registry: "succeeded" | "failed",
): void {
  useRuntimeStore.getState().setInitializationState(runtime);
  useRegistryStore.getState().setInitializationState(registry);
}

describe("StartupGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(true);
    useRuntimeStore.setState({
      availability: "unknown",
      initializationState: "pending",
      status: undefined,
      readySignalReceived: false,
    });
    useRegistryStore.getState().clearSnapshot();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["ready", "succeeded"],
    ["failed", "failed"],
    ["unavailable", "failed"],
  ] as const)(
    "releases after runtime %s and registry %s",
    async (runtime, registry) => {
      render(
        <StartupGate>
          <div>application</div>
        </StartupGate>,
      );
      act(() => {
        settleStores(runtime, registry);
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(invokeMock).toHaveBeenCalledWith("complete_startup");
    },
  );

  it("releases at the bounded timeout when initialization never settles", () => {
    render(
      <StartupGate>
        <div>application</div>
      </StartupGate>,
    );

    act(() => {
      vi.advanceTimersByTime(STARTUP_GATE_TIMEOUT_MS);
    });

    expect(invokeMock).toHaveBeenCalledWith("complete_startup");
  });

  it("retries one native completion after a transient invoke failure", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("transient failure"))
      .mockResolvedValueOnce(undefined);

    const firstCompletion = completeStartupWindow();
    const secondCompletion = completeStartupWindow();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STARTUP_COMPLETE_RETRY_DELAY_MS);
    });
    await Promise.all([firstCompletion, secondCompletion]);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "complete_startup");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "complete_startup");
  });

  it("skips native completion outside the Tauri shell", async () => {
    isTauriMock.mockReturnValue(false);
    render(
      <StartupGate>
        <div>application</div>
      </StartupGate>,
    );
    act(() => {
      settleStores("ready", "succeeded");
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not complete startup from the device preview window", async () => {
    window.history.replaceState({}, "", "/?window=device-preview");
    render(
      <StartupGate>
        <div>preview</div>
      </StartupGate>,
    );
    act(() => {
      settleStores("ready", "succeeded");
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(invokeMock).not.toHaveBeenCalled();
  });
});
