import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { ScrollArea } from "../components/ui/ScrollArea";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import type { ProductIconKey } from "../design-system/icons/product-icons";
import type { LocalizationKey } from "../diagnostics/diagnostic-model";
import { notify } from "../diagnostics/diagnostic-store";
import { visibleCanvasCenter } from "../graph/canvas/canvas-viewport-store";
import { insertPaletteEntry } from "../graph/palette/insert-entry";
import { PaletteEntryButton } from "../graph/palette/PaletteEntryButton";
import {
  capabilityState,
  groupPaletteEntries,
  type PaletteCategory,
  type PaletteEntry,
} from "../graph/palette/palette-model";
import { usePaletteCatalog } from "../graph/palette/usePaletteCatalog";
import { useDocumentStore } from "../graph/store/document-store";
import { EmptyState } from "./EmptyState";
import { IconAction } from "./IconAction";

export interface NodePaletteProps {
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
}

const categoryLabelKeys: Record<PaletteCategory, LocalizationKey> = {
  common: "graph.palette.category.common",
  flow: "graph.palette.category.flow",
  logic: "graph.palette.category.logic",
  values: "graph.palette.category.values",
  text: "graph.palette.category.text",
  vision: "graph.palette.category.vision",
  device: "graph.palette.category.device",
  timing: "graph.palette.category.timing",
  diagnostics: "graph.palette.category.diagnostics",
  templates: "graph.palette.category.templates",
};

const categoryIcons: Record<PaletteCategory, ProductIconKey> = {
  common: "action.gridView",
  flow: "category.flow",
  logic: "category.logic",
  values: "category.data",
  text: "node.text",
  vision: "category.recognition",
  device: "panel.device",
  timing: "node.delay",
  diagnostics: "node.log",
  templates: "category.templates",
};

const PaletteFlyoutWidth = 260;
const PaletteFlyoutMargin = 8;
const PaletteFlyoutCloseDelayMs = 140;

interface PaletteFlyoutPosition {
  left: number;
  top: number;
  maxHeight: number;
}

function flyoutPosition(anchor: HTMLElement): PaletteFlyoutPosition {
  const bounds = anchor.getBoundingClientRect();
  const availableHeight = Math.max(
    160,
    window.innerHeight - PaletteFlyoutMargin * 2,
  );
  const maxHeight = Math.min(availableHeight, 560);
  const top = Math.min(
    Math.max(PaletteFlyoutMargin, bounds.top),
    Math.max(
      PaletteFlyoutMargin,
      window.innerHeight - maxHeight - PaletteFlyoutMargin,
    ),
  );
  const opensLeft =
    bounds.right + PaletteFlyoutMargin + PaletteFlyoutWidth > window.innerWidth;
  const left = opensLeft
    ? Math.max(
        PaletteFlyoutMargin,
        bounds.left - PaletteFlyoutWidth - PaletteFlyoutMargin,
      )
    : bounds.right + PaletteFlyoutMargin;

  return { left, top, maxHeight };
}

