import type { RinoProjectDocumentV1 } from "@rino/contracts";

import { createIdentifier } from "../../platform/identifiers";
import type { GraphCommand } from "../../graph/commands/graph-commands";
import { useDocumentStore } from "../../graph/store/document-store";
import { useEditorSessionStore } from "../../graph/store/editor-session-store";
import {
  buildCreateTaskCommand,
  buildDeleteTaskCommand,
  buildDuplicateTaskCommand,
  buildRenameTaskCommand,
  buildSetDefaultTaskCommand,
  type TaskCommandFailureReason,
} from "../../graph/commands/task-commands";

export type TaskManagementFailureReason =
  | TaskCommandFailureReason
  | "noDocument"
  | "executionLocked"
  | "commandRejected";

export type TaskManagementOutcome =
  | {
      ok: true;
      taskId?: string;
      fallbackTaskId?: string;
    }
  | {
      ok: false;
      reason: TaskManagementFailureReason;
    };

function documentOrFailure():
  | { ok: true; document: RinoProjectDocumentV1 }
  | { ok: false; reason: "noDocument" | "executionLocked" } {
  const state = useDocumentStore.getState();
  if (state.executionLocked) {
    return { ok: false, reason: "executionLocked" };
  }
  if (state.history === undefined) {
    return { ok: false, reason: "noDocument" };
  }
  return { ok: true, document: state.history.document };
}

function applyTaskCommand(
  label: string,
  command: GraphCommand,
): TaskManagementOutcome {
  const outcome = useDocumentStore.getState().runCommand(label, command);
  return outcome.ok
    ? { ok: true }
    : {
        ok: false,
        reason:
          outcome.reason === "executionLocked" ||
          outcome.reason === "noDocument"
            ? outcome.reason
            : "commandRejected",
      };
}

export function selectTask(taskId: string): TaskManagementOutcome {
  const state = useDocumentStore.getState();
  if (state.executionLocked) {
    return { ok: false, reason: "executionLocked" };
  }
  if (state.history === undefined) {
    return { ok: false, reason: "noDocument" };
  }
  if (
    !state.history.document.graphs.some((graph) => graph.graphId === taskId)
  ) {
    return { ok: false, reason: "taskMissing" };
  }
  useEditorSessionStore.getState().setActiveGraph(taskId);
  return { ok: true, taskId };
}

export function createTask(name: string): TaskManagementOutcome {
  const current = documentOrFailure();
  if (!current.ok) {
    return current;
  }
  const built = buildCreateTaskCommand(
    current.document,
    name,
    createIdentifier,
  );
  if (!built.ok) {
    return built;
  }
  const applied = applyTaskCommand("task.create", built.value.command);
  if (!applied.ok) {
    return applied;
  }
  useEditorSessionStore.getState().setActiveGraph(built.value.taskId);
  return { ok: true, taskId: built.value.taskId };
}

export function duplicateTask(
  sourceTaskId: string,
  name: string,
): TaskManagementOutcome {
  const current = documentOrFailure();
  if (!current.ok) {
    return current;
  }
  const built = buildDuplicateTaskCommand(
    current.document,
    sourceTaskId,
    name,
    createIdentifier,
  );
  if (!built.ok) {
    return built;
  }
  const applied = applyTaskCommand("task.duplicate", built.value.command);
  if (!applied.ok) {
    return applied;
  }
  useEditorSessionStore.getState().setActiveGraph(built.value.taskId);
  return { ok: true, taskId: built.value.taskId };
}

export function renameTask(
  taskId: string,
  name: string,
): TaskManagementOutcome {
  const current = documentOrFailure();
  if (!current.ok) {
    return current;
  }
  const built = buildRenameTaskCommand(current.document, taskId, name);
  if (!built.ok) {
    return built;
  }
  return applyTaskCommand("task.rename", built.value);
}

export function setDefaultTask(taskId: string): TaskManagementOutcome {
  const current = documentOrFailure();
  if (!current.ok) {
    return current;
  }
  const built = buildSetDefaultTaskCommand(current.document, taskId);
  if (!built.ok) {
    return built;
  }
  return applyTaskCommand("task.setDefault", built.value);
}

export function deleteTask(taskId: string): TaskManagementOutcome {
  const current = documentOrFailure();
  if (!current.ok) {
    return current;
  }
  const built = buildDeleteTaskCommand(current.document, taskId);
  if (!built.ok) {
    return built;
  }
  const applied = applyTaskCommand("task.delete", built.value.command);
  if (!applied.ok) {
    return applied;
  }
  if (useEditorSessionStore.getState().activeGraphId === taskId) {
    useEditorSessionStore.getState().setActiveGraph(built.value.fallbackTaskId);
  }
  return {
    ok: true,
    fallbackTaskId: built.value.fallbackTaskId,
  };
}
