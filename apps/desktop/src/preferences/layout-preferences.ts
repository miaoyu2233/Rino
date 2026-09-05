import {
  normalizeFloatingWorkbenchGeometry,
  type FloatingWorkbenchGeometry,
} from "../app-shell/floating-workbench-geometry";

export const PREFERENCE_STORAGE_KEY = "rino.preferences.v1";
export const PREFERENCE_DOCUMENT_VERSION = 1;

export const layoutLimits = {
  paletteWidth: { minimum: 140, maximum: 360, default: 156 },
  rightWidth: { minimum: 280, maximum: 520, default: 328 },
  debugHeight: { minimum: 160, maximum: 720, default: 240 },
  previewRatio: { minimum: 0.3, maximum: 0.7, default: 0.55 },
} as const;

const LEGACY_DEFAULT_PALETTE_WIDTHS = [
  80, 100, 120, 140, 160, 180, 200, 224, 240, 264,
] as const;
const LEGACY_DEFAULT_RIGHT_WIDTH = 360;

export const debugPanelTabs = [
  "problems",
  "logs",
  "values",
  "ocr",
  "execution",
  "breakpoints",
] as const;

export const previewRefreshRates = [1, 2, 5, 10] as const;
export type PreviewRefreshRate = (typeof previewRefreshRates)[number];

export const uiRefreshRates = ["display", 60, 120, 180] as const;
export type UiRefreshRate = (typeof uiRefreshRates)[number];

export const performanceProfiles = [
  "responsive",
  "balanced",
  "efficiency",
] as const;
export type PerformanceProfile = (typeof performanceProfiles)[number];

export const canvasPerformanceProfiles: Record<
  PerformanceProfile,
  {
    visibleElementThreshold: number;
    wheelZoomSensitivity: number;
    suggestedPreviewRefreshFps: PreviewRefreshRate;
  }
> = {
  responsive: {
    visibleElementThreshold: 256,
    wheelZoomSensitivity: 1.35,
    suggestedPreviewRefreshFps: 10,
  },
  balanced: {
    visibleElementThreshold: 192,
    wheelZoomSensitivity: 1.1,
    suggestedPreviewRefreshFps: 5,
  },
  efficiency: {
    visibleElementThreshold: 128,
    wheelZoomSensitivity: 0.95,
    suggestedPreviewRefreshFps: 2,
  },
};

export type DebugPanelTab = (typeof debugPanelTabs)[number];
export type RightWorkbenchTab =
  "device" | "inspector" | "functions" | "variables";
export type RightWorkbenchMode = "docked" | "floating";

export interface LayoutPreferences {
  paletteWidth: number;
  rightWidth: number;
  rightWorkbenchMode: RightWorkbenchMode;
  rightWorkbenchGeometry: FloatingWorkbenchGeometry | null;
  debugHeight: number;
  previewRatio: number;
  paletteCollapsed: boolean;
  rightCollapsed: boolean;
  debugCollapsed: boolean;
  activeDebugTab: DebugPanelTab;
  activeRightTab: RightWorkbenchTab;
  previewRefreshFps: PreviewRefreshRate;
  uiRefreshRate: UiRefreshRate;
  performanceProfile: PerformanceProfile;
}

export interface PreferenceDocumentV1 {
  version: 1;
  layout: LayoutPreferences;
}

export const defaultLayoutPreferences: LayoutPreferences = {
  paletteWidth: layoutLimits.paletteWidth.default,
  rightWidth: layoutLimits.rightWidth.default,
  rightWorkbenchMode: "docked",
  rightWorkbenchGeometry: null,
  debugHeight: layoutLimits.debugHeight.default,
  previewRatio: layoutLimits.previewRatio.default,
  paletteCollapsed: false,
  rightCollapsed: false,
  debugCollapsed: false,
  activeDebugTab: "problems",
  activeRightTab: "device",
  previewRefreshFps: 5,
  uiRefreshRate: "display",
  performanceProfile: "responsive",
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function readBoundedNumber(
  value: unknown,
  limits: { readonly minimum: number; readonly maximum: number },
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, limits.minimum, limits.maximum)
    : fallback;
}

