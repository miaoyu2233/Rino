export type PreviewPauseReason =
  "disconnected" | "userPaused" | "surfaceHidden" | "windowInactive";

export interface PreviewRefreshContext {
  deviceConnected: boolean;
  userPaused: boolean;
  surfaceVisible: boolean;
  windowActive: boolean;
  deviceBusy: boolean;
  graphInteracting: boolean;
  runActive: boolean;
  targetRefreshFps: number;
  lastCaptureDurationMilliseconds?: number;
}

export type PreviewRefreshPolicy =
  | { mode: "paused"; reason: PreviewPauseReason }
  | { mode: "refresh"; intervalMilliseconds: number };

export function choosePreviewRefreshPolicy(
  context: PreviewRefreshContext,
): PreviewRefreshPolicy {
  if (!context.deviceConnected) {
    return { mode: "paused", reason: "disconnected" };
  }
  if (context.userPaused) {
    return { mode: "paused", reason: "userPaused" };
  }
  if (!context.surfaceVisible) {
    return { mode: "paused", reason: "surfaceHidden" };
  }
  if (!context.windowActive) {
    return { mode: "paused", reason: "windowInactive" };
  }
  if (context.deviceBusy) {
    return { mode: "refresh", intervalMilliseconds: 500 };
  }
  const targetIntervalMilliseconds = Math.round(
    1000 / Math.min(10, Math.max(1, context.targetRefreshFps)),
  );
  if (context.graphInteracting || context.runActive) {
    return {
      mode: "refresh",
      intervalMilliseconds: Math.max(200, targetIntervalMilliseconds),
    };
  }
  const duration = context.lastCaptureDurationMilliseconds;
  if (duration === undefined) {
    return {
      mode: "refresh",
      intervalMilliseconds: targetIntervalMilliseconds,
    };
  }
  return {
    mode: "refresh",
    intervalMilliseconds: Math.max(16, targetIntervalMilliseconds - duration),
  };
}
