import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/Button";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import {
  constrainFloatingWorkbenchGeometry,
  type FloatingWorkbenchGeometry,
  type FloatingWorkbenchViewport,
} from "./floating-workbench-geometry";
import { IconAction } from "./IconAction";
import { RightWorkbench } from "./RightWorkbench";
import type { RightWorkbenchTab } from "../preferences/layout-preferences";
import type { WindowMetrics } from "../platform/useWindowMetrics";
import "./floating-workbench-panel.css";

export type WorkbenchContextMenuMode = "docked" | "floating";

interface WorkbenchContextMenuProps {
  children: ReactNode;
  mode: WorkbenchContextMenuMode;
  onDock?: (() => void) | undefined;
  onFloat?: (() => void) | undefined;
}

interface ContextMenuPosition {
  x: number;
  y: number;
}

function isNativeEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, button, [contenteditable="true"]',
    ) !== null
  );
}

function clampContextMenuPosition(
  position: ContextMenuPosition,
): ContextMenuPosition {
  const menuWidth = 184;
  const menuHeight = 48;
  return {
    x: Math.min(
      Math.max(8, position.x),
      Math.max(8, window.innerWidth - menuWidth - 8),
    ),
    y: Math.min(
      Math.max(8, position.y),
      Math.max(8, window.innerHeight - menuHeight - 8),
    ),
  };
}

