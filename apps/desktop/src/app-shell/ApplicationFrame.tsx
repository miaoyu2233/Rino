import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { Dialog, DialogContent } from "../components/ui/Dialog";
import { FeatureErrorBoundary } from "../diagnostics/FeatureErrorBoundary";
import { useProjectAutosave } from "../graph/project/useProjectAutosave";
import { useProjectCommands } from "../graph/project/useProjectCommands";
import { useGraphExecution } from "../ipc/useGraphExecution";
import { NotificationRegion } from "../diagnostics/NotificationRegion";
import {
  applyExternalLayoutPreference,
  flushLayoutPersistence,
  useLayoutPreferenceStore,
} from "../preferences/layout-preference-store";
import {
  calculateDebugPanelHeight,
  layoutLimits,
  PREFERENCE_STORAGE_KEY,
  restoreDockedRightWorkbench,
  type DebugPanelTab,
  type RightWorkbenchTab,
} from "../preferences/layout-preferences";
import { useWindowMetrics } from "../platform/useWindowMetrics";
import { PackagePublishingDialog } from "../publishing/PackagePublishingDialog";
import { CanvasWorkspace } from "./CanvasWorkspace";
import { DebugPanel } from "./DebugPanel";
import {
  FloatingWorkbenchPanel,
  WorkbenchContextMenu,
} from "./FloatingWorkbenchPanel";
import {
  constrainFloatingWorkbenchGeometry,
  defaultFloatingWorkbenchGeometry,
} from "./floating-workbench-geometry";
import { IconAction } from "./IconAction";
import { resolveApplicationLayoutMode } from "./layout-mode";
import { NodePalette } from "./NodePalette";
import { ProjectDialogs } from "./ProjectDialogs";
import { ResizeHandle } from "./ResizeHandle";
import { RightWorkbench } from "./RightWorkbench";
import { SettingsDialog } from "./SettingsDialog";
import { resolveAvailableShortcut } from "./shortcut-registry";
import { TopApplicationBar } from "./TopApplicationBar";
import "./application-frame.css";

const TOP_BAR_HEIGHT = 48;
const MINIMUM_CANVAS_HEIGHT = 320;
const COLLAPSED_PANEL_SIZE = 48;
const COLLAPSED_DEBUG_HEIGHT = 36;

type ApplicationFrameStyle = CSSProperties & {
  "--palette-width": string;
  "--right-width": string;
  "--debug-height": string;
};

function rememberCurrentFocus(targetRef: RefObject<HTMLElement | null>): void {
  targetRef.current =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
}

