import type { DeviceDescriptorV1, DeviceInteractionV1 } from "@rino/contracts";
import { createContext, useContext } from "react";

import type {
  DevicePreviewCaptureFailure,
  DevicePreviewPhase,
  PreviewLease,
  VisiblePreview,
} from "./useDevicePreview";

export type {
  DevicePreviewCaptureFailure,
  PreviewLease,
} from "./useDevicePreview";

export interface DevicePreviewSessionSnapshot {
  readonly devices: readonly DeviceDescriptorV1[];
  readonly selectedDevice: DeviceDescriptorV1 | undefined;
  readonly selectedDeviceKey: string;
  readonly preview: VisiblePreview | undefined;
  readonly previewToken: string | undefined;
  readonly previewWidth: number | undefined;
  readonly previewHeight: number | undefined;
  readonly previewSourceGeneration: number | undefined;
  readonly phase: DevicePreviewPhase;
  readonly canUseDeviceManagement: boolean;
  readonly canCapturePreview: boolean;
  readonly canControlDevice: boolean;
  readonly interactionPending: boolean;
  readonly canOpenDevicePreviewWindow: boolean;
  readonly devicePreviewWindowError: boolean;
}

export interface DevicePreviewSessionActions {
  readonly selectDevice: (deviceKey: string) => void;
  readonly refreshDevices: () => Promise<void>;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly capture: () => Promise<boolean>;
  readonly refreshPreview: () => Promise<boolean>;
  readonly getLastCaptureFailure: () => DevicePreviewCaptureFailure | undefined;
  readonly interact: (interaction: DeviceInteractionV1) => Promise<boolean>;
  readonly acquirePreviewLease: () => PreviewLease | undefined;
  readonly openDevicePreviewWindow: () => Promise<boolean>;
}

export type DevicePreviewSessionValue = DevicePreviewSessionSnapshot &
  DevicePreviewSessionActions;

export const DevicePreviewSessionContext = createContext<
  DevicePreviewSessionValue | undefined
>(undefined);

export function useDevicePreviewSession(): DevicePreviewSessionValue {
  const value = useContext(DevicePreviewSessionContext);
  if (value === undefined) {
    throw new Error(
      "useDevicePreviewSession must be used within DevicePreviewSessionProvider.",
    );
  }
  return value;
}
