import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "../app-shell/EmptyState";
import { Button } from "../components/ui/Button";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import { ThemeProvider } from "../design-system/theme/ThemeProvider";
import { ApplicationErrorBoundary } from "../diagnostics/ApplicationErrorBoundary";
import { createDesktopRuntimeTransport } from "../ipc/runtime-transport";
import { LocaleProvider } from "../localization/LocaleProvider";
import {
  createDevicePreviewWindowBridge,
  type DevicePreviewWindowBridge,
  type DevicePreviewWindowSnapshot,
} from "./device-preview-window-bridge";

const MAXIMUM_PREVIEW_BYTES = 3_145_728;
const defaultBridge = createDevicePreviewWindowBridge();
const defaultReadPreview = (previewToken: string) =>
  createDesktopRuntimeTransport().readPreview(previewToken);

interface PresentedPreview {
  readonly generation: number;
  readonly objectUrl: string;
  readonly previewToken: string;
}

export interface DevicePreviewWindowAppProps {
  bridge?: DevicePreviewWindowBridge;
  readPreview?: (previewToken: string) => Promise<Uint8Array>;
}

function phaseLabelKey(snapshot: DevicePreviewWindowSnapshot | undefined) {
  switch (snapshot?.phase) {
    case "loadingDevices":
      return "shell.device.phase.loadingDevices" as const;
    case "connecting":
      return "shell.device.phase.connecting" as const;
    case "capturing":
      return "shell.device.phase.capturing" as const;
    case "ready":
      return "shell.device.previewRefresh.status.live" as const;
    case "error":
      return "shell.device.previewError" as const;
    case "unavailable":
      return "shell.device.backendUnavailable" as const;
    case "disconnected":
    default:
      return "shell.device.disconnectedShort" as const;
  }
}

export function DevicePreviewWindowApp({
  bridge = defaultBridge,
  readPreview = defaultReadPreview,
}: DevicePreviewWindowAppProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<DevicePreviewWindowSnapshot>();
  const [presentedPreview, setPresentedPreview] = useState<PresentedPreview>();
  const [readFailed, setReadFailed] = useState(false);
  const [bridgeFailed, setBridgeFailed] = useState(false);
  const latestGenerationRef = useRef(-1);
  const presentedPreviewRef = useRef<PresentedPreview | undefined>(undefined);

  const replacePresentedPreview = useCallback(
    (next: PresentedPreview | undefined) => {
      const previous = presentedPreviewRef.current;
      presentedPreviewRef.current = next;
      setPresentedPreview(next);
      if (previous !== undefined && previous.objectUrl !== next?.objectUrl) {
        URL.revokeObjectURL(previous.objectUrl);
      }
    },
    [],
  );

  const applySnapshot = useCallback(
    (next: DevicePreviewWindowSnapshot) => {
      if (next.generation < latestGenerationRef.current) {
        return;
      }
      latestGenerationRef.current = next.generation;
      setSnapshot(next);
      setBridgeFailed(false);

      if (next.previewToken === undefined) {
        replacePresentedPreview(undefined);
        setReadFailed(false);
        return;
      }
      if (presentedPreviewRef.current?.previewToken === next.previewToken) {
        return;
      }

      const requestedGeneration = next.generation;
      const requestedToken = next.previewToken;
      setReadFailed(false);
      void readPreview(requestedToken)
        .then((bytes) => {
          if (
            requestedGeneration !== latestGenerationRef.current ||
            bytes.byteLength < 1 ||
            bytes.byteLength > MAXIMUM_PREVIEW_BYTES
          ) {
            if (requestedGeneration === latestGenerationRef.current) {
              setReadFailed(true);
            }
            return;
          }
          const pngBuffer = Uint8Array.from(bytes).buffer;
          const objectUrl = URL.createObjectURL(
            new Blob([pngBuffer], { type: "image/png" }),
          );
          if (requestedGeneration !== latestGenerationRef.current) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          replacePresentedPreview({
            generation: requestedGeneration,
            objectUrl,
            previewToken: requestedToken,
          });
        })
        .catch(() => {
          if (requestedGeneration === latestGenerationRef.current) {
            setReadFailed(true);
          }
        });
    },
    [readPreview, replacePresentedPreview],
  );

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void bridge
      .listen((next) => {
        if (active) {
          applySnapshot(next);
        }
      })
      .then((stopListening) => {
        if (!active) {
          stopListening();
          return undefined;
        }
        unlisten = stopListening;
        return bridge.current();
      })
      .then((current) => {
        if (active && current !== undefined) {
          applySnapshot(current);
        }
      })
      .catch(() => {
        if (active) {
          setBridgeFailed(true);
        }
      });

    return () => {
      active = false;
      unlisten?.();
      replacePresentedPreview(undefined);
    };
  }, [applySnapshot, bridge, replacePresentedPreview]);

  const phaseLabel = t(phaseLabelKey(snapshot));
  const closeWindow = () => {
    void bridge.close().catch(() => {
      setBridgeFailed(true);
    });
  };

  let emptyTitle: string = t("shell.device.independentWindow.waitingTitle");
  let emptyDescription: string = t(
    "shell.device.independentWindow.waitingDescription",
  );
  if (bridgeFailed || readFailed || snapshot?.phase === "error") {
    emptyTitle = t("shell.device.previewError");
    emptyDescription = t("shell.device.independentWindow.readFailure");
  } else if (snapshot?.phase === "unavailable") {
    emptyTitle = t("shell.device.backendUnavailable");
    emptyDescription = t("shell.device.backendUnavailableDescription");
  } else if (snapshot?.phase === "disconnected") {
    emptyTitle = t("shell.device.disconnected");
    emptyDescription = t("shell.device.disconnectedDescription");
  } else if (snapshot?.phase === "ready") {
    emptyTitle = t("shell.device.readyToCapture");
    emptyDescription = t("shell.device.readyToCaptureDescription");
  }

  return (
    <div className="device-preview-window">
      <header className="device-preview-window__header">
        <div className="device-preview-window__identity">
          <ProductIcon icon="panel.device" size="standard" />
          <strong>{t("shell.device.independentWindow.title")}</strong>
          <span className="device-preview-window__status" role="status">
            {phaseLabel}
          </span>
        </div>
        <Button
          aria-label={t("shell.device.independentWindow.close")}
          size="icon"
          variant="ghost"
          onClick={closeWindow}
        >
          <ProductIcon icon="action.close" size="standard" />
        </Button>
      </header>
      <main className="device-preview-window__content">
        {presentedPreview === undefined ? (
          <EmptyState
            description={emptyDescription}
            icon={
              readFailed || bridgeFailed ? "runtime.warning" : "panel.device"
            }
            title={emptyTitle}
          />
        ) : (
          <img
            className="device-preview-window__image"
            src={presentedPreview.objectUrl}
            alt={t("shell.device.previewLabel")}
            draggable={false}
          />
        )}
        {readFailed && presentedPreview !== undefined ? (
          <div className="device-preview-window__warning" role="alert">
            <ProductIcon icon="runtime.warning" size="small" />
            {t("shell.device.independentWindow.readFailure")}
          </div>
        ) : null}
      </main>
    </div>
  );
}

export function DevicePreviewWindowRoot() {
  return (
    <ApplicationErrorBoundary>
      <LocaleProvider>
        <ThemeProvider>
          <DevicePreviewWindowApp />
        </ThemeProvider>
      </LocaleProvider>
    </ApplicationErrorBoundary>
  );
}
