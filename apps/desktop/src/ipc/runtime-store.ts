import { create } from "zustand";

import type { RuntimeState, RuntimeStatus } from "./runtime-contract";

/** How the desktop shell's runtime host is reachable from the interface. */
export type RuntimeAvailability = "unknown" | "available" | "unavailable";

interface RuntimeStoreState {
  availability: RuntimeAvailability;
  status: RuntimeStatus | undefined;
  readySignalReceived: boolean;
  setAvailability: (availability: RuntimeAvailability) => void;
  setStatus: (status: RuntimeStatus) => void;
  markReadySignal: () => void;
  reset: () => void;
}

export const useRuntimeStore = create<RuntimeStoreState>((set) => ({
  availability: "unknown",
  status: undefined,
  readySignalReceived: false,
  setAvailability: (availability) => {
    set({ availability });
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
