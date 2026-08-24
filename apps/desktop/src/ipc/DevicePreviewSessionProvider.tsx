import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createDevicePreviewWindowBridge,
  type DevicePreviewWindowBridge,
  type DevicePreviewWindowSnapshot,
} from "../device-preview/device-preview-window-bridge";
import {
  DevicePreviewSessionContext,
  type DevicePreviewSessionValue,
} from "./device-preview-session-context";
import {
  useDevicePreview,
  type DevicePreviewController,
} from "./useDevicePreview";
const defaultDevicePreviewWindowBridge = createDevicePreviewWindowBridge();

function snapshotFingerprint(snapshot: DevicePreviewWindowSnapshot): string {
  return [
    snapshot.phase,
    snapshot.previewToken ?? "",
    snapshot.width ?? "",
    snapshot.height ?? "",
    snapshot.interactionAvailable ? "1" : "0",
  ].join("|");
}

interface DevicePreviewWindowSnapshotSource {
  readonly snapshot: Omit<DevicePreviewWindowSnapshot, "generation">;
  readonly sourceGeneration: number;
}

function createWindowSnapshot(
  source: DevicePreviewWindowSnapshotSource,
  previous: DevicePreviewWindowSnapshot | undefined,
  previousFingerprint: string | undefined,
): DevicePreviewWindowSnapshot {
  const nextFingerprint = snapshotFingerprint({
    generation: 0,
    ...source.snapshot,
  });
  if (previous !== undefined && previousFingerprint === nextFingerprint) {
    return previous;
  }

  const generation = Math.max(
    (previous?.generation ?? 0) + 1,
    source.sourceGeneration,
  );
  return { generation, ...source.snapshot };
}

function createSessionValue(
  controller: DevicePreviewController,
): Omit<
  DevicePreviewSessionValue,
  | "canOpenDevicePreviewWindow"
  | "devicePreviewWindowError"
  | "openDevicePreviewWindow"
> {
  return {
    devices: controller.devices,
    selectedDevice: controller.selectedDevice,
    selectedDeviceKey: controller.selectedDeviceKey,
    preview: controller.preview,
    previewToken: controller.preview?.descriptor.previewToken,
    previewWidth: controller.preview?.descriptor.width,
    previewHeight: controller.preview?.descriptor.height,
    previewSourceGeneration: controller.preview?.descriptor.sourceGeneration,
    phase: controller.phase,
    canUseDeviceManagement: controller.canUseDeviceManagement,
    canCapturePreview: controller.canCapturePreview,
    canControlDevice: controller.canControlDevice,
    interactionPending: controller.interactionPending,
    selectDevice: controller.selectDevice,
    refreshDevices: controller.refreshDevices,
    connect: controller.connect,
    disconnect: controller.disconnect,
    capture: controller.capture,
    refreshPreview: controller.refreshPreview,
    getLastCaptureFailure: controller.getLastCaptureFailure,
    interact: controller.interact,
    acquirePreviewLease: controller.acquirePreviewLease,
  };
}

export interface DevicePreviewSessionProviderProps {
  children: ReactNode;
  bridge?: DevicePreviewWindowBridge;
}

/** Owns the single main-window preview session; surfaces only consume its context. */
export function DevicePreviewSessionProvider({
  children,
  bridge = defaultDevicePreviewWindowBridge,
}: DevicePreviewSessionProviderProps) {
  const controller = useDevicePreview();
  const [devicePreviewWindowError, setDevicePreviewWindowError] =
    useState(false);
  const lastWindowSnapshotRef = useRef<DevicePreviewWindowSnapshot | undefined>(
    undefined,
  );
  const lastWindowFingerprintRef = useRef<string | undefined>(undefined);
  const publishedWindowFingerprintRef = useRef<string | undefined>(undefined);
  const windowSnapshotSource =
    useMemo<DevicePreviewWindowSnapshotSource>(() => {
      const preview = controller.preview?.descriptor;
      return {
        snapshot: {
          phase: controller.phase,
          ...(preview === undefined
            ? {}
            : { previewToken: preview.previewToken }),
          ...(preview === undefined
            ? {}
            : { width: preview.width, height: preview.height }),
          interactionAvailable:
            controller.preview !== undefined &&
            controller.canControlDevice &&
            controller.selectedDevice?.state === "connected",
        },
        sourceGeneration: preview?.sourceGeneration ?? 0,
      };
    }, [
      controller.canControlDevice,
      controller.phase,
      controller.preview,
      controller.selectedDevice?.state,
    ]);
  const resolveWindowSnapshot = useCallback(() => {
    const snapshot = createWindowSnapshot(
      windowSnapshotSource,
      lastWindowSnapshotRef.current,
      lastWindowFingerprintRef.current,
    );
    lastWindowSnapshotRef.current = snapshot;
    lastWindowFingerprintRef.current = snapshotFingerprint(snapshot);
    return snapshot;
  }, [windowSnapshotSource]);
  const canOpenDevicePreviewWindow = useMemo(() => {
    try {
      return bridge.isAvailable();
    } catch {
      return false;
    }
  }, [bridge]);

  const publishWindowSnapshot = useCallback(
    async (snapshot: DevicePreviewWindowSnapshot): Promise<void> => {
      const fingerprint = snapshotFingerprint(snapshot);
      if (publishedWindowFingerprintRef.current === fingerprint) {
        return;
      }
      const previousFingerprint = publishedWindowFingerprintRef.current;
      publishedWindowFingerprintRef.current = fingerprint;
      try {
        await bridge.publish(snapshot);
      } catch (error: unknown) {
        if (publishedWindowFingerprintRef.current === fingerprint) {
          publishedWindowFingerprintRef.current = previousFingerprint;
        }
        throw error;
      }
    },
    [bridge],
  );

  useEffect(() => {
    if (!canOpenDevicePreviewWindow) {
      return;
    }
    const snapshot = resolveWindowSnapshot();
    void publishWindowSnapshot(snapshot).then(
      () => {
        setDevicePreviewWindowError(false);
      },
      () => {
        setDevicePreviewWindowError(true);
      },
    );
  }, [
    canOpenDevicePreviewWindow,
    publishWindowSnapshot,
    resolveWindowSnapshot,
  ]);

  const openDevicePreviewWindow = useCallback(async (): Promise<boolean> => {
    if (!canOpenDevicePreviewWindow) {
      return false;
    }
    try {
      await bridge.open();
      await publishWindowSnapshot(resolveWindowSnapshot());
      setDevicePreviewWindowError(false);
      return true;
    } catch {
      setDevicePreviewWindowError(true);
      return false;
    }
  }, [
    bridge,
    canOpenDevicePreviewWindow,
    publishWindowSnapshot,
    resolveWindowSnapshot,
  ]);

  const value = useMemo(
    () => ({
      ...createSessionValue(controller),
      canOpenDevicePreviewWindow,
      devicePreviewWindowError,
      openDevicePreviewWindow,
    }),
    [
      canOpenDevicePreviewWindow,
      controller,
      devicePreviewWindowError,
      openDevicePreviewWindow,
    ],
  );

  return (
    <DevicePreviewSessionContext.Provider value={value}>
      {children}
    </DevicePreviewSessionContext.Provider>
  );
}
