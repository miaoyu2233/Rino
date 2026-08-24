import { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceInteractionV1 } from "@rino/contracts";

import { DeviceControlOverlay } from "./DeviceControlOverlay";
import {
  createFitPreviewTransform,
  type SourceCoordinateSpace,
} from "./geometry";

export interface ExpandedDevicePreviewProps {
  controlActive: boolean;
  controlDisabled: boolean;
  controlLabel: string;
  imageAlt: string;
  objectUrl: string;
  source: SourceCoordinateSpace;
  onInteraction: (interaction: DeviceInteractionV1) => void;
}

export function ExpandedDevicePreview({
  controlActive,
  controlDisabled,
  controlLabel,
  imageAlt,
  objectUrl,
  source,
  onInteraction,
}: ExpandedDevicePreviewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) {
        return;
      }
      setViewportSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const transform = useMemo(
    () =>
      viewportSize.width > 0 && viewportSize.height > 0
        ? createFitPreviewTransform(source, viewportSize)
        : undefined,
    [source, viewportSize],
  );

  return (
    <div ref={viewportRef} className="expanded-device-preview__screen">
      <img src={objectUrl} alt={imageAlt} draggable={false} />
      {transform === undefined ? null : (
        <DeviceControlOverlay
          active={controlActive}
          disabled={controlDisabled}
          label={controlLabel}
          transform={transform}
          onInteraction={onInteraction}
        />
      )}
    </div>
  );
}
