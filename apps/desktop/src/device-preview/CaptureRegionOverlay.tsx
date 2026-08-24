import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";

import {
  cancelUiAnimationFrame,
  requestUiAnimationFrame,
} from "../preferences/ui-animation-frame-scheduler";
import {
  clientPointToPreview,
  previewDragToSourceRectangle,
  type ClientBounds,
  type PreviewPoint,
  type PreviewTransform,
  type SourceRectangle,
} from "./geometry";

export interface CaptureRegionOverlayProps {
  transform: PreviewTransform;
  active: boolean;
  onAcceptRegion: (rectangle: SourceRectangle) => void;
  onCancel: () => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}

interface ActivePointerGesture {
  pointerId: number;
  bounds: ClientBounds;
  transform: PreviewTransform;
}

export function CaptureRegionOverlay({
  transform,
  active,
  onAcceptRegion,
  onCancel,
  onError,
  disabled = false,
}: CaptureRegionOverlayProps) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);

  const activePointerGestureRef = useRef<ActivePointerGesture | null>(null);
  const pendingPointerPointRef = useRef<PreviewPoint | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const [pointerDrag, setPointerDrag] = useState<{
    start: PreviewPoint;
    current: PreviewPoint;
    active: boolean;
    transform: PreviewTransform;
  } | null>(null);

  const initialKeyboardRectangle = useMemo<SourceRectangle>(() => {
    const w = Math.max(1, Math.floor(transform.source.width * 0.5));
    const h = Math.max(1, Math.floor(transform.source.height * 0.5));
    const x = Math.floor((transform.source.width - w) / 2);
    const y = Math.floor((transform.source.height - h) / 2);

    return {
      x,
      y,
      width: w,
      height: h,
      coordinateSpaceId: transform.source.coordinateSpaceId,
      sourceGeneration: transform.source.sourceGeneration,
    };
  }, [transform.source]);

  const [activeKeyboardDraft, setActiveKeyboardDraft] =
    useState<SourceRectangle | null>(null);

  const keyboardRectangle = activeKeyboardDraft ?? initialKeyboardRectangle;

  useEffect(() => {
    if (active) {
      surfaceRef.current?.focus({ preventScroll: true });
    }
  }, [active]);

  useEffect(
    () => () => {
      if (rafIdRef.current !== null) {
        cancelUiAnimationFrame(rafIdRef.current);
      }
      rafIdRef.current = null;
      pendingPointerPointRef.current = null;
      activePointerGestureRef.current = null;
    },
    [],
  );

  const getContainerPointerPoint = useCallback(
    (
      event: ReactPointerEvent,
      activeTransform: PreviewTransform = transform,
      activeBounds?: ClientBounds,
    ): PreviewPoint | undefined => {
      const rect = activeBounds ?? surfaceRef.current?.getBoundingClientRect();
      if (!rect) return undefined;
      return (
        clientPointToPreview(activeTransform, rect, {
          x: event.clientX,
          y: event.clientY,
        }) ?? {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        }
      );
    },
    [transform],
  );

  const isInsideRenderedPreview = useCallback(
    (point: PreviewPoint): boolean => {
      const left = transform.offsetX;
      const top = transform.offsetY;
      const right = transform.offsetX + transform.renderedWidth;
      const bottom = transform.offsetY + transform.renderedHeight;
      return (
        point.x >= left &&
        point.x <= right &&
        point.y >= top &&
        point.y <= bottom
      );
    },
    [transform],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        disabled ||
        !active ||
        event.button !== 0 ||
        activePointerGestureRef.current !== null
      ) {
        return;
      }
      const point = getContainerPointerPoint(event);
      if (point === undefined || !isInsideRenderedPreview(point)) {
        return;
      }

      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      activePointerGestureRef.current = {
        pointerId: event.pointerId,
        bounds: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        transform,
      };

      if (typeof event.currentTarget.setPointerCapture === "function") {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      setPointerDrag({
        start: point,
        current: point,
        active: true,
        transform,
      });
    },
    [
      active,
      disabled,
      getContainerPointerPoint,
      isInsideRenderedPreview,
      transform,
    ],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        pointerDrag?.active !== true ||
        event.pointerId !== activePointerGestureRef.current?.pointerId ||
        !active
      ) {
        return;
      }
      const gesture = activePointerGestureRef.current;
      const point = getContainerPointerPoint(
        event,
        gesture.transform,
        gesture.bounds,
      );
      if (point === undefined) {
        return;
      }
      pendingPointerPointRef.current = point;

      rafIdRef.current ??= requestUiAnimationFrame(() => {
        const current = pendingPointerPointRef.current;
        pendingPointerPointRef.current = null;
        rafIdRef.current = null;
        if (current) {
          setPointerDrag((previous) =>
            previous ? { ...previous, current } : null,
          );
        }
      });
    },
    [active, getContainerPointerPoint, pointerDrag?.active],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = activePointerGestureRef.current;
      if (
        disabled ||
        !active ||
        event.button !== 0 ||
        event.pointerId !== gesture?.pointerId
      ) {
        return;
      }
      const point = getContainerPointerPoint(
        event,
        gesture.transform,
        gesture.bounds,
      );
      if (point === undefined) {
        return;
      }

      if (rafIdRef.current !== null) {
        cancelUiAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingPointerPointRef.current = null;
      activePointerGestureRef.current = null;

      if (pointerDrag) {
        if (
          typeof event.currentTarget.hasPointerCapture === "function" &&
          event.currentTarget.hasPointerCapture(event.pointerId) &&
          typeof event.currentTarget.releasePointerCapture === "function"
        ) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }

        const rect = previewDragToSourceRectangle(
          pointerDrag.transform,
          pointerDrag.start,
          point,
        );
        setPointerDrag(null);
        if (!rect) {
          onError?.(
            t("shell.device.coordinatePicker.announcements.invalidGesture"),
          );
          return;
        }
        onAcceptRegion(rect);
      }
    },
    [
      active,
      disabled,
      getContainerPointerPoint,
      onAcceptRegion,
      onError,
      pointerDrag,
      t,
    ],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== activePointerGestureRef.current?.pointerId) {
        return;
      }
      if (rafIdRef.current !== null) {
        cancelUiAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingPointerPointRef.current = null;
      activePointerGestureRef.current = null;
      setPointerDrag(null);
    },
    [],
  );

  const handleLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerId === activePointerGestureRef.current?.pointerId) {
        handlePointerCancel(event);
      }
    },
    [handlePointerCancel],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled || !active) return;

      const target = event.target as HTMLElement | null;
      const isComposing =
        (event.nativeEvent as unknown as { isComposing?: boolean })
          .isComposing === true ||
        (event as unknown as { isComposing?: boolean }).isComposing === true;

      if (
        isComposing ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable === true
      ) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        onAcceptRegion(keyboardRectangle);
        return;
      }

      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 10 : 1;
        let { x, y, width, height } = keyboardRectangle;

        if (event.ctrlKey || event.metaKey) {
          if (event.key === "ArrowLeft") width = Math.max(1, width - step);
          if (event.key === "ArrowRight")
            width = Math.min(transform.source.width - x, width + step);
          if (event.key === "ArrowUp") height = Math.max(1, height - step);
          if (event.key === "ArrowDown")
            height = Math.min(transform.source.height - y, height + step);
        } else {
          if (event.key === "ArrowLeft") x -= step;
          if (event.key === "ArrowRight") x += step;
          if (event.key === "ArrowUp") y -= step;
          if (event.key === "ArrowDown") y += step;

          x = Math.max(0, Math.min(transform.source.width - width, x));
          y = Math.max(0, Math.min(transform.source.height - height, y));
        }

        setActiveKeyboardDraft({
          x,
          y,
          width,
          height,
          coordinateSpaceId: transform.source.coordinateSpaceId,
          sourceGeneration: transform.source.sourceGeneration,
        });
      }
    },
    [active, disabled, keyboardRectangle, onAcceptRegion, onCancel, transform],
  );

  const activePointerRect = pointerDrag?.active
    ? previewDragToSourceRectangle(
        pointerDrag.transform,
        pointerDrag.start,
        pointerDrag.current,
      )
    : undefined;

  const currentRect = activePointerRect ?? keyboardRectangle;

  const viewportRect = useMemo(() => {
    const x = transform.offsetX + currentRect.x * transform.scale;
    const y = transform.offsetY + currentRect.y * transform.scale;
    const w = currentRect.width * transform.scale;
    const h = currentRect.height * transform.scale;
    return {
      x,
      y,
      width: w,
      height: h,
      sourceWidth: currentRect.width,
      sourceHeight: currentRect.height,
    };
  }, [currentRect, transform]);

  if (!active) return null;

  return (
    <div
      ref={surfaceRef}
      className={`capture-region-overlay capture-region-overlay--active ${
        disabled ? "capture-region-overlay--disabled" : ""
      }`}
      tabIndex={0}
      role="application"
      aria-label={t("shell.device.captureWorkbench.regionOverlay.title")}
      aria-describedby={descriptionId}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
      onDragStart={(e) => {
        e.preventDefault();
      }}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        cursor: "crosshair",
        outline: "none",
        touchAction: "none",
        userSelect: "none",
        zIndex: 10,
      }}
    >
      <span id={descriptionId} className="sr-only">
        {t("shell.device.captureWorkbench.regionOverlay.instructions")}
      </span>

      <svg
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        <g
          transform={`translate(${viewportRect.x.toString()}, ${viewportRect.y.toString()})`}
        >
          <rect
            width={viewportRect.width}
            height={viewportRect.height}
            fill="color-mix(in oklch, var(--accent) 12%, transparent)"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <path
            d={`M 0 8 L 0 0 L 8 0 M ${(viewportRect.width - 8).toString()} 0 L ${viewportRect.width.toString()} 0 L ${viewportRect.width.toString()} 8 M ${viewportRect.width.toString()} ${(viewportRect.height - 8).toString()} L ${viewportRect.width.toString()} ${viewportRect.height.toString()} L ${(viewportRect.width - 8).toString()} ${viewportRect.height.toString()} M 8 ${viewportRect.height.toString()} L 0 ${viewportRect.height.toString()} L 0 ${(viewportRect.height - 8).toString()}`}
            fill="none"
            stroke="var(--text-primary)"
            strokeWidth="2"
          />
        </g>
      </svg>

      <div
        className="capture-region-overlay__badge font-code"
        style={{
          position: "absolute",
          left: Math.max(0, viewportRect.x + viewportRect.width / 2 - 32),
          top: Math.max(0, viewportRect.y + viewportRect.height + 4),
          padding: "2px 6px",
          borderRadius: "4px",
          background: "var(--surface-elevated)",
          color: "var(--text-primary)",
          fontSize: "11px",
          boxShadow: "var(--shadow-raised)",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          zIndex: 11,
        }}
      >
        {`${viewportRect.sourceWidth.toString()} × ${viewportRect.sourceHeight.toString()}`}
      </div>
    </div>
  );
}
