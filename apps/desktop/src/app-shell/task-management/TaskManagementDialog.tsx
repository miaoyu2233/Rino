import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { notify } from "../../diagnostics/diagnostic-store";
import { useDocumentStore } from "../../graph/store/document-store";
import {
  createTask,
  deleteTask,
  duplicateTask,
  renameTask,
  setDefaultTask,
  selectTask,
  type TaskManagementFailureReason,
  type TaskManagementOutcome,
} from "./task-management-actions";
import { useTaskMetadata, type TaskMetadata } from "./task-metadata";

export interface TaskManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocus: () => void;
}

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
      notify({ severity: "error", titleKey: "shell.tasks.errors.taskMissing" });
      return;
    case "executionLocked":
      notify({
        severity: "warning",
        titleKey: "shell.tasks.errors.executionLocked",
      });
      return;
    case "noDocument":
      notify({ severity: "info", titleKey: "shell.tasks.errors.noDocument" });
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

function isTaskNameError(
  outcome: TaskManagementOutcome,
): outcome is { ok: false; reason: "taskNameInvalid" } {
  return !outcome.ok && outcome.reason === "taskNameInvalid";
}

interface TaskRowProps {
  canDelete: boolean;
  editing: boolean;
  locked: boolean;
  onBeginRename: () => void;
  onCancelRename: () => void;
  onConfirmDelete: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRename: (name: string) => void;
  onSelect: () => void;
  onSetDefault: () => void;
  pendingDelete: boolean;
  task: TaskMetadata;
}

function TaskRow({
  canDelete,
  editing,
  locked,
  onBeginRename,
  onCancelRename,
  onConfirmDelete,
  onDelete,
  onDuplicate,
  onRename,
  onSelect,
  onSetDefault,
  pendingDelete,
  task,
}: TaskRowProps) {
  const { t } = useTranslation();
  const [draftName, setDraftName] = useState(task.name);
  const [renameError, setRenameError] = useState(false);

  const submitRename = () => {
    const outcome = renameTask(task.graphId, draftName);
    if (outcome.ok) {
      setRenameError(false);
      onRename(draftName);
      return;
    }
    if (isTaskNameError(outcome)) {
      setRenameError(true);
      return;
    }
    notifyTaskFailure(outcome.reason);
  };

  return (
    <li
      className="task-management__row"
      data-active={task.isActive ? "true" : undefined}
      data-running={task.isRunning ? "true" : undefined}
    >
      {editing ? (
        <form
          className="task-management__rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitRename();
          }}
        >
          <label className="sr-only" htmlFor={`task-rename-${task.graphId}`}>
            {t("shell.tasks.renameLabel", { name: task.name })}
          </label>
          <Input
            id={`task-rename-${task.graphId}`}
            aria-describedby={
              renameError ? `task-rename-error-${task.graphId}` : undefined
            }
            aria-invalid={renameError}
            autoFocus
            disabled={locked}
            value={draftName}
            onChange={(event) => {
              setDraftName(event.target.value);
              setRenameError(false);
            }}
          />
          <Button
            disabled={locked}
            size="compact"
            type="submit"
            variant="primary"
          >
            {t("common.actions.save")}
          </Button>
          <Button
            size="compact"
            type="button"
            variant="ghost"
            onClick={onCancelRename}
          >
            {t("common.actions.cancel")}
          </Button>
          {renameError ? (
            <span
              id={`task-rename-error-${task.graphId}`}
              className="task-management__field-error"
              role="alert"
            >
              {t("shell.tasks.errors.taskNameInvalid")}
            </span>
          ) : null}
        </form>
      ) : (
        <>
          <button
            type="button"
            className="task-management__task-select"
            aria-current={task.isActive ? "true" : undefined}
            disabled={locked}
            onClick={onSelect}
          >
            <span className="task-management__task-name">{task.name}</span>
            <span className="task-management__badges">
              {task.isActive ? (
                <span className="task-management__badge task-management__badge--active">
                  {t("shell.tasks.activeBadge")}
                </span>
              ) : null}
              {task.isDefault ? (
                <span className="task-management__badge task-management__badge--default">
                  {t("shell.tasks.defaultBadge")}
                </span>
              ) : null}
              {task.isRunning ? (
                <span className="task-management__badge task-management__badge--running">
                  <ProductIcon icon="runtime.running" size="small" />
                  {t("shell.tasks.runningBadge")}
                </span>
              ) : null}
            </span>
          </button>
          {pendingDelete ? (
            <div className="task-management__delete-confirmation" role="alert">
              <span>{t("shell.tasks.deleteConfirm", { name: task.name })}</span>
              <Button
                size="compact"
                variant="destructive"
                disabled={locked}
                onClick={onConfirmDelete}
              >
                {t("common.actions.confirm")}
              </Button>
              <Button size="compact" variant="ghost" onClick={onDelete}>
                {t("common.actions.cancel")}
              </Button>
            </div>
          ) : (
            <span className="task-management__actions">
              <Button
                aria-label={t("shell.tasks.duplicateTask", {
                  name: task.name,
                })}
                size="compact"
                variant="ghost"
                disabled={locked}
                onClick={onDuplicate}
              >
                <ProductIcon icon="action.add" size="small" />
                <span>{t("shell.tasks.duplicate")}</span>
              </Button>
              <Button
                aria-label={t("shell.tasks.renameTask", { name: task.name })}
                size="compact"
                variant="ghost"
                disabled={locked}
                onClick={onBeginRename}
              >
                <ProductIcon icon="action.editTask" size="small" />
                <span>{t("shell.tasks.rename")}</span>
              </Button>
              <Button
                aria-label={t("shell.tasks.deleteTask", { name: task.name })}
                size="compact"
                variant="destructive"
                disabled={locked || !canDelete}
                onClick={onDelete}
              >
                <ProductIcon icon="action.deleteTask" size="small" />
                <span>{t("shell.tasks.delete")}</span>
              </Button>
              <Button
                size="compact"
                variant={task.isDefault ? "secondary" : "ghost"}
                disabled={locked || task.isDefault}
                title={
                  task.isDefault
                    ? t("shell.tasks.defaultBadge")
                    : t("shell.tasks.setDefault")
                }
                onClick={onSetDefault}
              >
                {task.isDefault
                  ? t("shell.tasks.defaultBadge")
                  : t("shell.tasks.setDefault")}
              </Button>
            </span>
          )}
        </>
      )}
    </li>
  );
}

