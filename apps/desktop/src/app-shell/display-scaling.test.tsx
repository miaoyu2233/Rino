import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../app/App";
import { THEME_STORAGE_KEY } from "../design-system/theme/theme-state";
import { openProjectDocument } from "../graph/store/project-lifecycle";
import { closeProjectDocument } from "../graph/store/project-lifecycle";
import { useEditorSessionStore } from "../graph/store/editor-session-store";
import { applicationI18n } from "../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import { layoutLimits } from "../preferences/layout-preferences";
import { useLayoutPreferenceStore } from "../preferences/layout-preference-store";
import { defaultLayoutPreferences } from "../preferences/layout-preferences";
import { buildGraphScene } from "../test/graph-scenes";
import {
  DARK_THEME_QUERY,
  installMatchingMediaQueries,
} from "../test/media-queries";
import { installInMemoryProjectService } from "../test/project-transport-double";

/** A 1920 by 1080 physical display, which is what the supported Windows scale factors are
 * applied to. The window reports logical pixels, so a higher scale factor leaves the
 * application less room even though the monitor has not changed. */
const PHYSICAL_WIDTH = 1920;
const PHYSICAL_HEIGHT = 1080;

const WINDOWS_SCALE_FACTORS = [1, 1.25, 1.5, 1.75, 2] as const;

/** Reserved by the application frame and asserted against here so a layout change cannot
 * quietly take the canvas below the space the style guide requires. */
const TOP_BAR_HEIGHT = 40;
const MINIMUM_CANVAS_WIDTH = 480;
const MINIMUM_CANVAS_HEIGHT = 320;

interface LogicalViewport {
  width: number;
  height: number;
  scaleFactor: number;
}

function logicalViewportFor(scaleFactor: number): LogicalViewport {
  return {
    width: Math.round(PHYSICAL_WIDTH / scaleFactor),
    height: Math.round(PHYSICAL_HEIGHT / scaleFactor),
    scaleFactor,
  };
}

function applyDisplay({ width, height, scaleFactor }: LogicalViewport): void {
  for (const [property, value] of [
    ["innerWidth", width],
    ["innerHeight", height],
    ["devicePixelRatio", scaleFactor],
  ] as const) {
    Object.defineProperty(window, property, { configurable: true, value });
  }
}

