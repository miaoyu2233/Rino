import type { ImageAssetV1 } from "@rino/contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ProductIcon } from "../design-system/icons/ProductIcon";
import { readProjectImageAsset } from "../graph/project/project-actions";

export interface ScreenshotAssetThumbnailProps {
  asset: ImageAssetV1;
}

export function ScreenshotAssetThumbnail({
  asset,
}: ScreenshotAssetThumbnailProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLSpanElement>(null);
  const [objectUrl, setObjectUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let loadedObjectUrl: string | undefined;

    const load = async () => {
      try {
        const bytes = await readProjectImageAsset(
          asset.contentHash,
          asset.byteLength,
        );
        if (!active) {
          return;
        }
        loadedObjectUrl = URL.createObjectURL(
          new Blob([Uint8Array.from(bytes).buffer], { type: asset.mediaType }),
        );
        setObjectUrl(loadedObjectUrl);
      } catch {
        if (active) {
          setFailed(true);
        }
      }
    };

    const element = containerRef.current;
    let observer: IntersectionObserver | undefined;
    if (element && typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          void load();
        }
      });
      observer.observe(element);
    } else {
      void load();
    }

    return () => {
      active = false;
      observer?.disconnect();
      if (loadedObjectUrl !== undefined) {
        URL.revokeObjectURL(loadedObjectUrl);
      }
    };
  }, [asset.byteLength, asset.contentHash, asset.mediaType]);

  return (
    <span
      ref={containerRef}
      className="screenshot-browser__thumbnail"
      title={
        failed ? t("shell.screenshotBrowser.previewUnavailable") : undefined
      }
    >
      {objectUrl === undefined ? (
        <ProductIcon
          icon={failed ? "runtime.warning" : "recognition.template"}
        />
      ) : (
        <img src={objectUrl} alt="" draggable={false} />
      )}
    </span>
  );
}
