import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

export interface ResizeHandleProps {
  ariaLabel: string;
  axis: "horizontal" | "vertical";
  maximum: number;
  minimum: number;
  onChange: (delta: number) => void;
  value: number;
}

export function ResizeHandle({
  ariaLabel,
  axis,
  maximum,
  minimum,
  onChange,
  value,
}: ResizeHandleProps) {
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startPosition = axis === "horizontal" ? event.clientX : event.clientY;
    let previousDelta = 0;

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const currentPosition =
        axis === "horizontal" ? pointerEvent.clientX : pointerEvent.clientY;
      const nextDelta = currentPosition - startPosition;
      onChange(nextDelta - previousDelta);
      previousDelta = nextDelta;
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const negativeKey = axis === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const positiveKey = axis === "horizontal" ? "ArrowRight" : "ArrowDown";
    if (event.key !== negativeKey && event.key !== positiveKey) {
      return;
    }

    event.preventDefault();
    onChange(event.key === positiveKey ? 8 : -8);
  };

  return (
    <div
      className={`resize-handle resize-handle--${axis}`}
      role="separator"
      aria-label={ariaLabel}
      aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
      aria-valuemax={maximum}
      aria-valuemin={minimum}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    />
  );
}