export function TaskManagementDialog({
  open,
  onOpenChange,
  restoreFocus,
}: TaskManagementDialogProps) {
  const { t } = useTranslation();
  const tasks = useTaskMetadata();
  const executionLocked = useDocumentStore((state) => state.executionLocked);
  const [newName, setNewName] = useState("");
  const [newNameError, setNewNameError] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | undefined>();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | undefined>();

  const resetDialogState = useCallback(() => {
    setNewName("");
    setNewNameError(false);
    setEditingTaskId(undefined);
    setPendingDeleteId(undefined);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetDialogState();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetDialogState],
  );

  const handleCreate = () => {
    const outcome = createTask(newName);
    if (outcome.ok) {
      setNewName("");
      setNewNameError(false);
      return;
    }
    if (isTaskNameError(outcome)) {
      setNewNameError(true);
      return;
    }
    notifyTaskFailure(outcome.reason);
  };

  const handleSelect = (taskId: string) => {
    const outcome = selectTask(taskId);
    if (!outcome.ok) {
      notifyTaskFailure(outcome.reason);
    }
  };

  const handleDuplicate = (task: TaskMetadata) => {
    const outcome = duplicateTask(
      task.graphId,
      t("shell.tasks.copyName", { name: task.name }),
    );
    if (!outcome.ok) {
      notifyTaskFailure(outcome.reason);
    }
  };

  const handleSetDefault = (taskId: string) => {
    const outcome = setDefaultTask(taskId);
    if (!outcome.ok) {
      notifyTaskFailure(outcome.reason);
    }
  };

  const handleConfirmDelete = (taskId: string) => {
    const outcome = deleteTask(taskId);
    if (outcome.ok) {
      setPendingDeleteId(undefined);
      return;
    }
    notifyTaskFailure(outcome.reason);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="task-management-dialog"
        closeLabel={t("common.actions.close")}
        title={t("shell.tasks.managementTitle")}
        description={t("shell.tasks.managementDescription")}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <div className="task-management">
          {executionLocked ? (
            <p className="task-management__locked" role="status">
              <ProductIcon icon="runtime.running" size="small" />
              <span>{t("shell.tasks.lockedDescription")}</span>
            </p>
          ) : null}

          <ul
            className="task-management__list"
            aria-label={t("shell.tasks.listLabel")}
          >
            {tasks.map((task) => (
              <TaskRow
                key={`${task.graphId}-${editingTaskId === task.graphId ? "editing" : "view"}`}
                canDelete={tasks.length > 1}
                editing={editingTaskId === task.graphId}
                locked={executionLocked}
                onBeginRename={() => {
                  setPendingDeleteId(undefined);
                  setEditingTaskId(task.graphId);
                }}
                onCancelRename={() => {
                  setEditingTaskId(undefined);
                }}
                onConfirmDelete={() => {
                  handleConfirmDelete(task.graphId);
                }}
                onDelete={() => {
                  setEditingTaskId(undefined);
                  setPendingDeleteId((current) =>
                    current === task.graphId ? undefined : task.graphId,
                  );
                }}
                onDuplicate={() => {
                  handleDuplicate(task);
                }}
                onRename={() => {
                  setEditingTaskId(undefined);
                }}
                onSelect={() => {
                  handleSelect(task.graphId);
                }}
                onSetDefault={() => {
                  handleSetDefault(task.graphId);
                }}
                pendingDelete={pendingDeleteId === task.graphId}
                task={task}
              />
            ))}
          </ul>

          <form
            className="task-management__create"
            onSubmit={(event) => {
              event.preventDefault();
              handleCreate();
            }}
          >
            <div className="task-management__create-copy">
              <label htmlFor="task-create-name">
                {t("shell.tasks.createLabel")}
              </label>
              <span>{t("shell.tasks.createHint")}</span>
            </div>
            <div className="task-management__create-controls">
              <Input
                id="task-create-name"
                aria-describedby={
                  newNameError ? "task-create-name-error" : undefined
                }
                aria-invalid={newNameError}
                disabled={executionLocked}
                placeholder={t("shell.tasks.createPlaceholder")}
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value);
                  setNewNameError(false);
                }}
              />
              <Button
                disabled={executionLocked}
                type="submit"
                variant="primary"
              >
                <ProductIcon icon="action.add" size="small" />
                <span>{t("shell.tasks.create")}</span>
              </Button>
            </div>
            {newNameError ? (
              <span
                id="task-create-name-error"
                className="task-management__field-error"
                role="alert"
              >
                {t("shell.tasks.errors.taskNameInvalid")}
              </span>
            ) : null}
          </form>

          {tasks.length === 1 ? (
            <p className="task-management__note">
              {t("shell.tasks.onlyTaskNote")}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
