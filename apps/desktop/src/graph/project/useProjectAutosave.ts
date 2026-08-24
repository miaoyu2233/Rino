import { useEffect } from "react";

import { readHistoryStatus, useDocumentStore } from "../store/document-store";
import { writeAutosave } from "./project-actions";
import { useProjectStore } from "./project-store";

/** How long editing must settle before unsaved work is copied to the recovery slot.
 *
 * The delay is measured from the last edit rather than from a fixed schedule, so a burst
 * of edits writes once at its end instead of once per edit.
 */
export const AUTOSAVE_QUIET_PERIOD_MS = 15_000;

/** Copies unsaved work to the application-owned recovery slot while the user edits.
 *
 * Autosave never writes into the project directory. The directory holds what the user
 * saved; recovery holds what they had not saved yet, and it is offered back the next time
 * the same project is opened.
 */
export function useProjectAutosave(): void {
  const history = useDocumentStore((store) => store.history);
  const hasLocation = useProjectStore((store) => store.location !== undefined);
  const dirty = readHistoryStatus(history).dirty;
  const documentRevision = history?.document;

  useEffect(() => {
    if (!hasLocation || !dirty || documentRevision === undefined) {
      return;
    }
    const timer = window.setTimeout(() => {
      void writeAutosave();
    }, AUTOSAVE_QUIET_PERIOD_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [dirty, documentRevision, hasLocation]);
}
