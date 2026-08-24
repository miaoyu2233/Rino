import { useCallback, useMemo, type DragEvent as ReactDragEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import type { LocalizationKey } from "../../diagnostics/diagnostic-model";
import { notify } from "../../diagnostics/diagnostic-store";
import { clearDragPayload, writeDragPayload } from "../canvas/canvas-drag";
import { visibleCanvasCenter } from "../canvas/canvas-viewport-store";
import {
  buildCreateFunctionGraphCommand,
  buildInsertFunctionCallCommand,
  type FunctionAuthoringFailureReason,
} from "./function-authoring";
import { createIdentifier } from "../../platform/identifiers";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";

const functionFailureTitleKeys: Record<
  FunctionAuthoringFailureReason,
  LocalizationKey
> = {
  graphMissing: "graph.function.library.errors.operationFailed",
  graphLimitReached: "graph.function.library.errors.limit",
  graphNotFunction: "graph.function.library.errors.operationFailed",
  functionSignatureMissing: "graph.function.library.errors.operationFailed",
  functionParameterLimitReached: "graph.function.library.errors.limit",
  functionParameterIdInvalid: "graph.function.library.errors.operationFailed",
  functionParameterIdDuplicate: "graph.function.library.errors.operationFailed",
  functionParameterPortIdInvalid:
    "graph.function.library.errors.operationFailed",
  functionParameterPortIdReserved:
    "graph.function.library.errors.operationFailed",
  functionParameterPortIdDuplicate:
    "graph.function.library.errors.operationFailed",
  functionParameterNameInvalid: "graph.function.library.errors.name",
  functionParameterNameDuplicate: "graph.function.library.errors.name",
  functionParameterKindInvalid: "graph.function.library.errors.operationFailed",
  nameInvalid: "graph.function.library.errors.name",
  notFunction: "graph.function.library.errors.operationFailed",
  parameterMissing: "graph.function.library.errors.operationFailed",
  directionInvalid: "graph.function.library.errors.operationFailed",
  identifierInvalid: "graph.function.library.errors.operationFailed",
  identifierDuplicate: "graph.function.library.errors.operationFailed",
  targetGraphMissing: "graph.function.library.errors.target",
  targetNotFunction: "graph.function.library.errors.target",
  selfCall: "graph.function.library.errors.self",
  recursion: "graph.function.library.errors.recursion",
  depthLimit: "graph.function.library.errors.depth",
};

function functionNameForOrdinal(
  existingNames: ReadonlySet<string>,
  translate: (
    key: "graph.function.library.defaultName",
    options: { count: number },
  ) => string,
): string {
  let ordinal = 1;
  let candidate = translate("graph.function.library.defaultName", {
    count: ordinal,
  });
  while (
    existingNames.has(
      candidate.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
    )
  ) {
    ordinal += 1;
    candidate = translate("graph.function.library.defaultName", {
      count: ordinal,
    });
  }
  return candidate;
}

function normalizedGraphNames(
  graphs: readonly { name: string }[],
): ReadonlySet<string> {
  return new Set(
    graphs.map((graph) =>
      graph.name.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
    ),
  );
}

function notifyFunctionFailure(reason: FunctionAuthoringFailureReason): void {
  notify({ severity: "error", titleKey: functionFailureTitleKeys[reason] });
}

/** Compact project-local function graph catalog shown above ordinary node categories. */
export function FunctionLibrary() {
  const { t } = useTranslation();
  const document = useDocumentStore((store) => store.history?.document);
  const executionLocked = useDocumentStore((store) => store.executionLocked);
  const runCommand = useDocumentStore((store) => store.runCommand);
  const activeGraphId = useEditorSessionStore((store) => store.activeGraphId);
  const enterGraph = useEditorSessionStore((store) => store.enterGraph);

  const functions = useMemo(
    () => document?.graphs.filter((graph) => graph.kind === "function") ?? [],
    [document],
  );
  const activeGraph = document?.graphs.find(
    (graph) => graph.graphId === activeGraphId,
  );
  const canDrag =
    document !== undefined && activeGraph !== undefined && !executionLocked;
  const existingNames = useMemo(
    () => normalizedGraphNames(document?.graphs ?? []),
    [document],
  );

  const createFunction = useCallback(() => {
    if (document === undefined) {
      notify({
        severity: "info",
        titleKey: "graph.function.library.errors.noProject",
      });
      return;
    }
    const built = buildCreateFunctionGraphCommand(
      document,
      functionNameForOrdinal(existingNames, t),
      createIdentifier,
    );
    if (!built.ok) {
      notifyFunctionFailure(built.reason);
      return;
    }
    const outcome = runCommand(
      "graph.history.createFunction",
      built.value.command,
    );
    if (!outcome.ok) {
      notify({
        severity: "error",
        titleKey: "graph.function.library.errors.commandRejected",
      });
      return;
    }
    enterGraph(built.value.functionGraphId);
  }, [document, enterGraph, existingNames, runCommand, t]);

  const insertFunctionCall = useCallback(
    (targetFunctionGraphId: string) => {
      if (document === undefined || activeGraphId === undefined) {
        notify({
          severity: "info",
          titleKey: "graph.function.library.errors.noProject",
        });
        return;
      }
      const built = buildInsertFunctionCallCommand(
        document,
        activeGraphId,
        targetFunctionGraphId,
        visibleCanvasCenter(),
        createIdentifier,
      );
      if (!built.ok) {
        notifyFunctionFailure(built.reason);
        return;
      }
      const outcome = runCommand(
        "graph.history.insertFunctionCall",
        built.value.command,
      );
      if (!outcome.ok) {
        notify({
          severity: "error",
          titleKey: "graph.function.library.errors.commandRejected",
        });
      }
    },
    [activeGraphId, document, runCommand],
  );

  return (
    <section
      className="function-library"
      aria-label={t("graph.function.library.title")}
    >
      <div className="function-library__header">
        <span className="function-library__count">
          {t("graph.function.library.count", { count: functions.length })}
        </span>
        <Button
          size="compact"
          variant="primary"
          disabled={document === undefined || executionLocked}
          title={t("graph.function.library.create")}
          aria-label={t("graph.function.library.create")}
          onClick={createFunction}
        >
          <ProductIcon icon="action.add" size="small" />
          <span>{t("graph.function.library.create")}</span>
        </Button>
      </div>
      {document === undefined ? (
        <p className="function-library__empty">
          {t("graph.function.library.noProject")}
        </p>
      ) : functions.length === 0 ? (
        <p className="function-library__empty">
          {t("graph.function.library.empty")}
        </p>
      ) : (
        <ul className="function-library__list">
          {functions.map((graph) => {
            const isActive = graph.graphId === activeGraphId;
            const cannotInsert =
              executionLocked || activeGraph === undefined || isActive;
            return (
              <li key={graph.graphId} className="function-library__item">
                <button
                  type="button"
                  className="function-library__name"
                  title={t(
                    canDrag
                      ? "graph.function.library.dragHint"
                      : "graph.function.library.dragDisabled",
                    { name: graph.name },
                  )}
                  aria-description={t(
                    canDrag
                      ? "graph.function.library.dragHint"
                      : "graph.function.library.dragDisabled",
                    { name: graph.name },
                  )}
                  draggable={canDrag}
                  onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
                    if (!canDrag) {
                      event.preventDefault();
                      clearDragPayload();
                      return;
                    }
                    writeDragPayload(event.dataTransfer, {
                      kind: "function",
                      functionGraphId: graph.graphId,
                    });
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onDragEnd={clearDragPayload}
                  onClick={() => {
                    enterGraph(graph.graphId);
                  }}
                >
                  <ProductIcon icon="node.variable" size="small" />
                  <span>{graph.name}</span>
                </button>
                <div className="function-library__actions">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={cannotInsert}
                    title={
                      isActive
                        ? t("graph.function.library.selfCallDisabled")
                        : t("graph.function.library.insertCall")
                    }
                    aria-label={t("graph.function.library.insertCallFor", {
                      name: graph.name,
                    })}
                    onClick={() => {
                      insertFunctionCall(graph.graphId);
                    }}
                  >
                    <ProductIcon icon="action.add" size="small" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={executionLocked}
                    title={t("graph.function.library.edit")}
                    aria-label={t("graph.function.library.editFor", {
                      name: graph.name,
                    })}
                    onClick={() => {
                      enterGraph(graph.graphId);
                    }}
                  >
                    <ProductIcon icon="action.editTask" size="small" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
