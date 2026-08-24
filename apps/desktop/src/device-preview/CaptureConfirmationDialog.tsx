import { useCallback, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Dialog, DialogContent } from "../components/ui/Dialog";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import type { CaptureWorkbenchState } from "./capture-workbench-controller";

export interface CaptureConfirmationDialogProps {
  state: CaptureWorkbenchState;
  onDisplayNameChange: (displayName: string) => void;
  onConfirm: () => void;
  onRetrySave: () => void;
  onDiscard: () => void;
  onReset: () => void;
}

export function CaptureConfirmationDialog({
  state,
  onDisplayNameChange,
  onConfirm,
  onRetrySave,
  onDiscard,
  onReset,
}: CaptureConfirmationDialogProps) {
  const { t } = useTranslation();
  const nameErrorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const isOpen = state.phase !== "idle";

  useEffect(() => {
    if (state.phase === "confirming" || state.phase === "filingFailed") {
      const timer = window.setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
      return () => {
        window.clearTimeout(timer);
      };
    }
    return undefined;
  }, [state.phase]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (state.phase === "completed" || state.phase === "failed") {
          onReset();
        } else if (
          state.phase === "confirming" ||
          state.phase === "filingFailed"
        ) {
          onDiscard();
        }
      }
    },
    [onDiscard, onReset, state.phase],
  );

  if (!isOpen) return null;

  const terminalErrorMessage =
    state.phase === "failed"
      ? t(`shell.device.captureWorkbench.failures.${state.reason}`)
      : undefined;

  const nameValidation =
    state.phase === "confirming" || state.phase === "filingFailed"
      ? state.nameValidation
      : undefined;

  const isNameValid = nameValidation?.ok === true;
  const nameConflict =
    nameValidation &&
    !nameValidation.ok &&
    "reason" in nameValidation &&
    nameValidation.reason === "collision"
      ? nameValidation
      : undefined;

  const suggestion =
    nameConflict && "suggestion" in nameConflict
      ? nameConflict.suggestion
      : undefined;

  const nameErrorMessage =
    nameValidation && !nameValidation.ok
      ? nameConflict
        ? t("shell.device.captureWorkbench.nameConflict")
        : t(`shell.device.captureWorkbench.nameErrors.${nameValidation.reason}`)
      : undefined;

  const canConfirm =
    (state.phase === "confirming" || state.phase === "filingFailed") &&
    isNameValid;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        title={
          state.phase === "saveFailed"
            ? t("shell.device.captureWorkbench.saveFailedTitle")
            : state.phase === "filingFailed"
              ? t("shell.device.captureWorkbench.filingFailedTitle")
              : state.phase === "completed"
                ? t("shell.device.captureWorkbench.completed")
                : t("shell.device.captureWorkbench.title")
        }
        closeLabel={t("common.actions.close")}
        className="capture-confirmation-dialog"
      >
        <div className="capture-confirmation-dialog__body">
          {("objectUrl" in state && state.objectUrl) ||
          (state.phase === "confirming" && state.objectUrl) ? (
            <div className="capture-confirmation-dialog__preview">
              <img
                src={"objectUrl" in state ? state.objectUrl : undefined}
                alt={t("shell.device.previewLabel")}
              />
            </div>
          ) : null}

          {state.phase === "preparing" ||
          state.phase === "committing" ||
          state.phase === "discarding" ? (
            <div className="capture-confirmation-dialog__step" role="status">
              <ProductIcon icon="runtime.running" />
              <span>
                {state.phase === "preparing"
                  ? t("shell.device.captureWorkbench.steps.preparing")
                  : state.phase === "discarding"
                    ? t("common.actions.cancel")
                    : t(`shell.device.captureWorkbench.steps.${state.step}`)}
              </span>
            </div>
          ) : null}

          {(state.phase === "confirming" || state.phase === "filingFailed") && (
            <div className="capture-confirmation-dialog__field-group">
              <label
                htmlFor="rino-capture-name-input"
                className="capture-confirmation-dialog__label"
              >
                {t("shell.device.captureWorkbench.nameLabel")}
              </label>
              <input
                ref={inputRef}
                id="rino-capture-name-input"
                type="text"
                className="ui-input capture-confirmation-dialog__input"
                placeholder={t("shell.device.captureWorkbench.namePlaceholder")}
                value={state.displayName}
                aria-describedby={nameErrorMessage ? nameErrorId : undefined}
                onChange={(e) => {
                  onDisplayNameChange(e.target.value);
                }}
              />
              <span className="capture-confirmation-dialog__name-hint">
                {t("shell.device.captureWorkbench.nameHint")}
              </span>

              {isNameValid ? (
                <div className="capture-confirmation-dialog__validation-success">
                  {t("shell.device.captureWorkbench.nameValid")}
                </div>
              ) : nameErrorMessage ? (
                <div
                  id={nameErrorId}
                  className="capture-confirmation-dialog__validation-error"
                  role="alert"
                >
                  <span>{nameErrorMessage}</span>
                  {suggestion ? (
                    <button
                      type="button"
                      className="capture-confirmation-dialog__suggestion-btn"
                      onClick={() => {
                        onDisplayNameChange(suggestion);
                      }}
                    >
                      {t("shell.device.captureWorkbench.suggestionAction", {
                        suggestion,
                      })}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {"descriptor" in state ? (
            <dl className="capture-confirmation-dialog__metadata">
              <div>
                <dt>{t("shell.device.captureWorkbench.dimensions")}</dt>
                <dd className="font-code">
                  {`${state.descriptor.width.toString()} × ${state.descriptor.height.toString()}`}
                </dd>
              </div>
              <div>
                <dt>{t("shell.device.captureWorkbench.origin")}</dt>
                <dd className="font-code">
                  {state.descriptor.sourceKind === "regionCapture"
                    ? "sourceRegion" in state
                      ? t("shell.device.captureWorkbench.regionOrigin", {
                          x: state.sourceRegion.x,
                          y: state.sourceRegion.y,
                        })
                      : t("shell.device.captureWorkbench.regionOriginUnknown")
                    : t("shell.device.captureWorkbench.fullFrameOrigin")}
                </dd>
              </div>
            </dl>
          ) : null}

          {state.phase === "saveFailed" ? (
            <div
              className="capture-confirmation-dialog__recovery-notice"
              role="alert"
            >
              <ProductIcon icon="runtime.warning" />
              <div>
                <p>
                  {t("shell.device.captureWorkbench.saveFailedDescription")}
                </p>
              </div>
            </div>
          ) : null}

          {state.phase === "failed" ? (
            <div
              className="capture-confirmation-dialog__failure-notice"
              role="alert"
            >
              <ProductIcon icon="runtime.warning" />
              <div>
                <span>{terminalErrorMessage}</span>
                {state.diagnosticCode ? (
                  <p className="font-code">
                    {t("shell.device.captureWorkbench.diagnosticCode", {
                      code: state.diagnosticCode,
                    })}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="capture-confirmation-dialog__footer">
            {state.phase === "saveFailed" ? (
              <button
                type="button"
                className="ui-button ui-button--primary"
                onClick={() => {
                  onRetrySave();
                }}
              >
                {t("shell.device.captureWorkbench.actions.retrySave")}
              </button>
            ) : state.phase === "completed" || state.phase === "failed" ? (
              <button
                type="button"
                className="ui-button ui-button--primary"
                onClick={() => {
                  onReset();
                }}
              >
                {t("shell.device.captureWorkbench.actions.reset")}
              </button>
            ) : state.phase === "confirming" ||
              state.phase === "filingFailed" ? (
              <>
                <button
                  type="button"
                  className="ui-button ui-button--secondary"
                  onClick={() => {
                    onDiscard();
                  }}
                >
                  {t("shell.device.captureWorkbench.actions.discard")}
                </button>
                <button
                  type="button"
                  className="ui-button ui-button--primary"
                  disabled={!canConfirm}
                  onClick={() => {
                    onConfirm();
                  }}
                >
                  {t("shell.device.captureWorkbench.actions.confirm")}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
