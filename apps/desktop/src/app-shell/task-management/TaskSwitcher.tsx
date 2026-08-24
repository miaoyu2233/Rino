import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Select, type SelectOption } from "../../components/ui/Select";
import { Tooltip } from "../../components/ui/Tooltip";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { notify } from "../../diagnostics/diagnostic-store";
import { useDocumentStore } from "../../graph/store/document-store";
import { useEditorSessionStore } from "../../graph/store/editor-session-store";
import { TaskSettingsTrigger } from "../task-settings/TaskSettings";
import { TaskManagementDialog } from "./TaskManagementDialog";
import {
  selectTask,
  type TaskManagementFailureReason,
} from "./task-management-actions";
import { useTaskMetadata, type TaskMetadata } from "./task-metadata";

function notifyTaskFailure(reason: TaskManagementFailureReason): void {
  switch (reason) {
    case "taskNameInvalid":
      notify({
        severity: "error",
        titleKey: "shell.tasks.errors.taskNameInvalid",
      });
      return;
    case "taskLimitReached":
      notify({
        severity: "error",
        titleKey: "shell.tasks.errors.taskLimitReached",
      });
      return;
    case "cannotDeleteOnlyTask":
      notify({
        severity: "error",
        titleKey: "shell.tasks.errors.cannotDeleteOnlyTask",
      });
      return;
    case "taskMissing":
      notify({
        severity: "error",
        titleKey: "shell.tasks.errors.taskMissing",
      });
      return;
    case "executionLocked":
      notify({
        severity: "warning",
        titleKey: "shell.tasks.errors.executionLocked",
      });
      return;
    case "noDocument":
      notify({
        severity: "info",
        titleKey: "shell.tasks.errors.noDocument",
      });
      return;
    case "commandRejected":
      notify({
        severity: "error",
        titleKey: "shell.tasks.errors.commandRejected",
      });
      return;
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

function TaskOptionLabel({ task }: { task: TaskMetadata }) {
  const { t } = useTranslation();

  return (
    <span className="task-switcher__option">
      <span className="task-switcher__option-name">{task.name}</span>
      <span className="task-switcher__option-badges">
        {task.isActive ? (
          <span className="task-switcher__badge task-switcher__badge--active">
            {t("shell.tasks.activeBadge")}
          </span>
        ) : null}
        {task.isDefault ? (
          <span className="task-switcher__badge task-switcher__badge--default">
            {t("shell.tasks.defaultBadge")}
          </span>
        ) : null}
        {task.isRunning ? (
          <span className="task-switcher__badge task-switcher__badge--running">
            <ProductIcon icon="runtime.running" size="small" />
            {t("shell.tasks.runningBadge")}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function TaskSwitcher() {
  const { t } = useTranslation();
  const tasks = useTaskMetadata();
  const hasDocument = useDocumentStore((state) => state.history !== undefined);
  const executionLocked = useDocumentStore((state) => state.executionLocked);
  const activeGraphId = useEditorSessionStore((state) => state.activeGraphId);
  const [managementOpen, setManagementOpen] = useState(false);
  const managementTriggerRef = useRef<HTMLButtonElement | null>(null);

  const selectedTask =
    tasks.find((task) => task.graphId === activeGraphId) ?? tasks[0];
  const disabled = !hasDocument || executionLocked || tasks.length === 0;
  const options = useMemo<readonly SelectOption[]>(
    () =>
      tasks.map((task) => ({
        value: task.graphId,
        label: <TaskOptionLabel task={task} />,
      })),
    [tasks],
  );

  const handleTaskChange = useCallback((taskId: string) => {
    const outcome = selectTask(taskId);
    if (!outcome.ok) {
      notifyTaskFailure(outcome.reason);
    }
  }, []);

  const openManagement = useCallback(() => {
    if (disabled) {
      return;
    }
    managementTriggerRef.current =
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
    setManagementOpen(true);
  }, [disabled]);

  const managementButton = (
    <Button
      ref={managementTriggerRef}
      aria-label={t("shell.tasks.manage")}
      disabled={disabled}
      size="icon"
      variant="ghost"
      onClick={openManagement}
    >
      <ProductIcon icon="action.manageTasks" />
    </Button>
  );

  return (
    <>
      <div className="top-application-bar__task-slot">
        <div className="task-switcher" data-disabled={disabled}>
          <Select
            aria-label={t("shell.tasks.switcherLabel")}
            className="task-switcher__select"
            disabled={disabled}
            onValueChange={handleTaskChange}
            options={options}
            placeholder={t("shell.tasks.noTask")}
            value={selectedTask?.graphId ?? ""}
          />
          <Tooltip content={t("shell.tasks.manage")}>
            {disabled ? (
              <span
                className="icon-action__disabled-trigger"
                tabIndex={0}
                aria-label={t("shell.tasks.manage")}
              >
                {managementButton}
              </span>
            ) : (
              managementButton
            )}
          </Tooltip>
          <TaskSettingsTrigger />
        </div>
      </div>

      <TaskManagementDialog
        open={managementOpen}
        onOpenChange={setManagementOpen}
        restoreFocus={() => managementTriggerRef.current?.focus()}
      />
    </>
  );
}
