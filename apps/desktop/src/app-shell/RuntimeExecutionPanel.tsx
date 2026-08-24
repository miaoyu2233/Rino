import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ProductIcon } from "../design-system/icons/ProductIcon";
import type { ProductIconKey } from "../design-system/icons/product-icons";
import { revealProblem } from "../graph/problems/problem-focus";
import { useNodeRegistry } from "../graph/registry/registry-store";
import { useActiveDocument } from "../graph/store/document-store";
import {
  useRuntimeExecutionStore,
  type GraphRunView,
  type NodeActivationView,
  type RuntimeLogView,
} from "../ipc/runtime-execution-store";
import {
  buildNodeNameIndex,
  getResolvedNodeName,
  type NodeNameIndex,
} from "./runtime-presentation-model";

const PAGE_SIZE = 200;
const EMPTY_ACTIVATIONS: readonly NodeActivationView[] = [];
const EMPTY_LOGS: readonly RuntimeLogView[] = [];

const runStateIcons = {
  starting: "runtime.running",
  running: "runtime.running",
  cancelling: "runtime.warning",
  succeeded: "runtime.succeeded",
  failed: "runtime.failed",
  cancelled: "runtime.disabled",
} as const satisfies Record<string, ProductIconKey>;

const logLevelIcons = {
  debug: "runtime.disabled",
  info: "runtime.running",
  warning: "runtime.warning",
  error: "runtime.failed",
} as const satisfies Record<string, ProductIconKey>;

export interface RuntimeExecutionPanelProps {
  mode: "execution" | "logs" | "values";
}

interface RunSummaryProps {
  run: GraphRunView;
}

function RunSummary({ run }: RunSummaryProps) {
  const { t } = useTranslation();

  return (
    <div className="runtime-panel__summary" data-state={run.state}>
      <ProductIcon icon={runStateIcons[run.state]} size="small" />
      <span
        role="status"
        aria-live="polite"
        className="runtime-panel__state-text"
      >
        {t(`runtime.runState.${run.state}`)}
      </span>
      {run.stepCount !== undefined ? (
        <span className="font-code">
          {t("runtime.execution.steps", { count: run.stepCount })}
        </span>
      ) : null}
      {run.tokensCreated !== undefined ? (
        <span className="font-code">
          {t("runtime.execution.tokensCreated", { count: run.tokensCreated })}
        </span>
      ) : null}
      {run.pureCacheHits !== undefined ? (
        <span className="font-code">
          {t("runtime.execution.cacheHits", { count: run.pureCacheHits })}
        </span>
      ) : null}
      {run.state === "failed" && run.terminalError?.code ? (
        <span className="runtime-panel__error font-code">
          {t("runtime.execution.terminalError", {
            code: run.terminalError.code,
          })}
        </span>
      ) : null}
    </div>
  );
}

function activationKey(
  nodeId: string,
  tokenId: number,
  activationId: number,
): string {
  return `${nodeId}:${String(tokenId)}:${String(activationId)}`;
}

