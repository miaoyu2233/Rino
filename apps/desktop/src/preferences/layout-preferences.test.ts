import { describe, expect, it } from "vitest";

import {
  canvasPerformanceProfiles,
  calculateDebugPanelHeight,
  defaultLayoutPreferences,
  parsePreferenceDocument,
  restoreDockedRightWorkbench,
} from "./layout-preferences";

describe("layout preferences", () => {
  it("uses safe defaults for absent or malformed documents", () => {
    expect(parsePreferenceDocument(null).layout).toEqual(
      defaultLayoutPreferences,
    );
    expect(parsePreferenceDocument("not json").layout).toEqual(
      defaultLayoutPreferences,
    );
    expect(parsePreferenceDocument('{"version":2}').layout).toEqual(
      defaultLayoutPreferences,
    );
  });

  it("validates enums and clamps numeric values", () => {
    const document = parsePreferenceDocument(
      JSON.stringify({
        version: 1,
        layout: {
          paletteWidth: 9,
          rightWidth: 900,
          debugHeight: 300,
          previewRatio: 0.6,
          paletteCollapsed: true,
          rightCollapsed: "yes",
          debugCollapsed: false,
          activeDebugTab: "logs",
          activeRightTab: "unknown",
        },
      }),
    );

    expect(document.layout).toMatchObject({
      paletteWidth: 156,
      rightWidth: 520,
      debugHeight: 300,
      previewRatio: 0.6,
      paletteCollapsed: true,
      rightCollapsed: false,
      debugCollapsed: false,
      activeDebugTab: "logs",
      activeRightTab: "device",
      previewRefreshFps: 5,
      performanceProfile: "responsive",
    });
  });

  it("preserves the functions tab and legacy right-workbench tabs", () => {
    for (const activeRightTab of [
      "device",
      "inspector",
      "functions",
      "variables",
    ] as const) {
      const document = parsePreferenceDocument(
        JSON.stringify({
          version: 1,
          layout: { ...defaultLayoutPreferences, activeRightTab },
        }),
      );
      expect(document.layout.activeRightTab).toBe(activeRightTab);
    }
  });

  it("persists only supported preview refresh rates", () => {
    const supported = parsePreferenceDocument(
      JSON.stringify({
        version: 1,
        layout: {
          ...defaultLayoutPreferences,
          previewRefreshFps: 10,
        },
      }),
    );
    const unsupported = parsePreferenceDocument(
      JSON.stringify({
        version: 1,
        layout: {
          ...defaultLayoutPreferences,
          previewRefreshFps: 60,
        },
      }),
    );

    expect(supported.layout.previewRefreshFps).toBe(10);
    expect(unsupported.layout.previewRefreshFps).toBe(5);
  });

  it("defaults the UI animation rate to the display and preserves supported values", () => {
    const missing = parsePreferenceDocument(
      JSON.stringify({ version: 1, layout: { ...defaultLayoutPreferences } }),
    );
    const supported = [60, 120, 180] as const;

    expect(missing.layout.uiRefreshRate).toBe("display");
    for (const rate of supported) {
      const document = parsePreferenceDocument(
        JSON.stringify({
          version: 1,
          layout: { ...defaultLayoutPreferences, uiRefreshRate: rate },
        }),
      );
      expect(document.layout.uiRefreshRate).toBe(rate);
      expect(document.layout.previewRefreshFps).toBe(
        defaultLayoutPreferences.previewRefreshFps,
      );
    }
  });

  it("falls back to the display for invalid UI animation rates without clearing preferences", () => {
    for (const invalidRate of [144, "60"]) {
      const document = parsePreferenceDocument(
        JSON.stringify({
          version: 1,
          layout: {
            ...defaultLayoutPreferences,
            paletteWidth: 300,
            uiRefreshRate: invalidRate,
          },
        }),
      );
      expect(document.layout.uiRefreshRate).toBe("display");
      expect(document.layout.paletteWidth).toBe(300);
    }
  });

  it("persists only supported performance profiles", () => {
    const supported = parsePreferenceDocument(
      JSON.stringify({
        version: 1,
        layout: {
          ...defaultLayoutPreferences,
          performanceProfile: "efficiency",
        },
      }),
    );
    const unsupported = parsePreferenceDocument(
      JSON.stringify({
        version: 1,
        layout: {
          ...defaultLayoutPreferences,
          performanceProfile: "unbounded",
        },
      }),
    );

    expect(supported.layout.performanceProfile).toBe("efficiency");
    expect(unsupported.layout.performanceProfile).toBe("responsive");
  });

  it("keeps virtualization for genuinely large graphs", () => {
    expect(canvasPerformanceProfiles).toMatchObject({
      responsive: { visibleElementThreshold: 256 },
      balanced: { visibleElementThreshold: 192 },
      efficiency: { visibleElementThreshold: 128 },
    });
    expect(
      Object.values(canvasPerformanceProfiles).every(
        (profile) => profile.visibleElementThreshold >= 128,
      ),
    ).toBe(true);
  });

  it("migrates only the former default panel widths to the denser layout", () => {
    const migrated = parsePreferenceDocument(
      JSON.stringify({
        version: 1,
        layout: {
          ...defaultLayoutPreferences,
          paletteWidth: 240,
          rightWidth: 360,
        },
      }),
    );
    const customized = parsePreferenceDocument(
      JSON.stringify({
        version: 1,
        layout: {
          ...defaultLayoutPreferences,
          paletteWidth: 280,
          rightWidth: 400,
        },
      }),
    );

    expect(migrated.layout.paletteWidth).toBe(156);
    expect(migrated.layout.rightWidth).toBe(328);
    expect(customized.layout.paletteWidth).toBe(280);
    expect(customized.layout.rightWidth).toBe(400);
  });

  it("keeps the debug panel within half the viewport", () => {
    expect(calculateDebugPanelHeight(500, 800)).toBe(400);
    expect(calculateDebugPanelHeight(100, 800)).toBe(160);
  });
  it("migrates layouts without floating fields to docked mode", () => {
    const document = parsePreferenceDocument(
      JSON.stringify({
        version: 1,
        layout: { rightWidth: 400, activeRightTab: "functions" },
      }),
    );

    expect(document.layout.rightWorkbenchMode).toBe("docked");
    expect(document.layout.rightWorkbenchGeometry).toBeNull();
    expect(document.layout.rightWidth).toBe(400);
    expect(document.layout.activeRightTab).toBe("functions");
  });

  it("normalizes floating geometry and rejects an invalid mode", () => {
    const normalized = parsePreferenceDocument(
      JSON.stringify({
        version: 1,
        layout: {
          rightWorkbenchMode: "floating",
          rightWorkbenchGeometry: {
            x: -20,
            y: 100_001,
            width: 9_999,
            height: -1,
          },
        },
      }),
    );
    expect(normalized.layout.rightWorkbenchMode).toBe("floating");
    expect(normalized.layout.rightWorkbenchGeometry).toEqual({
      x: 0,
      y: 100_000,
      width: 720,
      height: 240,
    });

    const invalid = parsePreferenceDocument(
      JSON.stringify({
        version: 1,
        layout: {
          rightWorkbenchMode: "undocked",
          rightWorkbenchGeometry: {
            x: 10,
            y: 20,
            width: 400,
            height: 300,
          },
        },
      }),
    );
    expect(invalid.layout.rightWorkbenchMode).toBe("docked");
    expect(invalid.layout.rightWorkbenchGeometry).toBeNull();
  });

  it("restores docked mode without changing the active tab or dock width", () => {
    const restored = restoreDockedRightWorkbench({
      ...defaultLayoutPreferences,
      rightWidth: 401,
      activeRightTab: "variables",
      rightWorkbenchMode: "floating",
      rightWorkbenchGeometry: { x: 90, y: 100, width: 400, height: 500 },
    });

    expect(restored).toMatchObject({
      rightWorkbenchMode: "docked",
      rightWorkbenchGeometry: null,
      rightWidth: 401,
      activeRightTab: "variables",
    });
  });
});
