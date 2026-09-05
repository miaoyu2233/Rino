import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const DEVICE_PREVIEW_EVENT_NAME = "rino://device-preview-snapshot";
export const DEVICE_PREVIEW_WINDOW_LABEL = "device-preview";
export const MAIN_WINDOW_LABEL = "main";

const MAXIMUM_PREVIEW_DIMENSION = 16_384;
const PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export const DEVICE_PREVIEW_PHASES = [
  "unavailable",
  "loadingDevices",
  "disconnected",
  "connecting",
  "ready",
  "capturing",
  "error",
] as const;

export type DevicePreviewPhase = (typeof DEVICE_PREVIEW_PHASES)[number];

/** The only state allowed across the native independent-preview bridge. */
export interface DevicePreviewWindowSnapshot {
  readonly generation: number;
  readonly phase: DevicePreviewPhase;
  readonly previewToken?: string;
  readonly width?: number;
  readonly height?: number;
  readonly interactionAvailable: boolean;
}

export interface DevicePreviewWindowBridge {
  readonly isAvailable: () => boolean;
  readonly open: () => Promise<void>;
  readonly publish: (snapshot: DevicePreviewWindowSnapshot) => Promise<void>;
  readonly current: () => Promise<DevicePreviewWindowSnapshot | undefined>;
  readonly close: () => Promise<void>;
  readonly focus: () => Promise<void>;
  readonly listen: (
    onSnapshot: (snapshot: DevicePreviewWindowSnapshot) => void,
  ) => Promise<UnlistenFn>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlySnapshotKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) =>
    [
      "generation",
      "phase",
      "previewToken",
      "width",
      "height",
      "interactionAvailable",
    ].includes(key),
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAXIMUM_PREVIEW_DIMENSION
  );
}

function isPreviewPhase(value: unknown): value is DevicePreviewPhase {
  return DEVICE_PREVIEW_PHASES.includes(value as DevicePreviewPhase);
}

/**
 * Strictly decodes native snapshot data. Unknown keys and malformed values are rejected,
 * so a future or compromised producer cannot widen the data reaching the preview UI.
 */
export function decodeDevicePreviewSnapshot(
  value: unknown,
): DevicePreviewWindowSnapshot | undefined {
  if (!isRecord(value) || !hasOnlySnapshotKeys(value)) {
    return undefined;
  }
  if (
    !isNonNegativeSafeInteger(value["generation"]) ||
    !isPreviewPhase(value["phase"]) ||
    typeof value["interactionAvailable"] !== "boolean"
  ) {
    return undefined;
  }

  const previewToken = value["previewToken"];
  if (
    previewToken !== undefined &&
    (typeof previewToken !== "string" ||
      !PREVIEW_TOKEN_PATTERN.test(previewToken))
  ) {
    return undefined;
  }

  const width = value["width"];
  const height = value["height"];
  if (
    (width !== undefined && !isBoundedDimension(width)) ||
    (height !== undefined && !isBoundedDimension(height)) ||
    (width === undefined) !== (height === undefined)
  ) {
    return undefined;
  }

  const baseSnapshot = {
    generation: value["generation"],
    phase: value["phase"],
    interactionAvailable: value["interactionAvailable"],
  } satisfies Omit<
    DevicePreviewWindowSnapshot,
    "previewToken" | "width" | "height"
  >;
  if (
    previewToken !== undefined &&
    width !== undefined &&
    height !== undefined
  ) {
    return { ...baseSnapshot, previewToken, width, height };
  }
  if (previewToken !== undefined) {
    return { ...baseSnapshot, previewToken };
  }
  if (width !== undefined && height !== undefined) {
    return { ...baseSnapshot, width, height };
  }
  return baseSnapshot;
}

function isQueryDevicePreviewWindow(): boolean {
  return new URLSearchParams(window.location.search).get("window") ===
    "device-preview";
}

/** Identifies the independent preview route without relying on a Tauri URL query. */
export function isDevicePreviewWindow(): boolean {
  if (!isTauri()) {
    return isQueryDevicePreviewWindow();
  }
  try {
    return getCurrentWindow().label === DEVICE_PREVIEW_WINDOW_LABEL;
  } catch {
    return isQueryDevicePreviewWindow();
  }
}

function isMainDesktopWindow(): boolean {
  if (!isTauri()) {
    return false;
  }
  try {
    return getCurrentWindow().label === MAIN_WINDOW_LABEL;
  } catch {
    return false;
  }
}

function decodeNativeSnapshot(value: unknown): DevicePreviewWindowSnapshot {
  const snapshot = decodeDevicePreviewSnapshot(value);
  if (snapshot === undefined) {
    throw new Error("The native device preview snapshot is invalid.");
  }
  return snapshot;
}

/** Creates the typed, least-privilege bridge used by the main preview session. */
export function createDevicePreviewWindowBridge(): DevicePreviewWindowBridge {
  return {
    isAvailable: isMainDesktopWindow,
    open: async () => {
      await invoke<unknown>("device_preview_open");
    },
    publish: async (snapshot) => {
      const safeSnapshot = decodeNativeSnapshot(snapshot);
      await invoke<unknown>("device_preview_publish", {
        snapshot: safeSnapshot,
      });
    },
    current: async () => {
      const value = await invoke<unknown>("device_preview_current");
      return value === null || value === undefined
        ? undefined
        : decodeNativeSnapshot(value);
    },
    close: async () => {
      await invoke<unknown>("device_preview_close");
    },
    focus: async () => {
      await invoke<unknown>("device_preview_focus");
    },
    listen: async (onSnapshot) =>
      listen<unknown>(DEVICE_PREVIEW_EVENT_NAME, ({ payload }) => {
        const snapshot = decodeDevicePreviewSnapshot(payload);
        if (snapshot !== undefined) {
          onSnapshot(snapshot);
        }
      }),
  };
}
