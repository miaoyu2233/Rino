import type {
  DeviceDescriptorV1,
  DeviceInteractionV1,
  PreviewArtifactDescriptorV1,
} from "@rino/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { acceptsRequests } from "./runtime-contract";
import { RuntimeCommandError } from "./runtime-client";
import { useRuntime } from "./useRuntime";
import { useRuntimeStore } from "./runtime-store";

const PREVIEW_MAXIMUM_WIDTH = 1920;
const PREVIEW_MAXIMUM_HEIGHT = 1920;

export interface VisiblePreview {
  descriptor: PreviewArtifactDescriptorV1;
  objectUrl: string;
}

export interface PreviewLease {
  preview: VisiblePreview;
  release: () => void;
}

export type DevicePreviewCaptureFailureStage =
  | "runtimeCapture"
  | "previewRead"
  | "previewValidation"
  | "previewPresentation";

export interface DevicePreviewCaptureFailure {
  stage: DevicePreviewCaptureFailureStage;
  diagnosticCode?: string;
}

export type DevicePreviewPhase =
  | "unavailable"
  | "loadingDevices"
  | "disconnected"
  | "connecting"
  | "ready"
  | "capturing"
  | "error";

export interface DevicePreviewController {
  devices: DeviceDescriptorV1[];
  selectedDevice: DeviceDescriptorV1 | undefined;
  selectedDeviceKey: string;
  preview: VisiblePreview | undefined;
  phase: DevicePreviewPhase;
  canUseDeviceManagement: boolean;
  canCapturePreview: boolean;
  canControlDevice: boolean;
  interactionPending: boolean;
  selectDevice: (deviceKey: string) => void;
  refreshDevices: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  capture: () => Promise<boolean>;
  refreshPreview: () => Promise<boolean>;
  getLastCaptureFailure: () => DevicePreviewCaptureFailure | undefined;
  interact: (interaction: DeviceInteractionV1) => Promise<boolean>;
  acquirePreviewLease: () => PreviewLease | undefined;
}

