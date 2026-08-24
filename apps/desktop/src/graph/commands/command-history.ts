import type { RinoProjectDocumentV1 } from "@rino/contracts";

import {
  applyCommand,
  type CommandFailureReason,
  type GraphCommand,
} from "./graph-commands";

/** History is bounded so a long editing session cannot grow without limit. The oldest
 * entries are dropped, which costs the ability to undo that far back but never corrupts
 * the document. */
export const MAXIMUM_HISTORY_ENTRIES = 200;

interface HistoryEntry {
  /** Identifies the document state produced by this entry. Identifiers are never reused,
   * so a saved state can be recognized again after undo without confusing it with a
   * different state reached by a different route. */
  positionId: number;
  label: string;
  command: GraphCommand;
  inverse: GraphCommand;
}

export interface GraphHistory {
  document: RinoProjectDocumentV1;
  undoable: readonly HistoryEntry[];
  redoable: readonly HistoryEntry[];
  savedPositionId: number;
  nextPositionId: number;
  /** True when the oldest undo entries were dropped, so the interface can explain why
   * undo stops earlier than the user expects. */
  truncated: boolean;
}

export type HistoryResult =
  | { ok: true; history: GraphHistory }
  | { ok: false; reason: CommandFailureReason };

const INITIAL_POSITION_ID = 0;
/** No document state is ever given this identifier, so a history holding it is dirty
 * whatever the user does next. It marks a document that arrived already unsaved, such as
 * work restored from the recovery slot. */
const UNSAVED_POSITION_ID = -1;

export function createHistory(document: RinoProjectDocumentV1): GraphHistory {
  return {
    document,
    undoable: [],
    redoable: [],
    savedPositionId: INITIAL_POSITION_ID,
    nextPositionId: INITIAL_POSITION_ID + 1,
    truncated: false,
  };
}

function currentPositionId(history: GraphHistory): number {
  return history.undoable.at(-1)?.positionId ?? INITIAL_POSITION_ID;
}

/** Reports whether the document differs from the state last marked as saved. */
export function isDirty(history: GraphHistory): boolean {
  return currentPositionId(history) !== history.savedPositionId;
}

export function canUndo(history: GraphHistory): boolean {
  return history.undoable.length > 0;
}

export function canRedo(history: GraphHistory): boolean {
  return history.redoable.length > 0;
}

/** Applies a command and records it for undo.
 *
 * A new command after an undo discards the redo branch, which is the standard editing
 * expectation: the user chose a different continuation.
 */
export function applyToHistory(
  history: GraphHistory,
  label: string,
  command: GraphCommand,
): HistoryResult {
  const outcome = applyCommand(history.document, command);
  if (!outcome.ok) {
    return outcome;
  }

  const entry: HistoryEntry = {
    positionId: history.nextPositionId,
    label,
    command,
    inverse: outcome.inverse,
  };
  const undoable = [...history.undoable, entry];
  const overflow = undoable.length - MAXIMUM_HISTORY_ENTRIES;

  return {
    ok: true,
    history: {
      document: outcome.document,
      undoable: overflow > 0 ? undoable.slice(overflow) : undoable,
      redoable: [],
      savedPositionId: history.savedPositionId,
      nextPositionId: history.nextPositionId + 1,
      truncated: history.truncated || overflow > 0,
    },
  };
}

export function undo(history: GraphHistory): HistoryResult {
  const entry = history.undoable.at(-1);
  if (!entry) {
    return { ok: true, history };
  }

  const outcome = applyCommand(history.document, entry.inverse);
  if (!outcome.ok) {
    return outcome;
  }

  return {
    ok: true,
    history: {
      ...history,
      document: outcome.document,
      undoable: history.undoable.slice(0, -1),
      redoable: [...history.redoable, entry],
    },
  };
}

export function redo(history: GraphHistory): HistoryResult {
  const entry = history.redoable.at(-1);
  if (!entry) {
    return { ok: true, history };
  }

  const outcome = applyCommand(history.document, entry.command);
  if (!outcome.ok) {
    return outcome;
  }

  return {
    ok: true,
    history: {
      ...history,
      document: outcome.document,
      undoable: [...history.undoable, entry],
      redoable: history.redoable.slice(0, -1),
    },
  };
}

/** Marks the current document as saved without discarding undo history, so a user can
 * still step back past a save.
 *
 * A commit timestamp stamps `metadata.updatedAt` at the same moment, because that field
 * describes the last save rather than an edit and must not become an undo entry of its
 * own. Undo and redo replay graph commands, which preserve the metadata they find.
 */
export function markSaved(
  history: GraphHistory,
  committedAt?: string,
): GraphHistory {
  const document =
    committedAt === undefined
      ? history.document
      : {
          ...history.document,
          metadata: { ...history.document.metadata, updatedAt: committedAt },
        };
  return {
    ...history,
    document,
    savedPositionId: currentPositionId(history),
  };
}

/** Marks a document as never yet written, which is what restored work is.
 *
 * Undoing back to the state the document arrived in leaves it dirty, because that state
 * is not on disk either.
 */
export function markUnsaved(history: GraphHistory): GraphHistory {
  return { ...history, savedPositionId: UNSAVED_POSITION_ID };
}

/** The labels of the changes that undo and redo would apply, for menu and tooltip text. */
export function pendingLabels(history: GraphHistory): {
  undo: string | undefined;
  redo: string | undefined;
} {
  return {
    undo: history.undoable.at(-1)?.label,
    redo: history.redoable.at(-1)?.label,
  };
}
