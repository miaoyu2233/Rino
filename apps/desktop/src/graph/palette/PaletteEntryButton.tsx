import { memo, type DragEvent as ReactDragEvent } from "react";
import { useTranslation } from "react-i18next";

import { Tooltip } from "../../components/ui/Tooltip";
import { ProductIcon } from "../../design-system/icons/ProductIcon";

import { clearDragPayload, writeDragPayload } from "../canvas/canvas-drag";
import { applyDragGhost } from "./drag-ghost";
import { paletteIconForEntry } from "./palette-entry-icon";
import type { CapabilityState, PaletteEntry } from "./palette-model";
import type { PaletteEntryLabels } from "./usePaletteCatalog";

export interface PaletteEntryButtonProps {
  entry: PaletteEntry;
  labels: PaletteEntryLabels;
  capability: CapabilityState;
  disabled?: boolean;
  disabledDescription?: string;
  onActivate: (entry: PaletteEntry) => void;
  onDisabledActivate?: () => void;
}

function PaletteEntryButtonComponent({
  entry,
  labels,
  capability,
  disabled = false,
  disabledDescription,
  onActivate,
  onDisabledActivate,
}: PaletteEntryButtonProps) {
  const { t } = useTranslation();

  const handleDragStart = (event: ReactDragEvent<HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    writeDragPayload(event.dataTransfer, {
      kind: entry.kind,
      key: entry.key,
    });
    event.dataTransfer.effectAllowed = "copy";
    applyDragGhost(event.dataTransfer, event.currentTarget);
  };

  const capabilityNote =
    capability === "satisfied"
      ? undefined
      : t(
          capability === "unknown"
            ? "graph.palette.capability.unknown"
            : "graph.palette.capability.unavailable",
          { capabilities: entry.requiredCapabilities.join("、") },
        );

  return (
    <Tooltip
      side="right"
      content={
        <div className="palette-item__help">
          <strong>{labels.title}</strong>
          {labels.secondaryTitle === undefined ? null : (
            <span className="palette-item__help-secondary">
              {labels.secondaryTitle}
            </span>
          )}
          {labels.description.length === 0 ? null : <p>{labels.description}</p>}
          {entry.kind === "template" && (
            <p className="palette-item__help-template">
              {t("graph.palette.templateHelp")}
            </p>
          )}
          {capabilityNote === undefined ? null : (
            <p className="palette-item__help-capability">{capabilityNote}</p>
          )}
          <p className="palette-item__help-hint">
            {disabledDescription ?? t("graph.palette.insertionHint")}
          </p>
          <code className="font-code">{entry.key}</code>
        </div>
      }
    >
      <button
        type="button"
        className="palette-item"
        draggable={!disabled}
        aria-disabled={disabled}
        data-kind={entry.kind}
        data-capability={capability}
        onDragStart={handleDragStart}
        onDragEnd={clearDragPayload}
        onClick={() => {
          if (disabled) {
            onDisabledActivate?.();
            return;
          }
          onActivate(entry);
        }}
      >
        <ProductIcon
          icon="action.drag"
          size="small"
          className="palette-item__drag-handle"
        />
        <ProductIcon
          icon={paletteIconForEntry(entry)}
          size="small"
          className="palette-item__icon"
        />
        <span className="palette-item__labels">
          <span className="palette-item__title">{labels.title}</span>
          {labels.secondaryTitle === undefined ? null : (
            <span className="palette-item__secondary">
              {labels.secondaryTitle}
            </span>
          )}
        </span>
        {entry.kind === "template" && (
          <span className="palette-item__template-badge">
            <ProductIcon icon="category.flow" size="small" />
            <span>{t("graph.palette.templateBadge")}</span>
          </span>
        )}
        {capability === "satisfied" || capabilityNote === undefined ? null : (
          <ProductIcon
            icon={capability === "unknown" ? "runtime.idle" : "runtime.warning"}
            size="small"
            label={capabilityNote}
            className="palette-item__capability"
          />
        )}
      </button>
    </Tooltip>
  );
}

/** Memoized because the palette re-renders on every keystroke in its search field while
 * most items are unchanged. */
export const PaletteEntryButton = memo(PaletteEntryButtonComponent);
