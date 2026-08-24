import type { DeviceInteractionV1 } from "@rino/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  clientPointToPreview,
  previewPointToSource,
  sourcePointToPreview,
  type PreviewPoint,
  type PreviewTransform,
  type SourcePoint,
} from "./geometry";
import {
  cancelUiAnimationFrame,
  requestUiAnimationFrame,
} from "../preferences/ui-animation-frame-scheduler";

const DRAG_THRESHOLD_PIXELS = 7;
const LONG_PRESS_THRESHOLD_MILLISECONDS = 550;
const MINIMUM_LONG_PRESS_MILLISECONDS = 500;
const MAXIMUM_GESTURE_MILLISECONDS = 5000;
const MINIMUM_SWIPE_MILLISECONDS = 50;

interface PointerGesture {
  pointerId: number;
  startedAt: number;
  startClient: PreviewPoint;
  startSource: SourcePoint;
  latestClient: PreviewPoint;
  latestSource: SourcePoint;
}

export interface DeviceControlOverlayProps {
  active: boolean;
  disabled: boolean;
  label: string;
  transform: PreviewTransform;
  onInteraction: (interaction: DeviceInteractionV1) => void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function localPoint(
  event: PointerEvent<HTMLDivElement>,
  transform: PreviewTransform,
): PreviewPoint | undefined {
  const bounds = event.currentTarget.getBoundingClientRect();
  return (
    clientPointToPreview(transform, bounds, {
      x: event.clientX,
      y: event.clientY,
    }) ?? {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
  );
}

export function DeviceControlOverlay({
  active,
  disabled,
  label,
  transform,
  onInteraction,
}: DeviceControlOverlayProps) {
  const gestureRef = useRef<PointerGesture | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const [gestureVisual, setGestureVisual] = useState<PointerGesture>();
  const [keyboardPoint, setKeyboardPoint] = useState<SourcePoint>(() => ({
    x: Math.floor(transform.source.width / 2),
    y: Math.floor(transform.source.height / 2),
    coordinateSpaceId: transform.source.coordinateSpaceId,
    sourceGeneration: transform.source.sourceGeneration,
  }));

  useEffect(() => {
    window.queueMicrotask(() => {
      setKeyboardPoint({
        x: Math.floor(transform.source.width / 2),
        y: Math.floor(transform.source.height / 2),
        coordinateSpaceId: transform.source.coordinateSpaceId,
        sourceGeneration: transform.source.sourceGeneration,
      });
    });
  }, [
    transform.source.coordinateSpaceId,
    transform.source.height,
    transform.source.sourceGeneration,
    transform.source.width,
  ]);

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) {
        cancelUiAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  const publishGestureVisual = useCallback(() => {
    if (frameRef.current !== undefined) {
      return;
    }
    frameRef.current = requestUiAnimationFrame(() => {
      frameRef.current = undefined;
      setGestureVisual(gestureRef.current);
    });
  }, []);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const acceptsPointer = event.isPrimary || event.pointerType === "mouse";
      if (!active || disabled || event.button !== 0 || !acceptsPointer) {
        return;
      }
      const point = localPoint(event, transform);
      if (point === undefined) {
        return;
      }
      const source = previewPointToSource(transform, point);
      if (source === undefined) {
        return;
      }
      event.preventDefault();
      event.currentTarget.focus();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is an optimization; the gesture remains valid while the
        // pointer stays over the preview surface.
      }
      const gesture: PointerGesture = {
        pointerId: event.pointerId,
        startedAt: event.timeStamp,
        startClient: point,
        startSource: source,
        latestClient: point,
        latestSource: source,
      };
      gestureRef.current = gesture;
      setGestureVisual(gesture);
    },
    [active, disabled, transform],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (gesture?.pointerId !== event.pointerId) {
        return;
      }
      const point = localPoint(event, transform);
      if (point === undefined) {
        return;
      }
      const source = previewPointToSource(transform, point);
      if (source === undefined) {
        return;
      }
      gesture.latestClient = point;
      gesture.latestSource = source;
      publishGestureVisual();
    },
    [publishGestureVisual, transform],
  );

  const clearGesture = useCallback(() => {
    gestureRef.current = undefined;
    setGestureVisual(undefined);
  }, []);

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (gesture?.pointerId !== event.pointerId) {
        return;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const elapsed = clamp(
        Math.round(event.timeStamp - gesture.startedAt),
        1,
        MAXIMUM_GESTURE_MILLISECONDS,
      );
      const distance = Math.hypot(
        gesture.latestClient.x - gesture.startClient.x,
        gesture.latestClient.y - gesture.startClient.y,
      );
      clearGesture();
      if (distance >= DRAG_THRESHOLD_PIXELS) {
        onInteraction({
          kind: "swipe",
          start: gesture.startSource,
          end: gesture.latestSource,
          durationMilliseconds: clamp(
            elapsed,
            MINIMUM_SWIPE_MILLISECONDS,
            MAXIMUM_GESTURE_MILLISECONDS,
          ),
        });
      } else if (elapsed >= LONG_PRESS_THRESHOLD_MILLISECONDS) {
        onInteraction({
          kind: "longPress",
          point: gesture.startSource,
          durationMilliseconds: clamp(
            elapsed,
            MINIMUM_LONG_PRESS_MILLISECONDS,
            MAXIMUM_GESTURE_MILLISECONDS,
          ),
        });
      } else {
        onInteraction({ kind: "click", point: gesture.startSource });
      }
    },
    [clearGesture, onInteraction],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!active || disabled || event.nativeEvent.isComposing) {
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      const movement = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      }[event.key];
      if (movement !== undefined) {
        event.preventDefault();
        setKeyboardPoint((current) => ({
          ...current,
          x: clamp(current.x + movement.x, 0, transform.source.width - 1),
          y: clamp(current.y + movement.y, 0, transform.source.height - 1),
        }));
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onInteraction({ kind: "click", point: keyboardPoint });
      }
    },
    [active, disabled, keyboardPoint, onInteraction, transform.source],
  );

  if (!active) {
    return null;
  }

  const keyboardPreviewPoint = sourcePointToPreview(transform, keyboardPoint);

  return (
    <div
      className="device-control-overlay"
      aria-label={label}
      aria-disabled={disabled}
      role="application"
      tabIndex={disabled ? -1 : 0}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 10,
        cursor: disabled ? "wait" : "crosshair",
        touchAction: "none",
        userSelect: "none",
      }}
      onKeyDown={handleKeyDown}
      onPointerCancel={clearGesture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <span
        className="device-control-overlay__cursor"
        style={{
          left: keyboardPreviewPoint.x,
          top: keyboardPreviewPoint.y,
        }}
      />
      {gestureVisual === undefined ? null : (
        <svg
          className="device-control-overlay__gesture"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        >
          <line
            x1={gestureVisual.startClient.x}
            y1={gestureVisual.startClient.y}
            x2={gestureVisual.latestClient.x}
            y2={gestureVisual.latestClient.y}
          />
          <circle
            cx={gestureVisual.latestClient.x}
            cy={gestureVisual.latestClient.y}
            r="5"
          />
        </svg>
      )}
    </div>
  );
}