export function ApplicationFrame() {
  const { t } = useTranslation();
  const metrics = useWindowMetrics();
  const projectCommands = useProjectCommands();
  const execution = useGraphExecution();
  const { cancelRun, canCancel, canRun, runGraph } = execution;
  useProjectAutosave();
  const layoutMode = resolveApplicationLayoutMode(metrics.width);
  const layout = useLayoutPreferenceStore((state) => state.layout);
  const updateLayout = useLayoutPreferenceStore((state) => state.updateLayout);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const paletteReturnFocusRef = useRef<HTMLElement | null>(null);
  const workbenchReturnFocusRef = useRef<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteDrawerOpen, setPaletteDrawerOpen] = useState(false);
  const [workbenchDrawerOpen, setWorkbenchDrawerOpen] = useState(false);
  const [publishingOpen, setPublishingOpen] = useState(false);

  const maximumDebugHeight = Math.max(
    0,
    metrics.height - TOP_BAR_HEIGHT - MINIMUM_CANVAS_HEIGHT,
  );
  const debugPanelCannotFit =
    maximumDebugHeight < layoutLimits.debugHeight.minimum;
  const debugCollapsed = layout.debugCollapsed || debugPanelCannotFit;
  const debugHeight = debugCollapsed
    ? COLLAPSED_DEBUG_HEIGHT
    : Math.min(
        calculateDebugPanelHeight(layout.debugHeight, metrics.height),
        maximumDebugHeight,
      );
  const workbenchHeight = Math.max(
    1,
    metrics.height - TOP_BAR_HEIGHT - debugHeight,
  );

  const paletteColumnWidth =
    layoutMode === "wide"
      ? layout.paletteCollapsed
        ? 0
        : layout.paletteWidth
      : layoutMode === "compact"
        ? COLLAPSED_PANEL_SIZE
        : 0;
  const rightColumnWidth =
    layoutMode === "narrow"
      ? 0
      : layoutMode === "wide" && layout.rightWorkbenchMode === "floating"
        ? COLLAPSED_PANEL_SIZE
        : layout.rightCollapsed
          ? COLLAPSED_PANEL_SIZE
          : layoutMode === "compact"
            ? Math.max(layoutLimits.rightWidth.minimum, layout.rightWidth)
            : layout.rightWidth;

  const frameStyle = useMemo<ApplicationFrameStyle>(
    () => ({
      "--palette-width": `${String(paletteColumnWidth)}px`,
      "--right-width": `${String(rightColumnWidth)}px`,
      "--debug-height": `${String(debugHeight)}px`,
    }),
    [debugHeight, paletteColumnWidth, rightColumnWidth],
  );

  const openSettings = useCallback(() => {
    rememberCurrentFocus(settingsReturnFocusRef);
    setSettingsOpen(true);
  }, []);

  const openPaletteDrawer = useCallback(() => {
    rememberCurrentFocus(paletteReturnFocusRef);
    setPaletteDrawerOpen(true);
  }, []);

  const openWorkbenchDrawer = useCallback(() => {
    rememberCurrentFocus(workbenchReturnFocusRef);
    setWorkbenchDrawerOpen(true);
  }, []);

  const focusPaletteSearch = useCallback(() => {
    if (layoutMode !== "wide" || layout.paletteCollapsed) {
      openPaletteDrawer();
    }
  }, [layout.paletteCollapsed, layoutMode, openPaletteDrawer]);

  const focusDeviceWorkbench = useCallback(() => {
    updateLayout({ activeRightTab: "device", rightCollapsed: false });
    if (layoutMode === "narrow") {
      openWorkbenchDrawer();
    }
  }, [layoutMode, openWorkbenchDrawer, updateLayout]);

  const handleRailTabClick = useCallback(
    (tab: RightWorkbenchTab) => {
      if (layoutMode === "wide" && layout.rightWorkbenchMode === "floating") {
        updateLayout({ activeRightTab: tab, rightCollapsed: false });
      } else if (layout.rightCollapsed) {
        updateLayout({ activeRightTab: tab, rightCollapsed: false });
      } else if (layout.activeRightTab === tab) {
        updateLayout({ rightCollapsed: true });
      } else {
        updateLayout({ activeRightTab: tab });
      }
    },
    [
      layout.activeRightTab,
      layout.rightCollapsed,
      layout.rightWorkbenchMode,
      layoutMode,
      updateLayout,
    ],
  );

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PREFERENCE_STORAGE_KEY) {
        applyExternalLayoutPreference(event.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("pagehide", flushLayoutPersistence);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pagehide", flushLayoutPersistence);
      flushLayoutPersistence();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveAvailableShortcut(event);
      if (shortcut === null) {
        return;
      }

      event.preventDefault();
      switch (shortcut) {
        case "openReference":
          openSettings();
          break;
        case "focusPalette":
          focusPaletteSearch();
          break;
        case "focusDevice":
          focusDeviceWorkbench();
          break;
        case "save":
          projectCommands.save();
          break;
        case "saveAs":
          projectCommands.saveAs();
          break;
        case "run":
          if (canRun) {
            void runGraph();
          }
          break;
        case "stop":
          if (canCancel) {
            void cancelRun();
          }
          break;
        default: {
          const unhandled: never = shortcut;
          return unhandled;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    canCancel,
    canRun,
    cancelRun,
    focusDeviceWorkbench,
    focusPaletteSearch,
    openSettings,
    projectCommands,
    runGraph,
  ]);

  const setRightTab = useCallback(
    (activeRightTab: RightWorkbenchTab) => {
      updateLayout({ activeRightTab });
    },
    [updateLayout],
  );

  const collapsePalette = useCallback(() => {
    updateLayout({ paletteCollapsed: true });
  }, [updateLayout]);

  const expandPalette = useCallback(() => {
    updateLayout({ paletteCollapsed: false });
  }, [updateLayout]);

  const resizePalette = useCallback(
    (delta: number) => {
      updateLayout({ paletteWidth: layout.paletteWidth + delta });
    },
    [layout.paletteWidth, updateLayout],
  );

  const collapseWorkbench = useCallback(() => {
    updateLayout({ rightCollapsed: true });
  }, [updateLayout]);

  const floatWorkbench = useCallback(() => {
    const geometry = constrainFloatingWorkbenchGeometry(
      layout.rightWorkbenchGeometry ?? defaultFloatingWorkbenchGeometry,
      { width: metrics.width, height: metrics.height },
    );
    updateLayout({
      rightCollapsed: false,
      rightWorkbenchMode: "floating",
      rightWorkbenchGeometry: geometry,
    });
  }, [
    layout.rightWorkbenchGeometry,
    metrics.height,
    metrics.width,
    updateLayout,
  ]);

  const dockWorkbench = useCallback(() => {
    updateLayout(restoreDockedRightWorkbench(layout));
  }, [layout, updateLayout]);

  const commitFloatingGeometry = useCallback(
    (geometry: Parameters<typeof constrainFloatingWorkbenchGeometry>[0]) => {
      updateLayout({
        rightCollapsed: false,
        rightWorkbenchMode: "floating",
        rightWorkbenchGeometry: geometry,
      });
    },
    [updateLayout],
  );

  const resizeWorkbench = useCallback(
    (delta: number) => {
      updateLayout({ rightWidth: layout.rightWidth - delta });
    },
    [layout.rightWidth, updateLayout],
  );

  const resizePreviewRatio = useCallback(
    (delta: number) => {
      updateLayout({
        previewRatio: layout.previewRatio + delta / workbenchHeight,
      });
    },
    [layout.previewRatio, updateLayout, workbenchHeight],
  );

  const resizeDebugPanel = useCallback(
    (delta: number) => {
      updateLayout({ debugHeight: layout.debugHeight - delta });
    },
    [layout.debugHeight, updateLayout],
  );

  const setDebugTab = useCallback(
    (activeDebugTab: DebugPanelTab) => {
      updateLayout({ activeDebugTab });
    },
    [updateLayout],
  );

  const setDebugCollapsed = useCallback(
    (collapsed: boolean) => {
      updateLayout({ debugCollapsed: collapsed });
    },
    [updateLayout],
  );

  const keepPreviewRatio = useCallback(() => {
    // The drawer presentation has no divider to drag, so the ratio stays as authored.
  }, []);

  const palettePanel = <NodePalette />;

  return (
    <>
      <div
        className={`application-frame application-frame--${layoutMode}`}
        style={frameStyle}
        data-layout-mode={layoutMode}
        data-performance-profile={layout.performanceProfile}
        data-scale-factor={metrics.scaleFactor.toFixed(2)}
      >
        <TopApplicationBar
          execution={execution}
          projectCommands={projectCommands}
          showCompactPanels={layoutMode === "narrow"}
          onOpenPalette={openPaletteDrawer}
          onOpenPublishing={() => {
            setPublishingOpen(true);
          }}
          onOpenWorkbench={openWorkbenchDrawer}
          onOpenSettings={openSettings}
        />

        <div className="application-frame__workspace">
          {layoutMode === "wide" ? (
            <section
              className="application-frame__palette-column"
              aria-label={t("shell.palette.regionLabel")}
              data-collapsed={layout.paletteCollapsed}
            >
              <FeatureErrorBoundary feature="palette">
                <NodePalette
                  collapsed={layout.paletteCollapsed}
                  onCollapse={collapsePalette}
                  onExpand={expandPalette}
                />
              </FeatureErrorBoundary>
              {layout.paletteCollapsed ? null : (
                <ResizeHandle
                  axis="horizontal"
                  ariaLabel={t("shell.resize.palette")}
                  minimum={layoutLimits.paletteWidth.minimum}
                  maximum={layoutLimits.paletteWidth.maximum}
                  value={layout.paletteWidth}
                  onChange={resizePalette}
                />
              )}
            </section>
          ) : layoutMode === "compact" ? (
            <aside className="panel-rail" aria-label={t("shell.palette.title")}>
              <IconAction
                icon="panel.palette"
                label={t("shell.palette.open")}
                onClick={openPaletteDrawer}
              />
            </aside>
          ) : null}

          <div className="application-frame__center-column">
            <FeatureErrorBoundary feature="canvas">
              <CanvasWorkspace projectCommands={projectCommands} />
            </FeatureErrorBoundary>

            <section
              className="debug-panel-shell"
              aria-label={t("shell.debug.title")}
            >
              {debugCollapsed ? null : (
                <ResizeHandle
                  axis="vertical"
                  ariaLabel={t("shell.resize.debug")}
                  minimum={layoutLimits.debugHeight.minimum}
                  maximum={Math.min(
                    layoutLimits.debugHeight.maximum,
                    maximumDebugHeight,
                  )}
                  value={debugHeight}
                  onChange={resizeDebugPanel}
                />
              )}
              <FeatureErrorBoundary feature="debug">
                <DebugPanel
                  activeTab={layout.activeDebugTab}
                  collapsed={debugCollapsed}
                  onActiveTabChange={setDebugTab}
                  onCollapsedChange={setDebugCollapsed}
                />
              </FeatureErrorBoundary>
            </section>
          </div>

          {layoutMode === "narrow" ? null : (
            <section
              className="application-frame__right-column"
              aria-label={t("shell.workbench.regionLabel")}
              data-collapsed={
                layout.rightCollapsed ||
                (layoutMode === "wide" &&
                  layout.rightWorkbenchMode === "floating")
              }
            >
              {layout.rightCollapsed ||
              (layoutMode === "wide" &&
                layout.rightWorkbenchMode === "floating") ? null : (
                <>
                  <ResizeHandle
                    axis="horizontal"
                    ariaLabel={t("shell.resize.workbench")}
                    minimum={layoutLimits.rightWidth.minimum}
                    maximum={layoutLimits.rightWidth.maximum}
                    value={layout.rightWidth}
                    onChange={resizeWorkbench}
                  />
                  <FeatureErrorBoundary feature="workbench">
                    <WorkbenchContextMenu
                      mode="docked"
                      onFloat={
                        layoutMode === "wide" ? floatWorkbench : undefined
                      }
                    >
                      <RightWorkbench
                        activeTab={layout.activeRightTab}
                        metrics={metrics}
                        previewRatio={layout.previewRatio}
                        onActiveTabChange={setRightTab}
                        onCollapse={collapseWorkbench}
                        onPreviewRatioChange={resizePreviewRatio}
                      />
                    </WorkbenchContextMenu>
                  </FeatureErrorBoundary>
                </>
              )}
              <aside
                className="panel-rail"
                aria-label={t("shell.workbench.open")}
              >
                <IconAction
                  active={
                    !layout.rightCollapsed && layout.activeRightTab === "device"
                  }
                  icon="panel.device"
                  label={t("shell.workbench.title")}
                  onClick={() => {
                    handleRailTabClick("device");
                  }}
                />
                <IconAction
                  active={
                    !layout.rightCollapsed &&
                    layout.activeRightTab === "inspector"
                  }
                  icon="panel.inspector"
                  label={t("shell.workbench.inspector")}
                  onClick={() => {
                    handleRailTabClick("inspector");
                  }}
                />
                <IconAction
                  active={
                    !layout.rightCollapsed &&
                    layout.activeRightTab === "functions"
                  }
                  icon="node.variable"
                  label={t("shell.workbench.functions")}
                  onClick={() => {
                    handleRailTabClick("functions");
                  }}
                />
                <IconAction
                  active={
                    !layout.rightCollapsed &&
                    layout.activeRightTab === "variables"
                  }
                  icon="panel.values"
                  label={t("shell.workbench.variables")}
                  onClick={() => {
                    handleRailTabClick("variables");
                  }}
                />
              </aside>
            </section>
          )}
        </div>

        {layoutMode === "wide" && layout.rightWorkbenchMode === "floating" ? (
          <FloatingWorkbenchPanel
            activeTab={layout.activeRightTab}
            geometry={
              layout.rightWorkbenchGeometry ?? defaultFloatingWorkbenchGeometry
            }
            metrics={metrics}
            onActiveTabChange={setRightTab}
            onDock={dockWorkbench}
            onGeometryCommit={commitFloatingGeometry}
            onPreviewRatioChange={resizePreviewRatio}
            previewRatio={layout.previewRatio}
          />
        ) : null}
      </div>

      <NotificationRegion />

      <ProjectDialogs commands={projectCommands} />

      {publishingOpen ? (
        <PackagePublishingDialog open onOpenChange={setPublishingOpen} />
      ) : null}

      <Dialog open={paletteDrawerOpen} onOpenChange={setPaletteDrawerOpen}>
        <DialogContent
          className="application-drawer application-drawer--left"
          closeLabel={t("common.actions.close")}
          title={t("shell.palette.title")}
          description={t("shell.palette.emptyDescription")}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            paletteReturnFocusRef.current?.focus();
          }}
        >
          {palettePanel}
        </DialogContent>
      </Dialog>

      <Dialog open={workbenchDrawerOpen} onOpenChange={setWorkbenchDrawerOpen}>
        <DialogContent
          className="application-drawer application-drawer--right"
          closeLabel={t("common.actions.close")}
          title={t("shell.workbench.title")}
          description={t("shell.device.disconnectedDescription")}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            workbenchReturnFocusRef.current?.focus();
          }}
        >
          <RightWorkbench
            tabbed
            activeTab={layout.activeRightTab}
            metrics={metrics}
            previewRatio={layout.previewRatio}
            onActiveTabChange={setRightTab}
            onPreviewRatioChange={keepPreviewRatio}
          />
        </DialogContent>
      </Dialog>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        restoreFocus={() => settingsReturnFocusRef.current?.focus()}
      />
    </>
  );
}
