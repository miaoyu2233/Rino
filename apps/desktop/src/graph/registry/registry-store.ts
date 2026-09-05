import type { RinoNodeRegistrySnapshotV1 } from "@rino/contracts";
import { create } from "zustand";

/** Where the active node registry came from.
 *
 * The editor must be able to state this plainly: a graph authored against development
 * definitions is not the same as one authored against the definitions the runtime will
 * actually execute, and the interface has to be able to say so.
 */
export type RegistrySource = "development" | "runtime";

/** The first registry request outcome used by the desktop startup gate. */
export type RegistryInitializationState = "pending" | "succeeded" | "failed";

interface RegistryStoreState {
  initializationState: RegistryInitializationState;
  snapshot: RinoNodeRegistrySnapshotV1 | undefined;
  source: RegistrySource | undefined;
  runtimeGeneration: number | undefined;
  setInitializationState: (state: RegistryInitializationState) => void;
  installSnapshot: (
    snapshot: RinoNodeRegistrySnapshotV1,
    source: RegistrySource,
    runtimeGeneration?: number,
  ) => void;
  clearSnapshot: () => void;
  clearRuntimeSnapshot: () => void;
}

export const useRegistryStore = create<RegistryStoreState>((set) => ({
  initializationState: "pending",
  snapshot: undefined,
  source: undefined,
  runtimeGeneration: undefined,
  setInitializationState: (initializationState) => {
    set({ initializationState });
  },
  installSnapshot: (snapshot, source, runtimeGeneration) => {
    if (source === "runtime" && runtimeGeneration === undefined) {
      throw new TypeError(
        "A runtime registry requires its Sidecar generation.",
      );
    }
    if (source === "development" && runtimeGeneration !== undefined) {
      throw new TypeError(
        "A development registry cannot have a runtime generation.",
      );
    }
    set({ snapshot, source, runtimeGeneration });
  },
  clearSnapshot: () => {
    set({
      initializationState: "pending",
      snapshot: undefined,
      source: undefined,
      runtimeGeneration: undefined,
    });
  },
  clearRuntimeSnapshot: () => {
    set((state) =>
      state.source === "runtime"
        ? {
            snapshot: undefined,
            source: undefined,
            runtimeGeneration: undefined,
          }
        : state,
    );
  },
}));

export function useNodeRegistry(): RinoNodeRegistrySnapshotV1 | undefined {
  return useRegistryStore((store) => store.snapshot);
}

export function useRegistrySource(): RegistrySource | undefined {
  return useRegistryStore((store) => store.source);
}

export function useRegistryRuntimeGeneration(): number | undefined {
  return useRegistryStore((store) => store.runtimeGeneration);
}
