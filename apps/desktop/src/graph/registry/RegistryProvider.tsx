import { isValidRegistrySnapshot } from "@rino/contracts";
import { useEffect, type ReactNode } from "react";

import { reportProblem } from "../../diagnostics/diagnostic-store";
import { RuntimeCommandError } from "../../ipc/runtime-client";
import { acceptsRequests } from "../../ipc/runtime-contract";
import { useRuntimeStore } from "../../ipc/runtime-store";
import { useRuntime } from "../../ipc/useRuntime";
import { installDevelopmentRegistry } from "./development-registry";
import { useRegistryStore } from "./registry-store";

export interface RegistryProviderProps {
  children: ReactNode;
}

function installDevelopmentRegistryWhenAvailable(): void {
  if (
    import.meta.env.DEV &&
    useRegistryStore.getState().snapshot === undefined
  ) {
    installDevelopmentRegistry();
  }
}

function reportRegistryLoadFailure(cause: unknown): void {
  reportProblem({
    severity: "error",
    source: "runtime",
    titleKey: "runtime.problems.registryLoadFailed.title",
    descriptionKey: "runtime.problems.registryLoadFailed.description",
    code:
      cause instanceof RuntimeCommandError
        ? cause.error.code
        : "RUNTIME_REGISTRY_LOAD_FAILED",
  });
}

/** Loads the authoritative node registry for the current Sidecar generation. */
export function RegistryProvider({ children }: RegistryProviderProps) {
  const runtime = useRuntime();
  const runtimeState = useRuntimeStore((store) => store.status?.state);
  const runtimeGeneration = useRuntimeStore(
    (store) => store.status?.generation,
  );

  useEffect(() => {
    installDevelopmentRegistryWhenAvailable();
  }, []);

  useEffect(() => {
    if (
      runtimeState === undefined ||
      runtimeGeneration === undefined ||
      !acceptsRequests(runtimeState)
    ) {
      useRegistryStore.getState().clearRuntimeSnapshot();
      installDevelopmentRegistryWhenAvailable();
      return;
    }

    const registry = useRegistryStore.getState();
    if (
      registry.source === "runtime" &&
      registry.runtimeGeneration === runtimeGeneration
    ) {
      return;
    }
    registry.clearRuntimeSnapshot();
    installDevelopmentRegistryWhenAvailable();

    let active = true;
    void runtime
      .request("registryGet", {})
      .then((result) => {
        const currentStatus = useRuntimeStore.getState().status;
        if (
          !active ||
          currentStatus?.generation !== runtimeGeneration ||
          !acceptsRequests(currentStatus.state)
        ) {
          return;
        }
        if (!isValidRegistrySnapshot(result.registry)) {
          reportRegistryLoadFailure(
            new TypeError(
              "The runtime registry does not match the graph registry contract.",
            ),
          );
          return;
        }
        useRegistryStore
          .getState()
          .installSnapshot(result.registry, "runtime", runtimeGeneration);
      })
      .catch((cause: unknown) => {
        if (active) {
          reportRegistryLoadFailure(cause);
        }
      });

    return () => {
      active = false;
    };
  }, [runtime, runtimeGeneration, runtimeState]);

  return children;
}
