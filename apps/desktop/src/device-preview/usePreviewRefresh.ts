import { useEffect, useMemo, useRef, useState } from "react";

import {
  choosePreviewRefreshPolicy,
  type PreviewRefreshPolicy,
} from "./preview-policy";

export interface PreviewRefreshSchedulerOptions {
  enabled: boolean;
  deviceConnected: boolean;
  userPaused: boolean;
  surfaceVisible: boolean;
  windowActive: boolean;
  deviceBusy: boolean;
  graphInteracting: boolean;
  runActive: boolean;
  targetRefreshFps: number;
  refreshPreview: () => Promise<boolean>;
  now?: () => number;
}

export interface PreviewRefreshSchedulerState {
  policy: PreviewRefreshPolicy;
  refreshing: boolean;
  lastCaptureDurationMilliseconds: number | undefined;
}

const readCurrentTime = () => performance.now();

export function useWindowActivity(): boolean {
  const [active, setActive] = useState(
    () =>
      typeof document === "undefined" ||
      (document.visibilityState === "visible" && document.hasFocus()),
  );

  useEffect(() => {
    const update = () => {
      setActive(document.visibilityState === "visible" && document.hasFocus());
    };
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);

  return active;
}

export function usePreviewRefresh(
  options: PreviewRefreshSchedulerOptions,
): PreviewRefreshSchedulerState {
  const [lastCaptureDurationMilliseconds, setLastCaptureDurationMilliseconds] =
    useState<number>();
  const [refreshing, setRefreshing] = useState(false);
  const [cycle, setCycle] = useState(0);
  const now = options.now ?? readCurrentTime;
  const nowRef = useRef(now);
  const refreshPreviewRef = useRef(options.refreshPreview);
  useEffect(() => {
    nowRef.current = now;
    refreshPreviewRef.current = options.refreshPreview;
  }, [now, options.refreshPreview]);
  const policy = useMemo(
    () =>
      choosePreviewRefreshPolicy({
        deviceConnected: options.deviceConnected,
        userPaused: options.userPaused,
        surfaceVisible: options.surfaceVisible,
        windowActive: options.windowActive,
        deviceBusy: options.deviceBusy,
        graphInteracting: options.graphInteracting,
        runActive: options.runActive,
        targetRefreshFps: options.targetRefreshFps,
        ...(lastCaptureDurationMilliseconds === undefined
          ? {}
          : { lastCaptureDurationMilliseconds }),
      }),
    [
      lastCaptureDurationMilliseconds,
      options.deviceBusy,
      options.deviceConnected,
      options.graphInteracting,
      options.runActive,
      options.targetRefreshFps,
      options.surfaceVisible,
      options.userPaused,
      options.windowActive,
    ],
  );

  useEffect(() => {
    if (!options.enabled || policy.mode === "paused") {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      const startedAt = nowRef.current();
      setRefreshing(true);
      void refreshPreviewRef
        .current()
        .then((captured) => {
          if (active && captured) {
            setLastCaptureDurationMilliseconds(
              Math.max(0, Math.round(nowRef.current() - startedAt)),
            );
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (active) {
            setRefreshing(false);
            setCycle((current) => current + 1);
          }
        });
    }, policy.intervalMilliseconds);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cycle, options.enabled, policy]);

  return { policy, refreshing, lastCaptureDurationMilliseconds };
}
