import { useCallback, useEffect, useRef, type ReactNode } from "react";

import { useRegistryStore } from "../graph/registry/registry-store";
import { useRuntimeStore } from "../ipc/runtime-store";
import {
  completeStartupWindow,
  reportStartupStage,
  STARTUP_GATE_TIMEOUT_MS,
  waitForStartupBrowserReady,
} from "./startup-gate-runtime";
import type { StartupStage } from "./startup-stage";

export interface StartupGateProps {
  children: ReactNode;
}

/** Releases only the main window after its first useful frame is ready. */
export function StartupGate({ children }: StartupGateProps): ReactNode {
  const browserReadyWaitStartedRef = useRef(false);
  const completionRequestedRef = useRef(false);
  const reportedStageRef = useRef<StartupStage | undefined>(undefined);

  const runtimeSettled = useRuntimeStore(
    (store) => store.initializationState !== "pending",
  );
  const registrySettled = useRegistryStore(
    (store) => store.initializationState !== "pending",
  );

  const reportStage = useCallback((stage: StartupStage): void => {
    if (reportedStageRef.current === stage) {
      return;
    }
    reportedStageRef.current = stage;
    reportStartupStage(stage);
  }, []);

  const requestCompletion = useCallback((): void => {
    if (completionRequestedRef.current) {
      return;
    }
    completionRequestedRef.current = true;
    reportStage("opening");
    void completeStartupWindow();
  }, [reportStage]);

  useEffect(() => {
    reportStage("initializing");
  }, [reportStage]);

  useEffect(() => {
    if (!runtimeSettled) {
      reportStage("runtime");
      return;
    }
    if (!registrySettled) {
      reportStage("registry");
    }
  }, [registrySettled, reportStage, runtimeSettled]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      requestCompletion();
    }, STARTUP_GATE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [requestCompletion]);

  useEffect(() => {
    if (
      !runtimeSettled ||
      !registrySettled ||
      browserReadyWaitStartedRef.current
    ) {
      return;
    }

    browserReadyWaitStartedRef.current = true;
    reportStage("workspace");
    let cancelled = false;
    void waitForStartupBrowserReady().then(() => {
      if (!cancelled) {
        requestCompletion();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [registrySettled, reportStage, requestCompletion, runtimeSettled]);

  return children;
}