function readMigratedPanelWidth(
  value: unknown,
  legacyDefaults: readonly number[],
  limits: { readonly minimum: number; readonly maximum: number },
  fallback: number,
): number {
  return typeof value === "number" && legacyDefaults.includes(value)
    ? fallback
    : readBoundedNumber(value, limits, fallback);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDebugPanelTab(value: unknown): value is DebugPanelTab {
  return debugPanelTabs.some((tab) => tab === value);
}

function isRightWorkbenchTab(value: unknown): value is RightWorkbenchTab {
  return (
    value === "device" ||
    value === "inspector" ||
    value === "functions" ||
    value === "variables"
  );
}

function isRightWorkbenchMode(value: unknown): value is RightWorkbenchMode {
  return value === "docked" || value === "floating";
}

function isPreviewRefreshRate(value: unknown): value is PreviewRefreshRate {
  return previewRefreshRates.some((rate) => rate === value);
}

function isUiRefreshRate(value: unknown): value is UiRefreshRate {
  return uiRefreshRates.some((rate) => rate === value);
}

function isPerformanceProfile(value: unknown): value is PerformanceProfile {
  return performanceProfiles.some((profile) => profile === value);
}

export function normalizeLayoutPreferences(
  candidate: unknown,
): LayoutPreferences {
  if (!isRecord(candidate)) {
    return { ...defaultLayoutPreferences };
  }

  return {
    paletteWidth: readMigratedPanelWidth(
      candidate["paletteWidth"],
      LEGACY_DEFAULT_PALETTE_WIDTHS,
      layoutLimits.paletteWidth,
      defaultLayoutPreferences.paletteWidth,
    ),
    rightWidth: readMigratedPanelWidth(
      candidate["rightWidth"],
      [LEGACY_DEFAULT_RIGHT_WIDTH],
      layoutLimits.rightWidth,
      defaultLayoutPreferences.rightWidth,
    ),
    rightWorkbenchMode: isRightWorkbenchMode(candidate["rightWorkbenchMode"])
      ? candidate["rightWorkbenchMode"]
      : defaultLayoutPreferences.rightWorkbenchMode,
    rightWorkbenchGeometry:
      candidate["rightWorkbenchMode"] === "floating"
        ? normalizeFloatingWorkbenchGeometry(
            candidate["rightWorkbenchGeometry"],
          )
        : defaultLayoutPreferences.rightWorkbenchGeometry,
    debugHeight: readBoundedNumber(
      candidate["debugHeight"],
      layoutLimits.debugHeight,
      defaultLayoutPreferences.debugHeight,
    ),
    previewRatio: readBoundedNumber(
      candidate["previewRatio"],
      layoutLimits.previewRatio,
      defaultLayoutPreferences.previewRatio,
    ),
    paletteCollapsed: readBoolean(
      candidate["paletteCollapsed"],
      defaultLayoutPreferences.paletteCollapsed,
    ),
    rightCollapsed: readBoolean(
      candidate["rightCollapsed"],
      defaultLayoutPreferences.rightCollapsed,
    ),
    debugCollapsed: readBoolean(
      candidate["debugCollapsed"],
      defaultLayoutPreferences.debugCollapsed,
    ),
    activeDebugTab: isDebugPanelTab(candidate["activeDebugTab"])
      ? candidate["activeDebugTab"]
      : defaultLayoutPreferences.activeDebugTab,
    activeRightTab: isRightWorkbenchTab(candidate["activeRightTab"])
      ? candidate["activeRightTab"]
      : defaultLayoutPreferences.activeRightTab,
    previewRefreshFps: isPreviewRefreshRate(candidate["previewRefreshFps"])
      ? candidate["previewRefreshFps"]
      : defaultLayoutPreferences.previewRefreshFps,
    uiRefreshRate: isUiRefreshRate(candidate["uiRefreshRate"])
      ? candidate["uiRefreshRate"]
      : defaultLayoutPreferences.uiRefreshRate,
    performanceProfile: isPerformanceProfile(candidate["performanceProfile"])
      ? candidate["performanceProfile"]
      : defaultLayoutPreferences.performanceProfile,
  };
}

export function parsePreferenceDocument(
  serializedDocument: string | null,
): PreferenceDocumentV1 {
  if (serializedDocument === null) {
    return createPreferenceDocument(defaultLayoutPreferences);
  }

  try {
    const candidate: unknown = JSON.parse(serializedDocument);
    if (
      !isRecord(candidate) ||
      candidate["version"] !== PREFERENCE_DOCUMENT_VERSION
    ) {
      return createPreferenceDocument(defaultLayoutPreferences);
    }

    return createPreferenceDocument(
      normalizeLayoutPreferences(candidate["layout"]),
    );
  } catch {
    return createPreferenceDocument(defaultLayoutPreferences);
  }
}

export function createPreferenceDocument(
  layout: LayoutPreferences,
): PreferenceDocumentV1 {
  return {
    version: PREFERENCE_DOCUMENT_VERSION,
    layout: normalizeLayoutPreferences(layout),
  };
}
export function restoreDockedRightWorkbench(
  layout: LayoutPreferences,
): LayoutPreferences {
  return {
    ...layout,
    rightWorkbenchMode: "docked",
    rightWorkbenchGeometry: null,
  };
}

export function calculateDebugPanelHeight(
  preferredHeight: number,
  viewportHeight: number,
): number {
  const maximumForViewport = Math.max(
    0,
    Math.min(layoutLimits.debugHeight.maximum, viewportHeight / 2),
  );

  return maximumForViewport < layoutLimits.debugHeight.minimum
    ? maximumForViewport
    : clamp(
        preferredHeight,
        layoutLimits.debugHeight.minimum,
        maximumForViewport,
      );
}
