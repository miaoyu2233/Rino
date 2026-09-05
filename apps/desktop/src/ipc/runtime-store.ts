import { create } from "zustand";

import type { RuntimeState, RuntimeStatus } from "./runtime-contract";

/** How the desktop shell's runtime host is reachable from the interface. */
export type RuntimeAvailability = "unknown" | "available" | "unavailable";

/** The first runtime initialization outcome used by the desktop startup gate. */
export type RuntimeInitializationState =
  "pending" | "ready" | "degraded" | "failed" | "unavailable";

interface RuntimeStoreState {
  availability: RuntimeAvailability;
  initializationState: RuntimeInitializationState;
  status: RuntimeStatus | undefined;
  readySignalReceived: boolean;
  setAvailability: (availability: RuntimeAvailability) => void;
  setInitializationState: (state: RuntimeInitializationState) => void;
  setStatus: (status: RuntimeStatus) => void;
  markReadySignal: () => void;
  reset: () => void;
}

export const useRuntimeStore = create<RuntimeStoreState>((set) => ({
  availability: "unknown",
  initializationState: "pending",
  status: undefined,
  readySignalReceived: false,
  setAvailability: (availability) => {
    set({ availability });
  },
  setInitializationState: (initializationState) => {
    set({ initializationState });
  },
  setStatus: (status) => {
    set((state) => ({
      status,
      // A new runtime generation has not signalled readiness yet, so the flag resets
      // rather than carrying the previous instance's readiness forward.
      readySignalReceived:
        state.status?.generation === status.generation
          ? state.readySignalReceived
          : false,
    }));
  },
  markReadySignal: () => {
    set({ readySignalReceived: true });
  },
  reset: () => {
    set({
      availability: "unknown",
      initializationState: "pending",
      status: undefined,
      readySignalReceived: false,
    });
  },
}));

/** Narrow selector for the lifecycle state alone. */
export function useRuntimeState(): RuntimeState | undefined {
  return useRuntimeStore((store) => store.status?.state);
}

/** Narrow selector for runtime availability alone. */
export function useRuntimeAvailability(): RuntimeAvailability {
  return useRuntimeStore((store) => store.availability);
}