/** Owns one visible device preview without putting image bytes in shared state. */
export function useDevicePreview(): DevicePreviewController {
  const { readPreview, request } = useRuntime();
  const status = useRuntimeStore((store) => store.status);
  const [devices, setDevices] = useState<DeviceDescriptorV1[]>([]);
  const [selectedDeviceKey, setSelectedDeviceKey] = useState("");
  const [preview, setPreview] = useState<VisiblePreview>();
  const [phase, setPhase] = useState<DevicePreviewPhase>("unavailable");
  const previewRef = useRef<VisiblePreview | undefined>(undefined);
  const selectedDeviceKeyRef = useRef("");
  const captureInFlight = useRef<Promise<boolean> | undefined>(undefined);
  const captureFailureRef = useRef<DevicePreviewCaptureFailure | undefined>(
    undefined,
  );
  const previewLeaseCount = useRef(0);
  const interactionInFlight = useRef(false);
  const automaticConnectionAttempts = useRef(new Set<string>());
  const [interactionPending, setInteractionPending] = useState(false);

  const canUseDeviceManagement =
    status !== undefined &&
    acceptsRequests(status.state) &&
    status.featureFlags?.includes("runtime.deviceManagement") === true;
  const canCapturePreview =
    canUseDeviceManagement &&
    status.featureFlags?.includes("runtime.devicePreview") === true;
  const canControlDevice =
    canUseDeviceManagement &&
    status.featureFlags?.includes("runtime.deviceControl") === true;

  const selectedDevice = useMemo(
    () => devices.find((device) => device.deviceKey === selectedDeviceKey),
    [devices, selectedDeviceKey],
  );

  const selectDevice = useCallback((deviceKey: string) => {
    selectedDeviceKeyRef.current = deviceKey;
    setSelectedDeviceKey(deviceKey);
  }, []);

  const releaseVisiblePreview = useCallback(() => {
    const visible = previewRef.current;
    if (visible === undefined) {
      return;
    }
    previewRef.current = undefined;
    setPreview(undefined);
    URL.revokeObjectURL(visible.objectUrl);
    void request("previewRelease", {
      previewToken: visible.descriptor.previewToken,
    }).catch(() => undefined);
  }, [request]);

  const acquirePreviewLease = useCallback((): PreviewLease | undefined => {
    const visible = previewRef.current;
    if (visible === undefined) {
      return undefined;
    }
    previewLeaseCount.current += 1;
    let released = false;
    return {
      preview: visible,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        previewLeaseCount.current = Math.max(0, previewLeaseCount.current - 1);
      },
    };
  }, []);

  const connectDevice = useCallback(
    async (deviceKey: string): Promise<boolean> => {
      setPhase("connecting");
      try {
        const result = await request("deviceConnect", { deviceKey });
        setDevices((current) =>
          current.map((device) =>
            device.deviceKey === result.device.deviceKey
              ? result.device
              : device,
          ),
        );
        selectDevice(result.device.deviceKey);
        setPhase("ready");
        return true;
      } catch {
        setPhase("error");
        return false;
      }
    },
    [request, selectDevice],
  );

  const refreshDevices = useCallback(async () => {
    if (!canUseDeviceManagement) {
      setDevices([]);
      selectDevice("");
      setPhase("unavailable");
      return;
    }
    setPhase("loadingDevices");
    try {
      const result = await request("deviceList", {});
      setDevices(result.devices);
      const selectedDevice = result.devices.find(
        (device) => device.deviceKey === selectedDeviceKeyRef.current,
      );
      const device = selectedDevice ?? result.devices[0];
      selectDevice(device?.deviceKey ?? "");
      if (device === undefined) {
        setPhase("disconnected");
        return;
      }
      if (device.state === "connected") {
        setPhase("ready");
        return;
      }

      const attemptKey = `${status.generation.toString()}:${device.deviceKey}`;
      if (automaticConnectionAttempts.current.has(attemptKey)) {
        setPhase("disconnected");
        return;
      }
      automaticConnectionAttempts.current.add(attemptKey);
      await connectDevice(device.deviceKey);
    } catch {
      setPhase("error");
    }
  }, [canUseDeviceManagement, connectDevice, request, selectDevice, status]);

  useEffect(() => {
    const pendingRefresh = window.setTimeout(() => {
      void refreshDevices();
    }, 0);
    return () => {
      window.clearTimeout(pendingRefresh);
    };
  }, [refreshDevices, status?.generation]);

  useEffect(() => {
    releaseVisiblePreview();
  }, [releaseVisiblePreview, selectedDeviceKey, status?.generation]);

  useEffect(
    () => () => {
      const visible = previewRef.current;
      if (visible !== undefined) {
        URL.revokeObjectURL(visible.objectUrl);
        void request("previewRelease", {
          previewToken: visible.descriptor.previewToken,
        }).catch(() => undefined);
      }
    },
    [request],
  );

  const connect = useCallback(async () => {
    if (selectedDevice === undefined) {
      return;
    }
    await connectDevice(selectedDevice.deviceKey);
  }, [connectDevice, selectedDevice]);

  const disconnect = useCallback(async () => {
    if (selectedDevice === undefined) {
      return;
    }
    releaseVisiblePreview();
    try {
      const result = await request("deviceDisconnect", {
        deviceKey: selectedDevice.deviceKey,
      });
      setDevices((current) =>
        current.map((device) =>
          device.deviceKey === result.device.deviceKey ? result.device : device,
        ),
      );
      setPhase("disconnected");
    } catch {
      setPhase("error");
    }
  }, [releaseVisiblePreview, request, selectedDevice]);

  const performCapture = useCallback(
    (showActivity: boolean): Promise<boolean> => {
      if (!canCapturePreview || selectedDevice?.state !== "connected") {
        return Promise.resolve(false);
      }
      const currentCapture = captureInFlight.current;
      if (currentCapture !== undefined) {
        return currentCapture;
      }
      const operation = (async (): Promise<boolean> => {
        if (showActivity) {
          setPhase("capturing");
        }
        let previewToken: string | undefined;
        let failureStage: DevicePreviewCaptureFailureStage = "runtimeCapture";
        try {
          const generation = status.generation;
          const result = await request("previewCapture", {
            deviceKey: selectedDevice.deviceKey,
            maximumWidth: PREVIEW_MAXIMUM_WIDTH,
            maximumHeight: PREVIEW_MAXIMUM_HEIGHT,
          });
          previewToken = result.preview.previewToken;
          failureStage = "previewRead";
          const bytes = await readPreview(previewToken);
          failureStage = "previewValidation";
          if (
            bytes.byteLength !== result.preview.byteLength ||
            useRuntimeStore.getState().status?.generation !== generation
          ) {
            throw new Error(
              "The preview became stale before it could be displayed.",
            );
          }
          failureStage = "previewPresentation";
          const previous = previewRef.current;
          if (previewLeaseCount.current > 0 && previous !== undefined) {
            const supersededToken = previewToken;
            previewToken = undefined;
            void request("previewRelease", {
              previewToken: supersededToken,
            }).catch(() => undefined);
            captureFailureRef.current = {
              stage: "previewValidation",
              diagnosticCode: "PREVIEW_FRAME_LEASED",
            };
            setPhase("ready");
            return false;
          }
          const pngBuffer = Uint8Array.from(bytes).buffer;
          const nextPreview = {
            descriptor: result.preview,
            objectUrl: URL.createObjectURL(
              new Blob([pngBuffer], { type: result.preview.mediaType }),
            ),
          };
          previewRef.current = nextPreview;
          setPreview(nextPreview);
          if (previous !== undefined) {
            URL.revokeObjectURL(previous.objectUrl);
            void request("previewRelease", {
              previewToken: previous.descriptor.previewToken,
            }).catch(() => undefined);
          }
          setPhase("ready");
          captureFailureRef.current = undefined;
          return true;
        } catch (cause: unknown) {
          const diagnosticCode =
            cause instanceof RuntimeCommandError
              ? cause.error.code
              : failureStage === "previewValidation"
                ? "PREVIEW_STALE_OR_INVALID"
                : failureStage === "previewPresentation"
                  ? "PREVIEW_PRESENTATION_FAILED"
                  : undefined;
          captureFailureRef.current = {
            stage: failureStage,
            ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
          };
          if (previewToken !== undefined) {
            void request("previewRelease", { previewToken }).catch(
              () => undefined,
            );
          }
          setPhase("error");
          return false;
        } finally {
          captureInFlight.current = undefined;
        }
      })();
      captureInFlight.current = operation;
      return operation;
    },
    [canCapturePreview, readPreview, request, selectedDevice, status],
  );

  const capture = useCallback(() => performCapture(true), [performCapture]);
  const refreshPreview = useCallback(
    () => performCapture(false),
    [performCapture],
  );

  const interact = useCallback(
    async (interaction: DeviceInteractionV1) => {
      if (
        !canControlDevice ||
        selectedDevice?.state !== "connected" ||
        interactionInFlight.current
      ) {
        return false;
      }
      interactionInFlight.current = true;
      setInteractionPending(true);
      try {
        await request("deviceInteract", {
          deviceKey: selectedDevice.deviceKey,
          interaction,
        });
        return true;
      } catch {
        return false;
      } finally {
        interactionInFlight.current = false;
        setInteractionPending(false);
      }
    },
    [canControlDevice, request, selectedDevice],
  );

  return {
    devices,
    selectedDevice,
    selectedDeviceKey,
    preview,
    phase,
    canUseDeviceManagement,
    canCapturePreview,
    canControlDevice,
    interactionPending,
    selectDevice,
    refreshDevices,
    connect,
    disconnect,
    capture,
    refreshPreview,
    getLastCaptureFailure: () => captureFailureRef.current,
    interact,
    acquirePreviewLease,
  };
}
