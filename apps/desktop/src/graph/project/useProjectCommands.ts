import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDocumentStore, readHistoryStatus } from "../store/document-store";
import {
  acceptRecovery,
  closeProject,
  createProject,
  discardRecovery,
  openProject,
  saveProject,
  saveProjectAs,
  type ProjectDialogText,
} from "./project-actions";
import { useProjectStore } from "./project-store";
import type { ProjectFileSet, ProjectLocation } from "./project-transport";

/** A project action that would discard unsaved work if it ran immediately. */
export type GuardedProjectIntent = "new" | "open" | "close";

export interface ProjectCommands {
  location: ProjectLocation | undefined;
  hasDocument: boolean;
  dirty: boolean;
  busy: boolean;
  requestNewProject: () => void;
  requestOpenProject: () => void;
  requestCloseProject: () => void;
  save: () => void;
  saveAs: () => void;
  /** The action waiting on the user's answer about unsaved work, if any. */
  pendingIntent: GuardedProjectIntent | undefined;
  saveThenContinue: () => void;
  discardThenContinue: () => void;
  cancelPendingIntent: () => void;
  recovery: ProjectFileSet | undefined;
  restoreRecovery: () => void;
  dismissRecovery: () => void;
}

/** Drives every project action the shell offers.
 *
 * An action that would discard unsaved work never runs straight away: it becomes a
 * pending intent, the interface asks, and only the user's answer resolves it.
 */
export function useProjectCommands(): ProjectCommands {
  const { t } = useTranslation();
  const history = useDocumentStore((store) => store.history);
  const location = useProjectStore((store) => store.location);
  const activity = useProjectStore((store) => store.activity);
  const recovery = useProjectStore((store) => store.recovery);
  const [pendingIntent, setPendingIntent] = useState<
    GuardedProjectIntent | undefined
  >(undefined);

  const dialogText = useMemo<ProjectDialogText>(
    () => ({
      chooseLocationTitle: t("project.dialog.chooseLocationTitle"),
      openTitle: t("project.dialog.openTitle"),
      manifestFileTypeLabel: t("project.dialog.manifestFileTypeLabel"),
    }),
    [t],
  );
  const entryGraphName = t("graph.project.defaultGraphName");

  const dirty = readHistoryStatus(history).dirty;
  const hasDocument = history !== undefined;
  const busy = activity !== "idle";

  const runIntent = useCallback(
    (intent: GuardedProjectIntent) => {
      switch (intent) {
        case "new":
          void createProject({
            dialogText,
            entryGraphName,
            now: () => new Date().toISOString(),
          });
          return;
        case "open":
          void openProject(dialogText);
          return;
        case "close":
          void closeProject();
          return;
        default: {
          const unhandled: never = intent;
          return unhandled;
        }
      }
    },
    [dialogText, entryGraphName],
  );

  const request = useCallback(
    (intent: GuardedProjectIntent) => {
      if (dirty) {
        setPendingIntent(intent);
        return;
      }
      runIntent(intent);
    },
    [dirty, runIntent],
  );

  const save = useCallback(() => {
    void saveProject();
  }, []);

  const saveAs = useCallback(() => {
    void saveProjectAs(dialogText);
  }, [dialogText]);

  const saveThenContinue = useCallback(() => {
    const intent = pendingIntent;
    setPendingIntent(undefined);
    if (intent === undefined) {
      return;
    }
    void saveProject().then((outcome) => {
      // A failed or cancelled save must not be followed by the action that discards the
      // work it was meant to protect.
      if (outcome.status === "completed") {
        runIntent(intent);
      }
    });
  }, [pendingIntent, runIntent]);

  const discardThenContinue = useCallback(() => {
    const intent = pendingIntent;
    setPendingIntent(undefined);
    if (intent !== undefined) {
      runIntent(intent);
    }
  }, [pendingIntent, runIntent]);

  const cancelPendingIntent = useCallback(() => {
    setPendingIntent(undefined);
  }, []);

  const restoreRecovery = useCallback(() => {
    if (recovery) {
      acceptRecovery(recovery);
    }
  }, [recovery]);

  const dismissRecovery = useCallback(() => {
    void discardRecovery();
  }, []);

  return {
    location,
    hasDocument,
    dirty,
    busy,
    requestNewProject: useCallback(() => {
      request("new");
    }, [request]),
    requestOpenProject: useCallback(() => {
      request("open");
    }, [request]),
    requestCloseProject: useCallback(() => {
      request("close");
    }, [request]),
    save,
    saveAs,
    pendingIntent,
    saveThenContinue,
    discardThenContinue,
    cancelPendingIntent,
    recovery,
    restoreRecovery,
    dismissRecovery,
  };
}
