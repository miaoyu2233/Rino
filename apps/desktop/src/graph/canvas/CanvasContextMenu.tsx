import type { EditorPositionV1 } from "@rino/contracts";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextSubMenu,
} from "../../components/ui/ContextMenu";
import { Input } from "../../components/ui/Input";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { resolveProductIcon } from "../../design-system/icons/product-icons";
import type { LocalizationKey } from "../../diagnostics/diagnostic-model";
import { notify } from "../../diagnostics/diagnostic-store";
import { insertPaletteEntry } from "../palette/insert-entry";
import {
  groupPaletteEntries,
  searchPalette,
  type PaletteCategory,
  type PaletteEntry,
} from "../palette/palette-model";
import { usePaletteCatalog } from "../palette/usePaletteCatalog";
import { useEditorSessionStore } from "../store/editor-session-store";

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

export interface CanvasContextMenuProps {
  children: ReactNode;
  /** Converts the pointer position of the opening event into graph coordinates. */
  toGraphPosition: (point: {
    clientX: number;
    clientY: number;
  }) => EditorPositionV1;
  onRemoveSelection: () => void;
  onDuplicateSelection: () => void;
  onPaste: () => void;
  canResolveOverlaps: boolean;
  onResolveOverlaps: () => void;
}

/** The canvas right-click menu.
 *
 * Provides a top search bar for quick node searching and insertion (Unreal Engine style),
 * as well as category submenus when search is empty, and standard selection operations.
 */
export function CanvasContextMenu({
  children,
  toGraphPosition,
  onRemoveSelection,
  onDuplicateSelection,
  onPaste,
  canResolveOverlaps,
  onResolveOverlaps,
}: CanvasContextMenuProps) {
  const { t } = useTranslation();
  const catalog = usePaletteCatalog();
  const openedAt = useRef<EditorPositionV1>({ x: 0, y: 0 });
  const [searchValue, setSearchValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const hasSelection = useEditorSessionStore(
    (store) => store.selectedNodeIds.length > 0,
  );
  const hasClipboard = useEditorSessionStore(
    (store) => store.clipboard !== undefined,
  );

  const searching = searchValue.trim().length > 0;

  const searchResults = useMemo(() => {
    if (!catalog) {
      return [];
    }
    return searchPalette(catalog.entries, catalog.lookup, searchValue);
  }, [catalog, searchValue]);

  const groups = useMemo(
    () => (catalog ? groupPaletteEntries(catalog.entries) : []),
    [catalog],
  );

  const create = useCallback((entry: PaletteEntry) => {
    const outcome = insertPaletteEntry(entry, { centerOn: openedAt.current });
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

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      setSearchValue("");
      window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }
  }, []);

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && searching && searchResults.length > 0) {
        const firstEntry = searchResults[0];
        if (firstEntry) {
          event.preventDefault();
          create(firstEntry);
        }
      }
    },
    [create, searching, searchResults],
  );

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => {
          openedAt.current = toGraphPosition(event);
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={t("graph.contextMenu.label")}>
        <div
          className="canvas-context-menu__search"
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
        >
          <ProductIcon icon="action.search" size="small" />
          <Input
            ref={searchInputRef}
            aria-label={t("shell.palette.searchLabel")}
            placeholder={t("shell.palette.searchPlaceholder")}
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
            }}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
        <ContextMenuSeparator />
        <ContextMenuLabel>{t("graph.contextMenu.create")}</ContextMenuLabel>
        {searching ? (
          searchResults.length === 0 ? (
            <ContextMenuItem disabled>
              {t("graph.palette.noResultsTitle")}
            </ContextMenuItem>
          ) : (
            searchResults.map((entry) => (
              <ContextMenuItem
                key={entry.key}
                onSelect={() => {
                  create(entry);
                }}
              >
                <ProductIcon
                  icon={resolveProductIcon(entry.iconKey, "category.flow")}
                  size="small"
                />
                <span>{catalog?.describe(entry).title ?? entry.key}</span>
              </ContextMenuItem>
            ))
          )
        ) : groups.length === 0 ? (
          <ContextMenuItem disabled>
            {t("shell.palette.emptyTitle")}
          </ContextMenuItem>
        ) : (
          groups.map((group) => (
            <ContextSubMenu
              key={group.category}
              label={t(categoryLabelKeys[group.category])}
            >
              {group.entries.map((entry) => (
                <ContextMenuItem
                  key={entry.key}
                  onSelect={() => {
                    create(entry);
                  }}
                >
                  <ProductIcon
                    icon={resolveProductIcon(entry.iconKey, "category.flow")}
                    size="small"
                  />
                  <span>{catalog?.describe(entry).title ?? entry.key}</span>
                </ContextMenuItem>
              ))}
            </ContextSubMenu>
          ))
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!canResolveOverlaps}
          onSelect={onResolveOverlaps}
        >
          {t("graph.contextMenu.resolveOverlaps")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!hasSelection}
          onSelect={onDuplicateSelection}
        >
          {t("graph.contextMenu.duplicate")}
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasClipboard} onSelect={onPaste}>
          {t("graph.contextMenu.paste")}
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasSelection} onSelect={onRemoveSelection}>
          {t("graph.contextMenu.remove")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
