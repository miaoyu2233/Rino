import type { EditorPositionV1 } from "@rino/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { Dialog, DialogContent } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { resolveProductIcon } from "../../design-system/icons/product-icons";
import { insertPaletteEntry } from "../palette/insert-entry";
import {
  filterConnectable,
  findConnectablePort,
  prioritizePaletteEntries,
  recommendConnectionTargets,
  searchPalette,
  type ConnectionOrigin,
  type PaletteEntry,
} from "../palette/palette-model";
import { usePaletteCatalog } from "../palette/usePaletteCatalog";
import { useDocumentStore } from "../store/document-store";
import {
  applyRepeatHintAction,
  type RepeatHintQuickAddAction,
} from "./repeat-hint-actions";

/** Where the panel was opened and, when a connection drag ended on empty canvas, the port
 * the new node should be wired to. */
export interface QuickAddRequest {
  position: EditorPositionV1;
  connectFrom?: ConnectionOrigin & { nodeId: string; portId: string };
  companionExecutionFrom?: { nodeId: string; portId: string };
  repeatAction?: RepeatHintQuickAddAction;
}

export interface QuickAddPanelProps {
  request: QuickAddRequest | undefined;
  onClose: () => void;
}

const MAXIMUM_VISIBLE_RESULTS = 40;

