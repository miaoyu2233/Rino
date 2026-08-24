import { motion, useReducedMotion } from "motion/react";
import { useId, useMemo, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ProductIcon } from "../../design-system/icons/ProductIcon";
import type { ProductIconKey } from "../../design-system/icons/product-icons";
import { motionTransitions } from "../../design-system/motion";
import { useNodeExecutionView } from "../../ipc/runtime-execution-store";
import {
  resolveOcrPresentation,
  type OcrPresentation,
} from "./ocr-inspector-model";

export interface OcrInspectorSectionProps {
  graphId: string;
  nodeId: string;
  roiConnected: boolean;
  effectiveConfidenceThreshold: number | undefined;
}

interface OcrFactProps {
  icon: ProductIconKey;
  label: string;
  value: ReactNode;
  description?: string;
}

function OcrFact({ icon, label, value, description }: OcrFactProps) {
  return (
    <div className="ocr-inspector__fact">
      <dt>
        <ProductIcon icon={icon} size="small" />
        {label}
      </dt>
      <dd>
        <strong>{value}</strong>
        {description === undefined ? null : <span>{description}</span>}
      </dd>
    </div>
  );
}

interface OcrResultDetailsProps {
  presentation: Extract<
    OcrPresentation,
    { state: "matched" | "noMatch" | "incomplete" }
  >;
}

function OcrResultDetails({ presentation }: OcrResultDetailsProps) {
  const { t, i18n } = useTranslation();
  const bestText =
    presentation.state === "matched" || presentation.state === "incomplete"
      ? presentation.bestText
      : undefined;
  const bestRect =
    presentation.state === "matched" || presentation.state === "incomplete"
      ? presentation.bestRect
      : undefined;
  const bestTextTruncated =
    presentation.state === "matched" || presentation.state === "incomplete"
      ? presentation.bestTextTruncated
      : false;
  if (
    presentation.candidateCount === undefined &&
    bestText === undefined &&
    bestRect === undefined
  ) {
    return null;
  }

  return (
    <dl className="ocr-inspector__result-details">
      {presentation.candidateCount === undefined ? null : (
        <div>
          <dt>{t("graph.inspector.ocr.result.candidateCount")}</dt>
          <dd>
            {new Intl.NumberFormat(
              i18n.resolvedLanguage ?? i18n.language,
            ).format(presentation.candidateCount)}
          </dd>
        </div>
      )}
      {bestText === undefined ? null : (
        <div>
          <dt>{t("graph.inspector.ocr.result.bestText")}</dt>
          <dd>
            {bestText}
            {bestTextTruncated ? (
              <span className="ocr-inspector__truncated">
                {t("graph.inspector.ocr.result.truncated")}
              </span>
            ) : null}
          </dd>
        </div>
      )}
      {bestRect === undefined ? null : (
        <div>
          <dt>{t("graph.inspector.ocr.result.bestRect")}</dt>
          <dd className="font-code">{bestRect}</dd>
        </div>
      )}
    </dl>
  );
}

const RESULT_COPY = {
  idle: {
    icon: "runtime.idle",
    titleKey: "graph.inspector.ocr.result.idleTitle",
    descriptionKey: "graph.inspector.ocr.result.idleDescription",
  },
  running: {
    icon: "runtime.running",
    titleKey: "graph.inspector.ocr.result.runningTitle",
    descriptionKey: "graph.inspector.ocr.result.runningDescription",
  },
  matched: {
    icon: "runtime.succeeded",
    titleKey: "graph.inspector.ocr.result.matchedTitle",
    descriptionKey: "graph.inspector.ocr.result.matchedDescription",
  },
  noMatch: {
    icon: "runtime.warning",
    titleKey: "graph.inspector.ocr.result.noMatchTitle",
    descriptionKey: "graph.inspector.ocr.result.noMatchDescription",
  },
  incomplete: {
    icon: "runtime.warning",
    titleKey: "graph.inspector.ocr.result.incompleteTitle",
    descriptionKey: "graph.inspector.ocr.result.incompleteDescription",
  },
  failed: {
    icon: "runtime.failed",
    titleKey: "graph.inspector.ocr.result.failedTitle",
    descriptionKey: "graph.inspector.ocr.result.failedDescription",
  },
} as const satisfies Record<
  OcrPresentation["state"],
  { icon: ProductIconKey; titleKey: string; descriptionKey: string }
