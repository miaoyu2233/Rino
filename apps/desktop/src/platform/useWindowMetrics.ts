import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

const WINDOW_INTERACTION_SETTLE_DELAY_MS = 220;

export interface WindowMetrics {
  width: number;
  height: number;
  scaleFactor: number;
}

function readBrowserWindowMetrics(): WindowMetrics {
  return {
    width: Math.max(0, window.innerWidth),
    height: Math.max(0, window.innerHeight),
    scaleFactor: Math.max(1, window.devicePixelRatio || 1),
  };
}

export function useWindowMetrics(): WindowMetrics {
  const [metrics, setMetrics] = useState<WindowMetrics>(
    readBrowserWindowMetrics,
  );

  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const updateFromBrowser = () => {
      if (!disposed) {
        setMetrics(readBrowserWindowMetrics());
      }
    };

    window.addEventListener("resize", updateFromBrowser);

    if (isTauri()) {
      const applicationWindow = getCurrentWindow();
      void Promise.all([
        applicationWindow.innerSize(),
        applicationWindow.scaleFactor(),
      ])
        .then(([physicalSize, scaleFactor]) => {
          if (!disposed) {
            const logicalSize = physicalSize.toLogical(scaleFactor);
            setMetrics({
              width: logicalSize.width,
              height: logicalSize.height,
              scaleFactor,
            });
          }
        })
        .catch(updateFromBrowser);

      void applicationWindow
        .onResized(({ payload: physicalSize }) => {
          void applicationWindow.scaleFactor().then((scaleFactor) => {
            if (!disposed) {
              const logicalSize = physicalSize.toLogical(scaleFactor);
              setMetrics({
                width: logicalSize.width,
                height: logicalSize.height,
                scaleFactor,
              });
            }
          });
        })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlisteners.push(unlisten);
          }
        })
        .catch(() => undefined);

      void applicationWindow
        .onScaleChanged(({ payload }) => {
          if (!disposed) {
            const logicalSize = payload.size.toLogical(payload.scaleFactor);
            setMetrics({
              width: logicalSize.width,
              height: logicalSize.height,
              scaleFactor: payload.scaleFactor,
            });
          }
        })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlisteners.push(unlisten);
          }
        })
        .catch(() => undefined);
    }

    return () => {
      disposed = true;
      window.removeEventListener("resize", updateFromBrowser);
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  return metrics;
}

/** Reports native window movement or resizing without forwarding every event to React. */
export function useWindowInteraction(): boolean {
  const [windowInteracting, setWindowInteracting] = useState(false);
  const interactionRef = useRef(false);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let disposed = false;
    let settleTimer: ReturnType<typeof window.setTimeout> | undefined;
    const unlisteners: (() => void)[] = [];
    const applicationWindow = getCurrentWindow();

    const scheduleSettledState = () => {
      if (settleTimer !== undefined) {
        window.clearTimeout(settleTimer);
      }
      settleTimer = window.setTimeout(() => {
        settleTimer = undefined;
        if (disposed) {
          return;
        }
        interactionRef.current = false;
        setWindowInteracting(false);
      }, WINDOW_INTERACTION_SETTLE_DELAY_MS);
    };

    const markInteracting = () => {
      if (disposed) {
        return;
      }
      if (!interactionRef.current) {
        interactionRef.current = true;
        setWindowInteracting(true);
      }
      scheduleSettledState();
    };

    const registerUnlistener = (subscription: Promise<() => void>) => {
      void subscription
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlisteners.push(unlisten);
          }
        })
        .catch(() => undefined);
    };

    registerUnlistener(applicationWindow.onMoved(markInteracting));
    registerUnlistener(applicationWindow.onResized(markInteracting));

    return () => {
      disposed = true;
      interactionRef.current = false;
      if (settleTimer !== undefined) {
        window.clearTimeout(settleTimer);
      }
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  return windowInteracting;
}
