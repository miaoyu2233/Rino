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
  previewPointToSource,
  type ClientBounds,
  type PreviewPoint,
  type PreviewTransform,
  type SourcePoint,
  type SourceRectangle,
} from "./geometry";
import {
  projectDeviceOverlay,
  type DeviceOverlay,
  type ProjectedDeviceOverlay,
} from "./overlay-model";
import {
  useCoordinatePickerStore,
  type CoordinatePickerSession,
} from "./coordinate-picker-store";

export interface CoordinatePickerOverlayProps {
  transform: PreviewTransform;
  session: CoordinatePickerSession | undefined;
  savedOverlay: ProjectedDeviceOverlay | undefined;
  savedRawOverlay: DeviceOverlay | undefined;
  onCommitPoint: (sessionId: number, point: SourcePoint) => void;
  onCommitRectangle: (sessionId: number, rectangle: SourceRectangle) => void;
  onCancel: (sessionId?: number) => void;
  onError: (message: string) => void;
  errorMessage?: string | undefined;
  disabled?: boolean;
}

interface PointDraft {
  kind: "point";
  point: SourcePoint;
}

interface RectangleDraft {
  kind: "rectangle";
  rectangle: SourceRectangle;
}

type KeyboardDraft = PointDraft | RectangleDraft;

interface ActivePointerGesture {
  pointerId: number;
  sessionId: number;
  bounds: ClientBounds;
  transform: PreviewTransform;
}