export function NodePalette({
  collapsed = false,
  onCollapse,
  onExpand,
}: NodePaletteProps) {
  const { t } = useTranslation();
  const catalog = usePaletteCatalog();
  const projectOpen = useDocumentStore((store) => store.history !== undefined);
  const [activeCategory, setActiveCategory] = useState<PaletteCategory>();
  const [flyout, setFlyout] = useState<PaletteFlyoutPosition>();
  const activeAnchorRef = useRef<HTMLButtonElement | null>(null);
  const flyoutRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const groups = useMemo(() => {
    if (!catalog) {
      return [];
    }
    return groupPaletteEntries(catalog.entries);
  }, [catalog]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.category === activeCategory),
    [activeCategory, groups],
  );

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current === undefined) {
      return;
    }
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);

  const closeFlyout = useCallback(() => {
    cancelScheduledClose();
    setActiveCategory(undefined);
    setFlyout(undefined);
  }, [cancelScheduledClose]);

  const scheduleClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(closeFlyout, PaletteFlyoutCloseDelayMs);
  }, [cancelScheduledClose, closeFlyout]);

  const openFlyout = useCallback(
    (category: PaletteCategory, anchor: HTMLButtonElement) => {
      cancelScheduledClose();
      activeAnchorRef.current = anchor;
      setActiveCategory(category);
      setFlyout(flyoutPosition(anchor));
    },
    [cancelScheduledClose],
  );

  useEffect(() => {
    return cancelScheduledClose;
  }, [cancelScheduledClose]);

  useEffect(() => {
    if (activeCategory === undefined) {
      return;
    }

    const closeForResize = () => {
      closeFlyout();
    };
    const closeForOutsideScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && flyoutRef.current?.contains(target)) {
        return;
      }
      closeFlyout();
    };
    window.addEventListener("resize", closeForResize);
    document.addEventListener("scroll", closeForOutsideScroll, true);
    return () => {
      window.removeEventListener("resize", closeForResize);
      document.removeEventListener("scroll", closeForOutsideScroll, true);
    };
  }, [activeCategory, closeFlyout]);

  const reportProjectRequired = useCallback(() => {
    notify({
      severity: "info",
      titleKey: "graph.palette.projectRequired",
    });
  }, []);

  const activate = useCallback(
    (entry: PaletteEntry) => {
      const outcome = insertPaletteEntry(entry, {
        centerOn: visibleCanvasCenter(),
      });
      if (!outcome.ok) {
        notify({
          severity: outcome.reason === "noProject" ? "info" : "error",
          titleKey:
            outcome.reason === "noProject"
              ? "graph.palette.projectRequired"
              : "graph.palette.insertionFailed",
        });
        return;
      }
      closeFlyout();
    },
    [closeFlyout],
  );

  const handleCategoryKeyDown = useCallback(
    (
      event: ReactKeyboardEvent<HTMLButtonElement>,
      category: PaletteCategory,
    ) => {
      if (!["Enter", " ", "ArrowRight", "ArrowDown"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      openFlyout(category, event.currentTarget);
      window.requestAnimationFrame(() => {
        flyoutRef.current
          ?.querySelector<HTMLButtonElement>(".palette-item")
          ?.focus();
      });
    },
    [openFlyout],
  );

  const handleFlyoutBlur = useCallback(
    (event: ReactFocusEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        (flyoutRef.current?.contains(nextTarget) ||
          activeAnchorRef.current?.contains(nextTarget))
      ) {
        return;
      }
      scheduleClose();
    },
    [scheduleClose],
  );

  const handleFlyoutPointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        activeAnchorRef.current?.contains(nextTarget)
      ) {
        return;
      }
      scheduleClose();
    },
    [scheduleClose],
  );

  if (collapsed) {
    return (
      <aside
        className="node-palette-collapsed"
        aria-label={t("shell.palette.title")}
      >
        <IconAction
          icon="action.expandLeft"
          label={t("shell.palette.open")}
          {...(onExpand === undefined ? {} : { onClick: onExpand })}
        />
      </aside>
    );
  }

  const flyoutContent =
    activeGroup === undefined || flyout === undefined || catalog === undefined
      ? null
      : createPortal(
          <section
            ref={flyoutRef}
            id={"node-palette-" + activeGroup.category + "-flyout"}
            className="node-palette__flyout"
            role="region"
            aria-label={t(categoryLabelKeys[activeGroup.category])}
            style={flyout}
            onPointerEnter={cancelScheduledClose}
            onPointerLeave={handleFlyoutPointerLeave}
            onFocus={cancelScheduledClose}
            onBlur={handleFlyoutBlur}
            onKeyDown={(event) => {
              if (event.key !== "Escape") {
                return;
              }
              event.preventDefault();
              activeAnchorRef.current?.focus();
              closeFlyout();
            }}
          >
            <header className="node-palette__flyout-header">
              <ProductIcon icon={categoryIcons[activeGroup.category]} />
              <strong>{t(categoryLabelKeys[activeGroup.category])}</strong>
              <span>{activeGroup.entries.length}</span>
            </header>
            <ScrollArea className="node-palette__flyout-items">
              <div className="node-palette__flyout-list">
                {activeGroup.entries.map((entry) => (
                  <PaletteEntryButton
                    key={entry.key}
                    entry={entry}
                    labels={catalog.describe(entry)}
                    capability={capabilityState(entry, undefined)}
                    disabled={!projectOpen}
                    {...(projectOpen
                      ? {}
                      : {
                          disabledDescription: t(
                            "graph.palette.projectRequired",
                          ),
                        })}
                    onActivate={activate}
                    onDisabledActivate={reportProjectRequired}
                  />
                ))}
              </div>
            </ScrollArea>
          </section>,
          document.body,
        );

  return (
    <>
      <aside
        className="application-panel node-palette"
        aria-label={t("shell.palette.title")}
      >
        <header className="panel-header">
          <div className="panel-title">
            <ProductIcon icon="panel.palette" />
            <h2>{t("shell.palette.title")}</h2>
          </div>
          {onCollapse === undefined ? null : (
            <IconAction
              icon="action.collapseLeft"
              label={t("common.actions.collapse")}
              onClick={onCollapse}
            />
          )}
        </header>
        <div className="panel-content">
          <ScrollArea className="node-palette__list">
            {catalog === undefined ? (
              <EmptyState
                icon="category.utility"
                title={t("shell.palette.emptyTitle")}
                description={t("shell.palette.emptyDescription")}
              />
            ) : groups.length === 0 ? (
              <EmptyState
                icon="action.search"
                title={t("graph.palette.noResultsTitle")}
                description={t("graph.palette.noResultsDescription")}
              />
            ) : (
              <>
                {projectOpen ? null : (
                  <p className="node-palette__notice">
                    {t("graph.palette.noProjectNotice")}
                  </p>
                )}
                {groups.map((group) => (
                  <section key={group.category} className="palette-group">
                    <button
                      type="button"
                      className="palette-group__heading"
                      aria-haspopup="true"
                      aria-expanded={activeCategory === group.category}
                      aria-controls={
                        "node-palette-" + group.category + "-flyout"
                      }
                      onPointerEnter={(event) => {
                        openFlyout(group.category, event.currentTarget);
                      }}
                      onPointerLeave={scheduleClose}
                      onFocus={(event) => {
                        openFlyout(group.category, event.currentTarget);
                      }}
                      onBlur={(event) => {
                        const nextTarget = event.relatedTarget;
                        if (
                          nextTarget instanceof Node &&
                          flyoutRef.current?.contains(nextTarget)
                        ) {
                          return;
                        }
                        scheduleClose();
                      }}
                      onKeyDown={(event) => {
                        handleCategoryKeyDown(event, group.category);
                      }}
                    >
                      <ProductIcon
                        icon={categoryIcons[group.category]}
                        size="small"
                      />
                      <span>{t(categoryLabelKeys[group.category])}</span>
                      <span className="palette-group__count">
                        {group.entries.length}
                      </span>
                      <ProductIcon
                        icon="action.chevronRight"
                        size="small"
                        className="palette-group__indicator"
                      />
                    </button>
                  </section>
                ))}
              </>
            )}
          </ScrollArea>
        </div>
      </aside>
      {flyoutContent}
    </>
  );
}