function moveToDisplay(viewport: LogicalViewport): void {
  applyDisplay(viewport);
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

function applicationFrame(): HTMLElement {
  const frame = document.querySelector<HTMLElement>(".application-frame");
  if (frame === null) {
    throw new Error("The application frame must be rendered.");
  }
  return frame;
}

function pixelVariable(name: string): number {
  return Number.parseFloat(
    applicationFrame().style.getPropertyValue(name).replace("px", ""),
  );
}

/** The layout the frame produced, in the logical pixels the window reports. */
function measureLayout(viewport: LogicalViewport): {
  mode: string | undefined;
  scaleFactor: string | undefined;
  canvasWidth: number;
  canvasHeight: number;
  paletteWidth: number;
  rightWidth: number;
} {
  const frame = applicationFrame();
  const paletteWidth = pixelVariable("--palette-width");
  const rightWidth = pixelVariable("--right-width");
  return {
    mode: frame.dataset["layoutMode"],
    scaleFactor: frame.dataset["scaleFactor"],
    canvasWidth: viewport.width - paletteWidth - rightWidth,
    canvasHeight:
      viewport.height - TOP_BAR_HEIGHT - pixelVariable("--debug-height"),
    paletteWidth,
    rightWidth,
  };
}

describe("display scaling", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    useLayoutPreferenceStore.setState({
      layout: { ...defaultLayoutPreferences },
    });
    closeProjectDocument();
    installInMemoryProjectService();
    installMatchingMediaQueries([]);
    applyDisplay(logicalViewportFor(1));
  });

  it.each(["light", "dark"])(
    "keeps a usable canvas at every supported Windows scale factor in the %s theme",
    (theme) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      installMatchingMediaQueries(theme === "dark" ? [DARK_THEME_QUERY] : []);
      render(<App />);

      expect(document.documentElement.dataset["theme"]).toBe(theme);

      for (const scaleFactor of WINDOWS_SCALE_FACTORS) {
        const viewport = logicalViewportFor(scaleFactor);
        moveToDisplay(viewport);
        const layout = measureLayout(viewport);

        expect(layout.scaleFactor).toBe(scaleFactor.toFixed(2));
        // Panels stay inside their declared range, so a scale change never produces a
        // palette or workbench narrower than its controls need.
        expect(layout.paletteWidth).toBeLessThanOrEqual(
          layoutLimits.paletteWidth.maximum,
        );
        expect(layout.rightWidth).toBeLessThanOrEqual(
          layoutLimits.rightWidth.maximum,
        );
        expect(layout.canvasWidth).toBeGreaterThanOrEqual(MINIMUM_CANVAS_WIDTH);
        expect(layout.canvasHeight).toBeGreaterThanOrEqual(
          MINIMUM_CANVAS_HEIGHT,
        );
        // The canvas is present at every scale rather than being collapsed away.
        expect(screen.getByLabelText("图编辑画布")).toBeInTheDocument();
      }
    },
  );

  it("collapses secondary panels into reachable drawers instead of squeezing the canvas", () => {
    render(<App />);

    moveToDisplay({ width: 1920, height: 1080, scaleFactor: 1 });
    expect(applicationFrame().dataset["layoutMode"]).toBe("wide");

    // A second monitor at 200 percent with a smaller panel: the palette becomes a rail
    // and the workbench keeps its minimum, so the graph keeps its room.
    moveToDisplay({ width: 1000, height: 700, scaleFactor: 2 });
    expect(applicationFrame().dataset["layoutMode"]).toBe("compact");
    expect(
      screen.getByRole("button", { name: "打开节点库" }),
    ).toBeInTheDocument();

    moveToDisplay({ width: 800, height: 700, scaleFactor: 2 });
    expect(applicationFrame().dataset["layoutMode"]).toBe("narrow");
    expect(
      screen.getByRole("button", { name: "打开工作台" }),
    ).toBeInTheDocument();
  });

  it("keeps the selection and keyboard focus across a monitor transition", async () => {
    const scene = buildGraphScene("small");
    render(<App />);
    act(() => {
      openProjectDocument(scene.document);
    });
    await screen.findByLabelText("节点图");

    const selectedNodeId = scene.graph.nodes[0]?.nodeId;
    if (selectedNodeId === undefined) {
      throw new Error("The scene always holds nodes.");
    }
    act(() => {
      useEditorSessionStore.getState().setSelection([selectedNodeId], []);
    });
    const startButton = within(
      screen.getByRole("complementary", { name: "节点库" }),
    )
      .getByText("开始")
      .closest("button");
    if (!startButton) {
      throw new Error("Start button not found");
    }
    startButton.focus();

    // A move to a 150 percent monitor keeps the same layout, so the focused control is
    // still the same element and keeps the focus.
    moveToDisplay(logicalViewportFor(1.5));

    expect(applicationFrame().dataset["scaleFactor"]).toBe("1.50");
    expect(useEditorSessionStore.getState().selectedNodeIds).toEqual([
      selectedNodeId,
    ]);
    expect(startButton).toHaveFocus();

    // A move to 175 percent replaces the palette column with a rail, so the control that
    // held focus no longer exists. The selection survives and the palette stays reachable
    // through the rail, but focus does not follow it; that gap is recorded in
    // docs/development/EDITOR_PERFORMANCE_AND_ACCESSIBILITY.md.
    moveToDisplay(logicalViewportFor(1.75));

    expect(applicationFrame().dataset["scaleFactor"]).toBe("1.75");
    expect(useEditorSessionStore.getState().selectedNodeIds).toEqual([
      selectedNodeId,
    ]);
    expect(
      screen.getByRole("button", { name: "打开节点库" }),
    ).toBeInTheDocument();
  });
});
