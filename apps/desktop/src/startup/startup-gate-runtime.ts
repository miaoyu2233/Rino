import { invoke, isTauri } from "@tauri-apps/api/core";

import { isDevicePreviewWindow } from "../device-preview/device-preview-window-bridge";
import type { StartupStage } from "./startup-stage";

export const STARTUP_GATE_TIMEOUT_MS = 15_000;
export const STARTUP_COMPLETE_RETRY_DELAY_MS = 250;

interface StartupUnloadSignal {
  promise: Promise<void>;
  dispose: () => void;
}

let startupCompletionPromise: Promise<void> | undefined;

interface IdleWindow {
  requestIdleCallback?: Window["requestIdleCallback"];
}

function nextAnimationFrame(): Promise<void> {
  if (typeof window.requestAnimationFrame === "function") {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        resolve();
      });
    });
  }
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve();
    }, 0);
  });
}

function nextIdlePoint(): Promise<void> {
  const idleWindow = window as unknown as IdleWindow;
  const requestIdleCallback = idleWindow.requestIdleCallback;
  if (typeof requestIdleCallback === "function") {
    return new Promise((resolve) => {
      requestIdleCallback(
        () => {
          resolve();
        },
        { timeout: 1_000 },
      );
    });
  }
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve();
    }, 0);
  });
}

function createStartupUnloadSignal(): StartupUnloadSignal {
  let resolveUnload: () => void = () => undefined;
  let unloaded = false;
  const promise = new Promise<void>((resolve) => {
    resolveUnload = () => {
      if (unloaded) {
        return;
      }
      unloaded = true;
      resolve();
    };
  });
  const listener = (): void => {
    resolveUnload();
  };
  const eventTypes = ["beforeunload", "pagehide", "unload"] as const;
  eventTypes.forEach((eventType) => {
    window.addEventListener(eventType, listener);
  });

  return {
    promise,
    dispose: () => {
      eventTypes.forEach((eventType) => {
        window.removeEventListener(eventType, listener);
      });
    },
  };
}

function waitForStartupCompletionRetry(
  unloadPromise: Promise<void>,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const retryTimer = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(true);
    }, STARTUP_COMPLETE_RETRY_DELAY_MS);

    void unloadPromise.then(() => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(retryTimer);
      resolve(false);
    });
  });
}

async function completeStartupWithRetry(): Promise<void> {
  const unloadSignal = createStartupUnloadSignal();
  let shouldRetry = true;
  try {
    while (shouldRetry) {
      const outcome = await Promise.race([
        invoke("complete_startup")
          .then(() => "completed" as const)
          .catch(() => "failed" as const),
        unloadSignal.promise.then(() => "unloaded" as const),
      ]);
      if (outcome === "completed" || outcome === "unloaded") {
        return;
      }
      shouldRetry = await waitForStartupCompletionRetry(unloadSignal.promise);
    }
  } finally {
    unloadSignal.dispose();
  }
}

/** Forwards a fixed startup stage to the native splash without blocking the gate. */
export function reportStartupStage(stage: StartupStage): void {
  if (!isTauri() || isDevicePreviewWindow()) {
    return;
  }
  try {
    void invoke("update_startup_stage", {
      stage,
    }).catch(() => undefined);
  } catch {
    // The splash keeps its last known stage when the native bridge is unavailable.
  }
}

/** Waits until the browser has committed fonts, two frames, and an idle point. */
export async function waitForStartupBrowserReady(): Promise<void> {
  const documentWithOptionalFonts = document as unknown as Omit<
    Document,
    "fonts"
  > & { fonts?: FontFaceSet };
  const fonts = documentWithOptionalFonts.fonts;
  if (fonts !== undefined) {
    await fonts.ready.catch(() => undefined);
  }
  await nextAnimationFrame();
  await nextAnimationFrame();
  await nextIdlePoint();
}

/** Signals the native shell to reveal the prepared main window. */
export function completeStartupWindow(): Promise<void> {
  if (!isTauri() || isDevicePreviewWindow()) {
    return Promise.resolve();
  }
  if (startupCompletionPromise !== undefined) {
    return startupCompletionPromise;
  }

  const completion = completeStartupWithRetry();
  startupCompletionPromise = completion;
  void completion.then(
    () => {
      if (startupCompletionPromise === completion) {
        startupCompletionPromise = undefined;
      }
    },
    () => {
      if (startupCompletionPromise === completion) {
        startupCompletionPromise = undefined;
      }
    },
  );
  return completion;
}