export function CoordinatePickerOverlay({
  transform,
  session,
  savedOverlay,
  savedRawOverlay,
  onCommitPoint,
  onCommitRectangle,
  onCancel,
  onError,
  errorMessage,
  disabled = false,
}: CoordinatePickerOverlayProps) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const errorId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Active pointer capture and rAF throttling
  const activePointerGestureRef = useRef<ActivePointerGesture | null>(null);
  const pendingPointerPointRef = useRef<PreviewPoint | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Local drag state for pointer interactions
  const [pointerDrag, setPointerDrag] = useState<{
    start: PreviewPoint;
    current: PreviewPoint;
    active: boolean;
    transform: PreviewTransform;
  } | null>(null);

  const isActive = session !== undefined;
  const isPointMode = session?.kind === "point";
  const isRectangleMode = session?.kind === "rectangle";

  // Derived keyboard draft calculation
  const initialKeyboardDraft = useMemo<KeyboardDraft | null>(() => {
    if (!isActive) return null;

    const savedOverlayMatchesTransform = savedRawOverlay
      ? projectDeviceOverlay(transform, savedRawOverlay) !== undefined
      : false;

    if (isPointMode) {
      let initialPoint: SourcePoint;
      if (savedOverlayMatchesTransform && savedRawOverlay?.kind === "point") {
        initialPoint = savedRawOverlay.point;
      } else {
        initialPoint = {
          x: Math.floor(transform.source.width / 2),
          y: Math.floor(transform.source.height / 2),
          coordinateSpaceId: transform.source.coordinateSpaceId,
          sourceGeneration: transform.source.sourceGeneration,
        };
      }

      return {
        kind: "point",
        point: initialPoint,
      };
    }

    if (isRectangleMode) {
      let initialRect: SourceRectangle;
      if (
        savedOverlayMatchesTransform &&
        savedRawOverlay &&
        (savedRawOverlay.kind === "rectangle" ||
          savedRawOverlay.kind === "roi" ||
          savedRawOverlay.kind === "recognition")
      ) {
        initialRect = savedRawOverlay.rectangle;
      } else {
        const w = Math.max(1, Math.floor(transform.source.width * 0.25));
        const h = Math.max(1, Math.floor(transform.source.height * 0.25));
        const x = Math.floor((transform.source.width - w) / 2);
        const y = Math.floor((transform.source.height - h) / 2);
        initialRect = {
          x,
          y,
          width: w,
          height: h,
          coordinateSpaceId: transform.source.coordinateSpaceId,
          sourceGeneration: transform.source.sourceGeneration,
        };
      }

      return {
        kind: "rectangle",
        rectangle: initialRect,
      };
    }

    return null;
  }, [isActive, isPointMode, isRectangleMode, savedRawOverlay, transform]);

  // Local active keyboard navigation draft override
  const [activeKeyboardDraft, setActiveKeyboardDraft] =
    useState<KeyboardDraft | null>(null);

  // Active keyboard draft fallback
  const keyboardDraft = activeKeyboardDraft ?? initialKeyboardDraft;

  const keyboardDraftOverlay = useMemo<
    ProjectedDeviceOverlay | undefined
  >(() => {
    if (!keyboardDraft) return undefined;
    const identity = {
      overlayId: "keyboard-coordinate-draft",
      coordinateSpaceId: transform.source.coordinateSpaceId,
      sourceGeneration: transform.source.sourceGeneration,
    };
    const overlay: DeviceOverlay =
      keyboardDraft.kind === "point"
        ? { ...identity, kind: "point", point: keyboardDraft.point }
        : {
            ...identity,
            kind: "rectangle",
            rectangle: keyboardDraft.rectangle,
          };
    return projectDeviceOverlay(transform, overlay);
  }, [keyboardDraft, transform]);

  useEffect(() => {
    if (isActive) {
      surfaceRef.current?.focus({ preventScroll: true });
    }
  }, [isActive, session?.sessionId]);

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

  // Active pointer position helper
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

  // Validate active session identity
  const isSessionValid = useCallback((): boolean => {
    const currentSession = useCoordinatePickerStore.getState().session;
    return (
      session?.sessionId !== undefined &&
      currentSession?.sessionId === session.sessionId
    );
  }, [session]);

  const readActivePointerGesture = useCallback(
    () => activePointerGestureRef.current,
    [],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        disabled ||
        event.button !== 0 ||
        !isSessionValid() ||
        !session ||
        readActivePointerGesture() !== null
      ) {
        return;
      }
      const point = getContainerPointerPoint(event);
      if (point === undefined) {
        return;
      }

      const sourcePoint = previewPointToSource(transform, point);
      if (!sourcePoint) {
        return;
      }

      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      activePointerGestureRef.current = {
        pointerId: event.pointerId,
        sessionId: session.sessionId,
        bounds: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        transform,
      };

      if (isRectangleMode) {
        event.currentTarget.setPointerCapture(event.pointerId);
        setPointerDrag({
          start: point,
          current: point,
          active: true,
          transform,
        });
      }
    },
    [
      disabled,
      getContainerPointerPoint,
      isRectangleMode,
      isSessionValid,
      readActivePointerGesture,
      session,
      transform,
    ],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = readActivePointerGesture();
      if (
        !pointerDrag?.active ||
        event.pointerId !== gesture?.pointerId ||
        session?.sessionId !== gesture.sessionId ||
        !isSessionValid()
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
    [
      getContainerPointerPoint,
      isSessionValid,
      pointerDrag?.active,
      readActivePointerGesture,
      session,
    ],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = readActivePointerGesture();
      const sessionId = session?.sessionId;
      if (
        disabled ||
        event.button !== 0 ||
        !isSessionValid() ||
        sessionId === undefined ||
        event.pointerId !== gesture?.pointerId ||
        sessionId !== gesture.sessionId
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

      if (isPointMode) {
        const sourcePoint = previewPointToSource(gesture.transform, point);
        if (!sourcePoint) {
          onError(
            t("shell.device.coordinatePicker.announcements.invalidGesture"),
          );
          return;
        }
        onCommitPoint(sessionId, sourcePoint);
      } else if (isRectangleMode && pointerDrag) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }

        const rect = previewDragToSourceRectangle(
          pointerDrag.transform,
          pointerDrag.start,
          point,
        );
        setPointerDrag(null);
        if (!rect) {
          onError(
            t("shell.device.coordinatePicker.announcements.invalidGesture"),
          );
          return;
        }
        onCommitRectangle(sessionId, rect);
      }
    },
    [
      disabled,
      getContainerPointerPoint,
      isPointMode,
      isRectangleMode,
      isSessionValid,
      onCommitPoint,
      onCommitRectangle,
      onError,
      pointerDrag,
      readActivePointerGesture,
      session,
      t,
    ],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== readActivePointerGesture()?.pointerId) {
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
    [readActivePointerGesture],
  );

  const handleLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerId === readActivePointerGesture()?.pointerId) {
        handlePointerCancel(event);
      }
    },
    [handlePointerCancel, readActivePointerGesture],
  );

  // Keyboard navigation logic
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const sessionId = session?.sessionId;
      if (disabled || !isSessionValid() || sessionId === undefined) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel(sessionId);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        if (keyboardDraft?.kind === "point") {
          onCommitPoint(sessionId, keyboardDraft.point);
        } else if (keyboardDraft?.kind === "rectangle") {
          onCommitRectangle(sessionId, keyboardDraft.rectangle);
        }
        return;
      }

      // Arrow keys navigation
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 10 : 1;

        if (keyboardDraft?.kind === "point") {
          let { x, y } = keyboardDraft.point;
          if (event.key === "ArrowLeft") x -= step;
          if (event.key === "ArrowRight") x += step;
          if (event.key === "ArrowUp") y -= step;
          if (event.key === "ArrowDown") y += step;

          // Clamp to image bounds
          x = Math.max(0, Math.min(transform.source.width - 1, x));
          y = Math.max(0, Math.min(transform.source.height - 1, y));

          const newSource: SourcePoint = {
            ...keyboardDraft.point,
            x,
            y,
          };
          setActiveKeyboardDraft({
            kind: "point",
            point: newSource,
          });
        } else if (keyboardDraft?.kind === "rectangle") {
          let { x, y, width, height } = keyboardDraft.rectangle;

          if (event.ctrlKey || event.metaKey) {
            // Resize mode
            if (event.key === "ArrowLeft") width = Math.max(1, width - step);
            if (event.key === "ArrowRight")
              width = Math.min(transform.source.width - x, width + step);
            if (event.key === "ArrowUp") height = Math.max(1, height - step);
            if (event.key === "ArrowDown")
              height = Math.min(transform.source.height - y, height + step);
          } else {
            // Move mode
            if (event.key === "ArrowLeft") x -= step;
            if (event.key === "ArrowRight") x += step;
            if (event.key === "ArrowUp") y -= step;
            if (event.key === "ArrowDown") y += step;

            // Clamp position
            x = Math.max(0, Math.min(transform.source.width - width, x));
            y = Math.max(0, Math.min(transform.source.height - height, y));
          }

          const newRect: SourceRectangle = {
            ...keyboardDraft.rectangle,
            x,
            y,
            width,
            height,
          };

          setActiveKeyboardDraft({
            kind: "rectangle",
            rectangle: newRect,
          });
        }
      }
    },
    [
      disabled,
      isSessionValid,
      keyboardDraft,
      onCancel,
      onCommitPoint,
      onCommitRectangle,
      session,
      transform,
    ],
  );

  // Active pointer drag calculation
  const activePointerRect =
    isRectangleMode && pointerDrag
      ? previewDragToSourceRectangle(
          pointerDrag.transform,
          pointerDrag.start,
          pointerDrag.current,
        )
      : undefined;

  const activePointerRectProjection = activePointerRect
    ? projectDeviceOverlay(transform, {
        overlayId: "pointer-rectangle-draft",
        kind: "rectangle",
        coordinateSpaceId: transform.source.coordinateSpaceId,
        sourceGeneration: transform.source.sourceGeneration,
        rectangle: activePointerRect,
      })
    : undefined;
  const activePointerRectPreview =
    activePointerRect && activePointerRectProjection?.kind === "rectangle"
      ? {
          ...activePointerRectProjection,
          sourceWidth: activePointerRect.width,
          sourceHeight: activePointerRect.height,
        }
      : undefined;
  const keyboardRectanglePreview =
    keyboardDraft?.kind === "rectangle" &&
    keyboardDraftOverlay?.kind === "rectangle"
      ? {
          ...keyboardDraftOverlay,
          sourceWidth: keyboardDraft.rectangle.width,
          sourceHeight: keyboardDraft.rectangle.height,
        }
      : undefined;
  const visibleRectangleDraft =
    activePointerRectPreview ?? keyboardRectanglePreview;

  const describedByValue = errorMessage
    ? `${descriptionId} ${errorId}`
    : descriptionId;

  return (
    <div
      ref={surfaceRef}
      className={`coordinate-picker-overlay ${
        isActive ? "coordinate-picker-overlay--active" : ""
      } ${disabled ? "coordinate-picker-overlay--disabled" : ""}`}
      tabIndex={isActive ? 0 : -1}
      role={isActive ? "application" : undefined}
      aria-label={
        isActive
          ? t("shell.device.coordinatePicker.aria.interactionSurface")
          : undefined
      }
      aria-describedby={isActive ? describedByValue : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        if (isActive) event.preventDefault();
      }}
      onDragStart={(event) => {
        if (isActive) event.preventDefault();
      }}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        cursor: isActive ? "crosshair" : "default",
        outline: "none",
        touchAction: "none",
        userSelect: "none",
      }}
    >
      <span id={descriptionId} className="sr-only">
        {t("shell.device.coordinatePicker.aria.interactionDescription")}
      </span>
      {errorMessage ? (
        <span id={errorId} className="sr-only" role="alert">
          {errorMessage}
        </span>
      ) : null}

      {/* SVG Overlay */}
      <svg
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        {/* Saved Overlay */}
        {savedOverlay && !pointerDrag?.active && (
          <g className="coordinate-picker-overlay__saved">
            {savedOverlay.kind === "point" && (
              <g
                transform={`translate(${savedOverlay.point.x.toString()}, ${savedOverlay.point.y.toString()})`}
              >
                <circle
                  r={8}
                  fill="none"
                  stroke="color-mix(in oklch, var(--background) 70%, transparent)"
                  strokeWidth="3"
                />
                <circle
                  r={8}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
                <line
                  x1={-12}
                  y1={0}
                  x2={12}
                  y2={0}
                  stroke="color-mix(in oklch, var(--background) 70%, transparent)"
                  strokeWidth="3"
                />
                <line
                  x1={-12}
                  y1={0}
                  x2={12}
                  y2={0}
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
                <line
                  x1={0}
                  y1={-12}
                  x2={0}
                  y2={12}
                  stroke="color-mix(in oklch, var(--background) 70%, transparent)"
                  strokeWidth="3"
                />
                <line
                  x1={0}
                  y1={-12}
                  x2={0}
                  y2={12}
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
              </g>
            )}

            {(savedOverlay.kind === "rectangle" ||
              savedOverlay.kind === "roi" ||
              savedOverlay.kind === "recognition") && (
              <g
                transform={`translate(${savedOverlay.topLeft.x.toString()}, ${savedOverlay.topLeft.y.toString()})`}
              >
                <rect
                  width={savedOverlay.width}
                  height={savedOverlay.height}
                  fill="color-mix(in oklch, var(--accent) 8%, transparent)"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  rx="2"
                />
                <path
                  d={`M 0 8 L 0 0 L 8 0 M ${(savedOverlay.width - 8).toString()} 0 L ${savedOverlay.width.toString()} 0 L ${savedOverlay.width.toString()} 8 M ${savedOverlay.width.toString()} ${(savedOverlay.height - 8).toString()} L ${savedOverlay.width.toString()} ${savedOverlay.height.toString()} L ${(savedOverlay.width - 8).toString()} ${savedOverlay.height.toString()} M 8 ${savedOverlay.height.toString()} L 0 ${savedOverlay.height.toString()} L 0 ${(savedOverlay.height - 8).toString()}`}
                  fill="none"
                  stroke="var(--text-primary)"
                  strokeWidth="2"
                />
              </g>
            )}
          </g>
        )}

        {/* Keyboard Draft Visualization */}
        {isActive && keyboardDraftOverlay && !pointerDrag?.active && (
          <g className="coordinate-picker-overlay__keyboard-draft">
            {keyboardDraftOverlay.kind === "point" && (
              <g
                transform={`translate(${keyboardDraftOverlay.point.x.toString()}, ${keyboardDraftOverlay.point.y.toString()})`}
              >
                <circle
                  r={10}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeDasharray="3 3"
                />
                <line
                  x1={-14}
                  y1={0}
                  x2={14}
                  y2={0}
                  stroke="var(--accent)"
                  strokeWidth="2"
                />
                <line
                  x1={0}
                  y1={-14}
                  x2={0}
                  y2={14}
                  stroke="var(--accent)"
                  strokeWidth="2"
                />
              </g>
            )}

            {keyboardDraftOverlay.kind === "rectangle" && (
              <g
                transform={`translate(${keyboardDraftOverlay.topLeft.x.toString()}, ${keyboardDraftOverlay.topLeft.y.toString()})`}
              >
                <rect
                  width={keyboardDraftOverlay.width}
                  height={keyboardDraftOverlay.height}
                  fill="color-mix(in oklch, var(--accent) 12%, transparent)"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
              </g>
            )}
          </g>
        )}

        {/* Active Pointer Drag Draft */}
        {activePointerRectPreview && (
          <g
            className="coordinate-picker-overlay__pointer-draft"
            transform={`translate(${activePointerRectPreview.topLeft.x.toString()}, ${activePointerRectPreview.topLeft.y.toString()})`}
          >
            <rect
              width={activePointerRectPreview.width}
              height={activePointerRectPreview.height}
              fill="color-mix(in oklch, var(--accent) 12%, transparent)"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
          </g>
        )}
      </svg>

      {/* Size Badge */}
      {visibleRectangleDraft && (
        <div
          className="coordinate-picker-overlay__badge font-code"
          style={{
            position: "absolute",
            left: Math.max(
              0,
              visibleRectangleDraft.topLeft.x +
                visibleRectangleDraft.width / 2 -
                32,
            ),
            top: Math.max(
              0,
              visibleRectangleDraft.topLeft.y +
                visibleRectangleDraft.height +
                4,
            ),
            padding: "2px 6px",
            borderRadius: "4px",
            background: "var(--surface-elevated)",
            color: "var(--text-primary)",
            fontSize: "11px",
            boxShadow: "var(--shadow-raised)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {`${visibleRectangleDraft.sourceWidth.toString()} × ${visibleRectangleDraft.sourceHeight.toString()}`}
        </div>
      )}
    </div>
  );
}