export function RuntimeExecutionPanel({ mode }: RuntimeExecutionPanelProps) {
  const { i18n, t } = useTranslation();
  const language = i18n.language;

  const run = useRuntimeExecutionStore((state) => state.run);
  const activations = useRuntimeExecutionStore((state) =>
    mode === "logs" ? EMPTY_ACTIVATIONS : state.activations,
  );
  const logs = useRuntimeExecutionStore((state) =>
    mode === "logs" ? state.logs : EMPTY_LOGS,
  );

  const document = useActiveDocument();
  const registry = useNodeRegistry();

  const currentRunKey = run
    ? `${run.runId ?? ""}:${String(run.generation)}`
    : "";
  const [prevRunKey, setPrevRunKey] = useState(currentRunKey);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [hasNewActivity, setHasNewActivity] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);

  if (currentRunKey !== prevRunKey) {
    setPrevRunKey(currentRunKey);
    setVisibleCount(PAGE_SIZE);
    setHasNewActivity(false);
  }

  useEffect(() => {
    isNearBottomRef.current = true;
  }, [currentRunKey]);

  const targetGraph = useMemo(
    () => document?.graphs.find((g) => g.graphId === run?.graphId),
    [document, run?.graphId],
  );

  const nodeNameIndex: NodeNameIndex = useMemo(
    () => buildNodeNameIndex(targetGraph, registry, t, i18n, language),
    [targetGraph, registry, t, i18n, language],
  );

  const totalSourceCount = mode === "logs" ? logs.length : activations.length;

  useEffect(() => {
    const el = listRef.current;
    if (!el) {
      return;
    }
    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setHasNewActivity(false);
    } else {
      setHasNewActivity(true);
    }
  }, [totalSourceCount]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) {
      return;
    }
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceToBottom <= 24;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) {
      setHasNewActivity(false);
    }
  };

  const handleScrollToBottom = () => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      isNearBottomRef.current = true;
      setHasNewActivity(false);
    }
  };

  const handleShowEarlier = () => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  };

  if (run === undefined) {
    return (
      <div className="runtime-panel">
        <p className="runtime-panel__empty">
          {t(`shell.debug.empty.${mode}.title`)}
        </p>
      </div>
    );
  }

  const visibleActivations = activations.slice(-visibleCount);
  const visibleLogs = logs.slice(-visibleCount);

  const olderCount = Math.max(0, totalSourceCount - visibleCount);

  let latestRunningKey: string | undefined;
  if (
    run.state === "running" ||
    run.state === "starting" ||
    run.state === "cancelling"
  ) {
    for (let i = activations.length - 1; i >= 0; i--) {
      if (activations[i]?.state === "running") {
        const item = activations[i];
        if (item) {
          latestRunningKey = activationKey(
            item.nodeId,
            item.tokenId,
            item.activationId,
          );
        }
        break;
      }
    }
  }

  const renderContent = () => {
    if (mode === "logs") {
      if (logs.length === 0) {
        return (
          <p className="runtime-panel__empty">
            {t("shell.debug.empty.logs.title")}
          </p>
        );
      }
      return (
        <ol
          className="runtime-panel__list"
          aria-label={t("runtime.execution.logHistoryLabel")}
          aria-live="off"
        >
          {visibleLogs.map((log: RuntimeLogView) => {
            const nameInfo = getResolvedNodeName(nodeNameIndex, log.nodeId, t);
            return (
              <li key={log.logSequence} className="runtime-panel__row">
                <span className="runtime-panel__sequence font-code">
                  {log.logSequence}
                </span>
                <span className="runtime-panel__level" data-level={log.level}>
                  <ProductIcon
                    icon={logLevelIcons[log.level]}
                    size="small"
                    className="runtime-panel__level-icon"
                  />
                  <span>{t(`runtime.logLevel.${log.level}`)}</span>
                </span>
                <span
                  className="runtime-panel__node-alias"
                  title={nameInfo.title}
                >
                  {nameInfo.title}
                </span>
                <span className="runtime-panel__identity font-code">
                  {nameInfo.shortNodeId}
                </span>
                <span className="runtime-panel__message">{log.message}</span>
              </li>
            );
          })}
        </ol>
      );
    }

    if (mode === "values") {
      const values = visibleActivations.flatMap((act: NodeActivationView) =>
        act.valueSummaries.map((value) => ({
          activation: act,
          value,
        })),
      );

      if (values.length === 0) {
        return (
          <p className="runtime-panel__empty">
            {t("shell.debug.empty.values.title")}
          </p>
        );
      }

      return (
        <ol
          className="runtime-panel__list"
          aria-label={t("runtime.execution.valueHistoryLabel")}
        >
          {values.map(({ activation: act, value }) => {
            const nameInfo = getResolvedNodeName(nodeNameIndex, act.nodeId, t);
            const valKey = `${act.nodeId}:${String(act.tokenId)}:${String(act.activationId)}:${value.portId}:${String(value.generation)}`;

            return (
              <li key={valKey} className="runtime-panel__row">
                <span className="runtime-panel__sequence font-code">
                  {act.firstRunSequence}
                </span>
                <span
                  className="runtime-panel__node-alias"
                  title={nameInfo.title}
                >
                  {nameInfo.title}
                </span>
                <span className="runtime-panel__port-id font-code">
                  {value.portId}
                </span>
                <span className="runtime-panel__kind">
                  {t(`runtime.execution.kind.${value.kind}`)}
                </span>
                <span className="runtime-panel__message font-code">
                  <span className="runtime-panel__preview">
                    {value.preview}
                  </span>
                  {value.itemCount !== undefined ? (
                    <span className="runtime-panel__dim-badge">
                      {t("runtime.execution.itemCount", {
                        count: value.itemCount,
                      })}
                    </span>
                  ) : null}
                  {value.width !== undefined && value.height !== undefined ? (
                    <span className="runtime-panel__dim-badge">
                      {t("runtime.execution.dimensions", {
                        width: value.width,
                        height: value.height,
                      })}
                    </span>
                  ) : null}
                  {value.truncated ? (
                    <span className="runtime-panel__truncated">
                      {t("runtime.execution.truncated")}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      );
    }

    if (activations.length === 0) {
      return (
        <p className="runtime-panel__empty">
          {t("shell.debug.empty.execution.title")}
        </p>
      );
    }

    return (
      <ol
        className="runtime-panel__list"
        aria-label={t("runtime.execution.executionHistoryLabel")}
      >
        {visibleActivations.map((act: NodeActivationView) => {
          const key = activationKey(act.nodeId, act.tokenId, act.activationId);
          const isCurrentStep = key === latestRunningKey;
          const nameInfo = getResolvedNodeName(nodeNameIndex, act.nodeId, t);

          const handleReveal = () => {
            if (nameInfo.isAvailable && run.graphId) {
              revealProblem({
                graphId: run.graphId,
                nodeId: act.nodeId,
                edgeId: undefined,
                portId: undefined,
              });
            }
          };

          return (
            <li key={key}>
              <button
                type="button"
                className="runtime-panel__row runtime-panel__row--action"
                aria-current={isCurrentStep ? "step" : undefined}
                disabled={!nameInfo.isAvailable}
                title={
                  nameInfo.isAvailable
                    ? nameInfo.title
                    : t("runtime.execution.nodeUnavailable")
                }
                onClick={handleReveal}
              >
                <span className="runtime-panel__sequence font-code">
                  {act.firstRunSequence}
                </span>
                <ProductIcon icon={`runtime.${act.state}`} size="small" />
                <span className="runtime-panel__node-alias">
                  {nameInfo.title}
                </span>
                {nameInfo.secondaryTitle ? (
                  <span
                    className="runtime-panel__secondary-title"
                    title={nameInfo.secondaryTitle}
                  >
                    {nameInfo.secondaryTitle}
                  </span>
                ) : null}
                <span className="runtime-panel__identity font-code">
                  {nameInfo.shortNodeId}
                </span>
                <span className="runtime-panel__state-label">
                  {t(`graph.node.runtime.${act.state}`)}
                </span>
                {act.errorCode ? (
                  <span className="runtime-panel__error font-code">
                    {act.errorCode}
                  </span>
                ) : null}
                {isCurrentStep ? (
                  <span className="runtime-panel__current-step">
                    {t("runtime.execution.currentStep")}
                  </span>
                ) : null}
                {!nameInfo.isAvailable ? (
                  <span className="sr-only">
                    {t("runtime.execution.nodeUnavailable")}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <div className="runtime-panel" data-mode={mode}>
      <RunSummary run={run} />
      {olderCount > 0 ? (
        <div className="runtime-panel__pagination-header">
          <button
            type="button"
            className="runtime-panel__show-earlier"
            onClick={handleShowEarlier}
          >
            {t("runtime.execution.showEarlier", { count: olderCount })}
          </button>
        </div>
      ) : null}
      <div
        className="runtime-panel__scroll-area"
        ref={listRef}
        onScroll={handleScroll}
      >
        {renderContent()}
      </div>
      {hasNewActivity ? (
        <button
          type="button"
          className="runtime-panel__new-activity"
          onClick={handleScrollToBottom}
        >
          {t("runtime.execution.newActivity")}
        </button>
      ) : null}
    </div>
  );
}