/** Keyboard-first node insertion opened with Tab or from a connection dropped on canvas. */
export function QuickAddPanel({ request, onClose }: QuickAddPanelProps) {
  return (
    <Dialog
      open={request !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {request === undefined ? null : (
        <QuickAddContent request={request} onClose={onClose} />
      )}
    </Dialog>
  );
}

interface QuickAddContentProps {
  request: QuickAddRequest;
  onClose: () => void;
}

/** Mounted only while open so each session starts with a fresh query and safe matching. */
function QuickAddContent({ request, onClose }: QuickAddContentProps) {
  const { t } = useTranslation();
  const catalog = usePaletteCatalog();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [contextMatch, setContextMatch] = useState(true);
  const listRef = useRef<HTMLUListElement>(null);
  const sourceTypeKey = useDocumentStore((store) => {
    const sourceNodeId = request.connectFrom?.nodeId;
    if (sourceNodeId === undefined) return undefined;
    for (const graph of store.history?.document.graphs ?? []) {
      const node = graph.nodes.find(
        (candidate) => candidate.nodeId === sourceNodeId,
      );
      if (node !== undefined) return node.typeKey;
    }
    return undefined;
  });

  const results = useMemo(() => {
    if (!catalog) {
      return [];
    }
    const candidates =
      request.connectFrom && contextMatch
        ? filterConnectable(catalog.entries, request.connectFrom)
        : catalog.entries;
    const prioritized = prioritizePaletteEntries(candidates);
    const contextual =
      request.connectFrom !== undefined && query.trim().length === 0
        ? recommendConnectionTargets(
            prioritized,
            request.connectFrom,
            sourceTypeKey,
          )
        : prioritized;
    return searchPalette(contextual, catalog.lookup, query).slice(
      0,
      MAXIMUM_VISIBLE_RESULTS,
    );
  }, [catalog, contextMatch, query, request, sourceTypeKey]);

  const hasRepeatAction = request.repeatAction !== undefined;
  const resultOffset = hasRepeatAction ? 1 : 0;
  const resultCount = results.length + resultOffset;

  const insert = useCallback(
    (entry: PaletteEntry) => {
      const connectFrom =
        request.connectFrom !== undefined &&
        findConnectablePort(entry, request.connectFrom) !== undefined
          ? request.connectFrom
          : undefined;
      insertPaletteEntry(entry, {
        centerOn: request.position,
        ...(connectFrom === undefined ? {} : { connectFrom }),
        ...(connectFrom !== undefined && request.companionExecutionFrom
          ? { companionExecutionFrom: request.companionExecutionFrom }
          : {}),
      });
      onClose();
    },
    [onClose, request],
  );

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((current) =>
        resultCount === 0 ? 0 : (current + 1) % resultCount,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) =>
        resultCount === 0 ? 0 : (current - 1 + resultCount) % resultCount,
      );
      return;
    }
    if (event.key === "Enter") {
      if (hasRepeatAction && highlighted === 0) {
        event.preventDefault();
        if (
          request.repeatAction?.target !== undefined &&
          applyRepeatHintAction(request.repeatAction)
        ) {
          onClose();
        }
        return;
      }
      const entry = results[highlighted - resultOffset];
      if (entry) {
        event.preventDefault();
        insert(entry);
      }
    }
  };

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted, results]);

  return (
    <DialogContent
      className="quick-add nowheel nopan nodrag"
      closeLabel={t("common.actions.close")}
      title={t(
        request.connectFrom
          ? "graph.quickAdd.connectTitle"
          : "graph.quickAdd.title",
      )}
      description={t(
        request.connectFrom
          ? "graph.quickAdd.connectDescription"
          : "graph.quickAdd.description",
      )}
      onWheelCapture={(event) => {
        event.stopPropagation();
      }}
    >
      <div className="quick-add__search">
        <ProductIcon icon="action.search" size="small" />
        <Input
          autoFocus
          aria-label={t("shell.palette.searchLabel")}
          aria-controls="quick-add-results"
          placeholder={t("shell.palette.searchPlaceholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {request.connectFrom === undefined ? null : (
        <div className="quick-add__context-match">
          <span className="quick-add__context-copy">
            <strong id="quick-add-context-match-label">
              {t("graph.quickAdd.contextMatch")}
            </strong>
            <small id="quick-add-context-match-description">
              {t(
                contextMatch
                  ? "graph.quickAdd.contextMatchEnabledDescription"
                  : "graph.quickAdd.contextMatchDisabledDescription",
              )}
            </small>
          </span>
          <button
            type="button"
            role="switch"
            className="quick-add__context-switch"
            aria-checked={contextMatch}
            aria-labelledby="quick-add-context-match-label"
            aria-describedby="quick-add-context-match-description"
            onClick={() => {
              setContextMatch((current) => !current);
              setHighlighted(0);
            }}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      )}
      {results.length === 0 && !hasRepeatAction ? (
        <p className="quick-add__empty">
          {t(
            request.connectFrom && contextMatch
              ? "graph.quickAdd.noCompatibleResults"
              : "graph.palette.noResultsDescription",
          )}
        </p>
      ) : (
        <ul
          id="quick-add-results"
          ref={listRef}
          className="quick-add__results"
          aria-label={t("graph.quickAdd.resultsLabel")}
        >
          {hasRepeatAction ? (
            <li key="editor-repeat-action">
              <button
                type="button"
                className="quick-add__result quick-add__result--editor-action"
                data-editor-action="repeat"
                data-highlighted={highlighted === 0 ? "true" : undefined}
                disabled={request.repeatAction?.target === undefined}
                onMouseEnter={() => {
                  setHighlighted(0);
                }}
                onClick={() => {
                  if (
                    request.repeatAction !== undefined &&
                    applyRepeatHintAction(request.repeatAction)
                  ) {
                    onClose();
                  }
                }}
              >
                <ProductIcon icon="node.imageRecognition" size="small" />
                <span className="quick-add__result-title">
                  {t("graph.quickAdd.repeatAction")}
                </span>
                <span className="quick-add__result-secondary">
                  {request.repeatAction?.target === undefined
                    ? t("graph.quickAdd.repeatActionNoCandidate")
                    : t("graph.quickAdd.repeatActionTarget", {
                        target: t(request.repeatAction.target.titleKey),
                      })}
                </span>
              </button>
            </li>
          ) : null}
          {results.map((entry, index) => {
            const labels = catalog?.describe(entry);
            const displayIndex = index + resultOffset;
            return (
              <li key={entry.key}>
                <button
                  type="button"
                  className="quick-add__result"
                  data-highlighted={
                    displayIndex === highlighted ? "true" : undefined
                  }
                  onMouseEnter={() => {
                    setHighlighted(displayIndex);
                  }}
                  onClick={() => {
                    insert(entry);
                  }}
                >
                  <ProductIcon
                    icon={resolveProductIcon(entry.iconKey, "category.flow")}
                    size="small"
                  />
                  <span className="quick-add__result-title">
                    {labels?.title ?? entry.key}
                  </span>
                  {labels?.secondaryTitle === undefined ? null : (
                    <span className="quick-add__result-secondary">
                      {labels.secondaryTitle}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DialogContent>
  );
}