>;

export function OcrInspectorSection({
  graphId,
  nodeId,
  roiConnected,
  effectiveConfidenceThreshold,
}: OcrInspectorSectionProps) {
  const { t, i18n } = useTranslation();
  const execution = useNodeExecutionView(graphId, nodeId);
  const presentation = useMemo(
    () => resolveOcrPresentation(execution),
    [execution],
  );
  const reducedMotion = useReducedMotion();
  const sectionTitleId = useId();
  const resultTitleId = useId();
  const copy = RESULT_COPY[presentation.state];
  const percentage =
    effectiveConfidenceThreshold === undefined
      ? undefined
      : effectiveConfidenceThreshold * 100;
  const formattedConfidence =
    effectiveConfidenceThreshold === undefined
      ? t("graph.inspector.ocr.confidenceUnavailable")
      : new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, {
          style: "percent",
          maximumFractionDigits: 1,
        }).format(effectiveConfidenceThreshold);
  const meterStyle =
    percentage === undefined
      ? undefined
      : ({ "--ocr-confidence": `${percentage.toString()}%` } as CSSProperties);
  const resultRole =
    presentation.state === "failed"
      ? "alert"
      : presentation.state === "running"
        ? "status"
        : "group";

  return (
    <section
      className="inspector-section ocr-inspector"
      aria-labelledby={sectionTitleId}
    >
      <h3 id={sectionTitleId} className="inspector-section__title">
        <ProductIcon icon="recognition.ocr" size="small" />
        {t("graph.inspector.ocr.title")}
      </h3>

      <dl className="ocr-inspector__facts">
        <OcrFact
          icon="recognition.ocr"
          label={t("graph.inspector.ocr.methodLabel")}
          value={t("graph.inspector.ocr.methodValue")}
          description={t("graph.inspector.ocr.methodDescription")}
        />
        <OcrFact
          icon="node.coordinate"
          label={t("graph.inspector.ocr.roiLabel")}
          value={t(
            roiConnected
              ? "graph.inspector.ocr.roiConnected"
              : "graph.inspector.ocr.roiFullImage",
          )}
        />
        <OcrFact
          icon="node.compare"
          label={t("graph.inspector.ocr.confidenceLabel")}
          value={formattedConfidence}
          description={t("graph.inspector.ocr.confidenceDescription")}
        />
      </dl>

      {percentage === undefined ? null : (
        <div
          className="ocr-inspector__confidence"
          role="meter"
          aria-label={t("graph.inspector.ocr.confidenceLabel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
          aria-valuetext={formattedConfidence}
          style={meterStyle}
        >
          <span />
        </div>
      )}

      <div className="ocr-inspector__result-heading">
        {t("graph.inspector.ocr.result.title")}
      </div>
      <motion.div
        key={`${String(execution?.activationId ?? "idle")}:${presentation.state}`}
        className="ocr-inspector__result"
        data-state={presentation.state}
        role={resultRole}
        aria-labelledby={resultTitleId}
        aria-live={presentation.state === "running" ? "polite" : undefined}
        aria-atomic={presentation.state === "running" ? true : undefined}
        initial={reducedMotion ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reducedMotion ? { duration: 0 } : motionTransitions.standard
        }
      >
        <ProductIcon icon={copy.icon} />
        <div className="ocr-inspector__result-copy">
          <strong id={resultTitleId}>{t(copy.titleKey)}</strong>
          <p>{t(copy.descriptionKey)}</p>
          {presentation.state === "failed" &&
          presentation.errorCode !== undefined ? (
            <code className="font-code">{presentation.errorCode}</code>
          ) : null}
          {presentation.state === "matched" ||
          presentation.state === "noMatch" ||
          presentation.state === "incomplete" ? (
            <OcrResultDetails presentation={presentation} />
          ) : null}
        </div>
      </motion.div>
    </section>
  );
}
