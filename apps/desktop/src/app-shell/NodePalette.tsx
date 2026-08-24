import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ScrollArea } from "../components/ui/ScrollArea";
import { ProductIcon } from "../design-system/icons/ProductIcon";
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

export function NodePalette({
  collapsed = false,
  onCollapse,
  onExpand,
}: NodePaletteProps) {
  const { t } = useTranslation();
  const catalog = usePaletteCatalog();
  const projectOpen = useDocumentStore((store) => store.history !== undefined);
  const [collapsedCategories, setCollapsedCategories] = useState<
    readonly PaletteCategory[]
  >([]);

  const groups = useMemo(() => {
    if (!catalog) {
      return [];
    }
    return groupPaletteEntries(catalog.entries);
  }, [catalog]);

  const reportProjectRequired = useCallback(() => {
    notify({
      severity: "info",
      titleKey: "graph.palette.projectRequired",
    });
  }, []);

  const activate = useCallback((entry: PaletteEntry) => {
    // A palette item activated by keyboard or click has no drop position, so the node
    // lands in the middle of what the user is currently looking at.
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
    }
  }, []);

  const toggleCategory = useCallback((category: PaletteCategory) => {
    setCollapsedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  }, []);

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

  return (
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
              {groups.map((group) => {
                const open = !collapsedCategories.includes(group.category);
                return (
                  <section
                    key={group.category}
                    className="palette-group"
                    aria-label={t(categoryLabelKeys[group.category])}
                  >
                    <button
                      type="button"
                      className="palette-group__heading"
                      aria-expanded={open}
                      onClick={() => {
                        toggleCategory(group.category);
                      }}
                    >
                      <ProductIcon
                        icon={
                          open ? "action.collapseDown" : "action.expandLeft"
                        }
                        size="small"
                      />
                      <span>{t(categoryLabelKeys[group.category])}</span>
                      <span className="palette-group__count">
                        {group.entries.length}
                      </span>
                    </button>
                    {open ? (
                      <div className="palette-group__items">
                        {group.entries.map((entry) => (
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
                    ) : null}
                  </section>
                );
              })}
            </>
          )}
        </ScrollArea>
      </div>
    </aside>
  );
}