export function WorkbenchContextMenu({
  children,
  mode,
  onDock,
  onFloat,
}: WorkbenchContextMenuProps) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<ContextMenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);

  const closeMenu = useCallback(() => {
    setPosition(null);
  }, []);

  useEffect(() => {
    if (position === null) {
      return;
    }

    actionRef.current?.focus();
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    const handleResize = () => {
      closeMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [closeMenu, position]);

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const action = mode === "floating" ? onDock : onFloat;
      if (action === undefined || isNativeEditingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      setPosition(
        clampContextMenuPosition({ x: event.clientX, y: event.clientY }),
      );
    },
    [mode, onDock, onFloat],
  );

  const actionLabel =
    mode === "floating"
      ? t("shell.workbench.dock")
      : t("shell.workbench.float");
  const action = mode === "floating" ? onDock : onFloat;

  return (
    <div
      className="floating-workbench-context-target"
      data-workbench-mode={mode}
      onContextMenu={handleContextMenu}
    >
      {children}
      {position === null || action === undefined ? null : (
        <div
          ref={menuRef}
          className="floating-workbench-context-menu"
          role="menu"
          aria-label={t("shell.workbench.contextMenuLabel")}
          style={{ left: position.x, top: position.y }}
          onContextMenu={(event) => {
            event.preventDefault();
          }}
        >
          <Button
            ref={actionRef}
            className="floating-workbench-context-menu__item"
            size="compact"
            variant="ghost"
            role="menuitem"
            onClick={() => {
              closeMenu();
              action();
            }}
          >
            <ProductIcon
              icon={
                mode === "floating"
                  ? "action.collapseRight"
                  : "action.expandRight"
              }
              size="small"
            />
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

export interface FloatingWorkbenchPanelProps {
  activeTab: RightWorkbenchTab;
  geometry: FloatingWorkbenchGeometry;
  metrics: WindowMetrics;
  onActiveTabChange: (tab: RightWorkbenchTab) => void;
  onDock: () => void;
  onGeometryCommit: (geometry: FloatingWorkbenchGeometry) => void;
  onPreviewRatioChange: (delta: number) => void;
  previewRatio: number;
}

type InteractionKind =
  "drag" | "resize-right" | "resize-bottom" | "resize-corner";

interface InteractionOrigin {
  pointerX: number;
  pointerY: number;
  geometry: FloatingWorkbenchGeometry;
}

function areGeometriesEqual(
  left: FloatingWorkbenchGeometry,
  right: FloatingWorkbenchGeometry,
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

type WorkbenchTitleKey =
  | "shell.workbench.title"
  | "shell.workbench.inspector"
  | "shell.workbench.functions"
  | "shell.workbench.variables";

function workbenchTitleKey(activeTab: RightWorkbenchTab): WorkbenchTitleKey {
  return activeTab === "inspector"
    ? "shell.workbench.inspector"
    : activeTab === "functions"
      ? "shell.workbench.functions"
      : activeTab === "variables"
        ? "shell.workbench.variables"
        : "shell.workbench.title";
}

function workbenchIcon(activeTab: RightWorkbenchTab) {
  return activeTab === "inspector"
    ? "panel.inspector"
    : activeTab === "functions"
      ? "node.variable"
      : activeTab === "variables"
        ? "panel.values"
        : "panel.device";
}

export function FloatingWorkbenchPanel({
  activeTab,
  geometry,
  metrics,
  onActiveTabChange,
  onDock,
  onGeometryCommit,
  onPreviewRatioChange,
  previewRatio,
}: FloatingWorkbenchPanelProps) {
  const { t } = useTranslation();
  const viewport = useMemo<FloatingWorkbenchViewport>(
    () => ({ width: metrics.width, height: metrics.height }),
    [metrics.height, metrics.width],
  );
  const [draftGeometry, setDraftGeometry] = useState<FloatingWorkbenchGeometry>(
    () => constrainFloatingWorkbenchGeometry(geometry, viewport),
  );
  const draftGeometryRef = useRef(draftGeometry);
  const cleanupInteractionRef = useRef<(() => void) | null>(null);
  const [interactionKind, setInteractionKind] =
    useState<InteractionKind | null>(null);

  const updateDraftGeometry = useCallback((next: FloatingWorkbenchGeometry) => {
    draftGeometryRef.current = next;
    setDraftGeometry(next);
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const constrained = constrainFloatingWorkbenchGeometry(
        geometry,
        viewport,
      );
      updateDraftGeometry(constrained);
      if (!areGeometriesEqual(constrained, geometry)) {
        onGeometryCommit(constrained);
      }
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [geometry, onGeometryCommit, updateDraftGeometry, viewport]);

  useEffect(() => {
    return () => {
      cleanupInteractionRef.current?.();
    };
  }, []);

  const handlePointerDown = useCallback(
    (kind: InteractionKind, event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest("button") !== null
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      cleanupInteractionRef.current?.();
      const origin: InteractionOrigin = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        geometry: draftGeometryRef.current,
      };
      const handleMove = (moveEvent: globalThis.PointerEvent) => {
        const deltaX = moveEvent.clientX - origin.pointerX;
        const deltaY = moveEvent.clientY - origin.pointerY;
        const next = { ...origin.geometry };
        if (kind === "drag") {
          next.x += deltaX;
          next.y += deltaY;
        } else if (kind === "resize-right" || kind === "resize-corner") {
          next.width += deltaX;
        }
        if (kind === "resize-bottom" || kind === "resize-corner") {
          next.height += deltaY;
        }
        updateDraftGeometry(constrainFloatingWorkbenchGeometry(next, viewport));
      };
      const handleUp = () => {
        cleanupInteractionRef.current?.();
        cleanupInteractionRef.current = null;
        setInteractionKind(null);
        onGeometryCommit(draftGeometryRef.current);
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
      };
      cleanupInteractionRef.current = cleanup;
      setInteractionKind(kind);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp, { once: true });
      window.addEventListener("pointercancel", handleUp, { once: true });
    },
    [onGeometryCommit, updateDraftGeometry, viewport],
  );

  const handleHeaderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? 16 : 8;
      let deltaX = 0;
      let deltaY = 0;
      if (event.key === "ArrowLeft") deltaX = -step;
      if (event.key === "ArrowRight") deltaX = step;
      if (event.key === "ArrowUp") deltaY = -step;
      if (event.key === "ArrowDown") deltaY = step;
      if (deltaX === 0 && deltaY === 0) return;
      event.preventDefault();
      const next = constrainFloatingWorkbenchGeometry(
        {
          ...draftGeometryRef.current,
          x: draftGeometryRef.current.x + deltaX,
          y: draftGeometryRef.current.y + deltaY,
        },
        viewport,
      );
      updateDraftGeometry(next);
      onGeometryCommit(next);
    },
    [onGeometryCommit, updateDraftGeometry, viewport],
  );

  const panelStyle = {
    left: `${String(draftGeometry.x)}px`,
    top: `${String(draftGeometry.y)}px`,
    width: `${String(draftGeometry.width)}px`,
    height: `${String(draftGeometry.height)}px`,
  } satisfies CSSProperties;
  const titleKey = workbenchTitleKey(activeTab);

  return (
    <WorkbenchContextMenu mode="floating" onDock={onDock}>
      <section
        className={`floating-workbench-panel ${
          interactionKind === null
            ? ""
            : `floating-workbench-panel--${interactionKind}`
        }`}
        style={panelStyle}
        aria-label={t(titleKey)}
        data-interaction={interactionKind ?? undefined}
      >
        <header
          className="floating-workbench-panel__header"
          tabIndex={0}
          aria-label={t("shell.workbench.drag")}
          onPointerDown={(event) => {
            handlePointerDown("drag", event);
          }}
          onKeyDown={handleHeaderKeyDown}
        >
          <div className="floating-workbench-panel__title">
            <ProductIcon icon={workbenchIcon(activeTab)} />
            <h2>{t(titleKey)}</h2>
          </div>
          <div className="floating-workbench-panel__actions">
            <IconAction
              icon="action.collapseRight"
              label={t("shell.workbench.dock")}
              onClick={onDock}
            />
          </div>
        </header>
        <div className="floating-workbench-panel__body">
          <RightWorkbench
            tabbed
            activeTab={activeTab}
            metrics={metrics}
            previewRatio={previewRatio}
            onActiveTabChange={onActiveTabChange}
            onPreviewRatioChange={onPreviewRatioChange}
          />
        </div>
        <span
          className="floating-workbench-panel__resize-handle floating-workbench-panel__resize-handle--right"
          role="separator"
          aria-label={t("shell.workbench.resize")}
          tabIndex={0}
          onPointerDown={(event) => {
            handlePointerDown("resize-right", event);
          }}
        />
        <span
          className="floating-workbench-panel__resize-handle floating-workbench-panel__resize-handle--bottom"
          role="separator"
          aria-label={t("shell.workbench.resize")}
          tabIndex={0}
          onPointerDown={(event) => {
            handlePointerDown("resize-bottom", event);
          }}
        />
        <span
          className="floating-workbench-panel__resize-handle floating-workbench-panel__resize-handle--corner"
          role="separator"
          aria-label={t("shell.workbench.resize")}
          tabIndex={0}
          onPointerDown={(event) => {
            handlePointerDown("resize-corner", event);
          }}
        />
      </section>
    </WorkbenchContextMenu>
  );
}
