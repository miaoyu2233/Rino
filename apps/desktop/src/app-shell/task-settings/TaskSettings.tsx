import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent } from "../../components/ui/Dialog";
import { Select } from "../../components/ui/Select";
import { Tooltip } from "../../components/ui/Tooltip";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { notify } from "../../diagnostics/diagnostic-store";
import { translateDataKey } from "../../localization/data-keys";
import { commitNodeProperty } from "../../graph/fields/field-commands";
import { useDocumentStore } from "../../graph/store/document-store";
import { useTaskSettings } from "./useTaskSettings";
import type { TaskSettingView } from "./task-settings-model";
import "./task-settings.css";

export interface TaskSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocus: () => void;
}

function settingLabel(
  setting: TaskSettingView,
  translate: ReturnType<typeof useTranslation>["t"],
): string {
  const displayAlias = setting.displayAlias?.trim();
  return displayAlias !== undefined && displayAlias.length > 0
    ? displayAlias
    : translateDataKey(translate, setting.titleKey, setting.settingKey);
}

function TaskSettingRow({
  setting,
  locked,
}: {
  setting: TaskSettingView;
  locked: boolean;
}) {
  const { t } = useTranslation();
  const label = settingLabel(setting, t);
  const selectedIsKnown = setting.cases.some(
    (choice) => choice.caseId === setting.selectedCaseId,
  );

  return (
    <div className="task-settings__row">
      <div className="task-settings__row-heading">
        <span className="task-settings__label">
          {t("shell.tasks.taskSettings.settingLabel", { name: label })}
        </span>
        <code className="task-settings__key font-code">
          {setting.settingKey}
        </code>
      </div>
      {!setting.stateValid ? (
        <p className="task-settings__notice" data-severity="warning">
          <ProductIcon icon="runtime.warning" size="small" />
          <span>{t("shell.tasks.taskSettings.invalid")}</span>
        </p>
      ) : (
        <Select
          aria-label={t("shell.tasks.taskSettings.settingLabel", {
            name: label,
          })}
          disabled={locked}
          value={selectedIsKnown ? (setting.selectedCaseId ?? "") : ""}
          placeholder={
            setting.selectedCaseId ?? t("shell.tasks.taskSettings.empty")
          }
          options={setting.cases.map((choice) => ({
            value: choice.caseId,
            label: choice.label,
          }))}
          onValueChange={(value) => {
            if (!commitNodeProperty(setting.nodeId, "selectedCaseId", value)) {
              notify({
                severity: "error",
                titleKey: "shell.tasks.errors.commandRejected",
              });
            }
          }}
        />
      )}
      {setting.unmatched ? (
        <p className="task-settings__notice" data-severity="warning">
          {t("shell.tasks.taskSettings.unmatched")}
        </p>
      ) : null}
    </div>
  );
}

export function TaskSettingsDialog({
  open,
  onOpenChange,
  restoreFocus,
}: TaskSettingsDialogProps) {
  const { t } = useTranslation();
  const settings = useTaskSettings();
  const locked = useDocumentStore((state) => state.executionLocked);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="task-settings-dialog"
        closeLabel={t("common.actions.close")}
        title={t("shell.tasks.taskSettings.title")}
        description={t("shell.tasks.taskSettings.description")}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <div className="task-settings">
          {locked ? (
            <p className="task-settings__locked" role="status">
              <ProductIcon icon="runtime.running" size="small" />
              <span>{t("shell.tasks.taskSettings.locked")}</span>
            </p>
          ) : null}
          {settings.length === 0 ? (
            <p className="task-settings__empty">
              {t("shell.tasks.taskSettings.empty")}
            </p>
          ) : (
            <div
              className="task-settings__list"
              aria-label={t("shell.tasks.taskSettings.title")}
            >
              {settings.map((setting) => (
                <TaskSettingRow
                  key={setting.nodeId}
                  locked={locked}
                  setting={setting}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TaskSettingsTrigger() {
  const { t } = useTranslation();
  const settings = useTaskSettings();
  const hasDocument = useDocumentStore((state) => state.history !== undefined);
  const locked = useDocumentStore((state) => state.executionLocked);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const openDialog = useCallback(() => {
    if (!hasDocument || locked || settings.length === 0) {
      return;
    }
    triggerRef.current =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
    setOpen(true);
  }, [hasDocument, locked, settings.length]);

  if (settings.length === 0) {
    return null;
  }

  const button = (
    <Button
      ref={triggerRef}
      aria-label={t("shell.tasks.taskSettings.open")}
      disabled={!hasDocument || locked}
      size="icon"
      variant="ghost"
      onClick={openDialog}
    >
      <ProductIcon icon="action.settings" />
    </Button>
  );

  return (
    <>
      <Tooltip content={t("shell.tasks.taskSettings.open")}>
        {!hasDocument || locked ? (
          <span
            className="icon-action__disabled-trigger"
            tabIndex={0}
            aria-label={t("shell.tasks.taskSettings.open")}
          >
            {button}
          </span>
        ) : (
          button
        )}
      </Tooltip>
      <TaskSettingsDialog
        open={open}
        onOpenChange={setOpen}
        restoreFocus={() => triggerRef.current?.focus()}
      />
    </>
  );
}
