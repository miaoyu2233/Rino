import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "../components/ui/Input";
import { ScrollArea } from "../components/ui/ScrollArea";
import { Select } from "../components/ui/Select";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import {
  clearDragPayload,
  writeDragPayload,
} from "../graph/canvas/canvas-drag";
import { visibleAssetDisplayName } from "../graph/project/asset-names";
import { useActiveDocument } from "../graph/store/document-store";
import { IconAction } from "./IconAction";
import { ScreenshotAssetThumbnail } from "./ScreenshotAssetThumbnail";

type ScreenshotSortMode = "addedTime" | "name";
type ScreenshotViewMode = "grid" | "list";

export function ScreenshotAssetBrowser() {
  const { i18n, t } = useTranslation();
  const document = useActiveDocument();
  const assets = useMemo(() => document?.assets ?? [], [document?.assets]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<ScreenshotSortMode>("addedTime");
  const [viewMode, setViewMode] = useState<ScreenshotViewMode>("grid");
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "short",
        timeStyle: "short",
      }),
    [i18n.language],
  );
  const nameCollator = useMemo(
    () =>
      new Intl.Collator(i18n.language, { numeric: true, sensitivity: "base" }),
    [i18n.language],
  );
  const filteredAssets = useMemo(
    () =>
      assets
        .map((asset) => ({
          asset,
          visibleName: visibleAssetDisplayName(asset.displayName),
        }))
        .filter(({ visibleName }) =>
          visibleName.toLocaleLowerCase().includes(normalizedQuery),
        )
        .sort((left, right) =>
          sortMode === "name"
            ? nameCollator.compare(left.visibleName, right.visibleName)
            : Date.parse(right.asset.createdAt) -
              Date.parse(left.asset.createdAt),
        ),
    [assets, nameCollator, normalizedQuery, sortMode],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    searchRef.current?.focus();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !(target instanceof Element && target.closest(".ui-select__content")) &&
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.querySelector("button")?.focus();
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <>
      <span ref={triggerRef} className="screenshot-browser__trigger">
        <IconAction
          disabled={document === undefined}
          icon="node.imageRecognition"
          label={t("shell.screenshotBrowser.open")}
          tooltip={
            document === undefined
              ? t("shell.toolbar.unavailableWithoutProject")
              : t("shell.screenshotBrowser.openDescription")
          }
          onClick={() => {
            setOpen((current) => !current);
          }}
        />
      </span>
      {open ? (
        <section
          ref={panelRef}
          className="screenshot-browser"
          role="dialog"
          aria-modal="false"
          aria-labelledby="screenshot-browser-title"
        >
          <header className="screenshot-browser__header">
            <div>
              <h2 id="screenshot-browser-title">
                {t("shell.screenshotBrowser.title")}
              </h2>
              <p>{t("shell.screenshotBrowser.description")}</p>
            </div>
            <button
              type="button"
              className="screenshot-browser__close"
              aria-label={t("common.actions.close")}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.querySelector("button")?.focus();
              }}
            >
              <ProductIcon icon="action.close" size="small" />
            </button>
          </header>
          <div className="screenshot-browser__tools">
            <label className="screenshot-browser__search">
              <ProductIcon icon="action.search" size="small" />
              <Input
                ref={searchRef}
                value={query}
                placeholder={t("shell.screenshotBrowser.searchPlaceholder")}
                aria-label={t("shell.screenshotBrowser.searchLabel")}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </label>
            <Select
              className="screenshot-browser__sort"
              value={sortMode}
              aria-label={t("shell.screenshotBrowser.sortLabel")}
              options={[
                {
                  value: "addedTime",
                  label: t("shell.screenshotBrowser.sortAddedTime"),
                },
                {
                  value: "name",
                  label: t("shell.screenshotBrowser.sortName"),
                },
              ]}
              onValueChange={(value) => {
                if (value === "addedTime" || value === "name") {
                  setSortMode(value);
                }
              }}
            />
            <div
              className="screenshot-browser__view-switcher"
              role="group"
              aria-label={t("shell.screenshotBrowser.viewLabel")}
            >
              <button
                type="button"
                aria-label={t("shell.screenshotBrowser.gridView")}
                aria-pressed={viewMode === "grid"}
                onClick={() => {
                  setViewMode("grid");
                }}
              >
                <ProductIcon icon="action.gridView" size="small" />
              </button>
              <button
                type="button"
                aria-label={t("shell.screenshotBrowser.listView")}
                aria-pressed={viewMode === "list"}
                onClick={() => {
                  setViewMode("list");
                }}
              >
                <ProductIcon icon="action.listView" size="small" />
              </button>
            </div>
          </div>
          <ScrollArea className="screenshot-browser__scroll">
            {filteredAssets.length === 0 ? (
              <div className="screenshot-browser__empty">
                <ProductIcon icon="node.imageRecognition" />
                <strong>
                  {t(
                    assets.length === 0
                      ? "shell.screenshotBrowser.emptyTitle"
                      : "shell.screenshotBrowser.noResultsTitle",
                  )}
                </strong>
                <span>
                  {t(
                    assets.length === 0
                      ? "shell.screenshotBrowser.emptyDescription"
                      : "shell.screenshotBrowser.noResultsDescription",
                  )}
                </span>
              </div>
            ) : (
              <ul
                className={`screenshot-browser__list screenshot-browser__list--${viewMode}`}
              >
                {filteredAssets.map(({ asset, visibleName }) => (
                  <li key={asset.assetId}>
                    <button
                      type="button"
                      className="screenshot-browser__asset"
                      draggable
                      title={t("shell.screenshotBrowser.dragHint", {
                        name: visibleName,
                      })}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copy";
                        writeDragPayload(event.dataTransfer, {
                          kind: "asset",
                          key: asset.assetId,
                        });
                      }}
                      onDragEnd={() => {
                        clearDragPayload();
                      }}
                    >
                      {viewMode === "grid" ? (
                        <ScreenshotAssetThumbnail asset={asset} />
                      ) : (
                        <ProductIcon icon="recognition.template" />
                      )}
                      <span className="screenshot-browser__asset-copy">
                        <strong>{visibleName}</strong>
                        <span>
                          {asset.coordinateSpace.width} ×{" "}
                          {asset.coordinateSpace.height}
                          {" · "}
                          {dateFormatter.format(new Date(asset.createdAt))}
                        </span>
                      </span>
                      <ProductIcon icon="action.drag" size="small" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </section>
      ) : null}
    </>
  );
}
