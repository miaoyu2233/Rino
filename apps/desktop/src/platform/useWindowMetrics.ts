import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

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
