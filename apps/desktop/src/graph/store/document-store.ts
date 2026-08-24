import type { GraphV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { create } from "zustand";

import {
  applyToHistory,
  canRedo,
  canUndo,
  createHistory,
  isDirty,
  markSaved,
  markUnsaved,
  pendingLabels,
  redo,
  undo,
  type GraphHistory,
} from "../commands/command-history";
import type {
  CommandFailureReason,
  GraphCommand,
} from "../commands/graph-commands";

export type CommandOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: CommandFailureReason | "noDocument" | "executionLocked";
    };

interface DocumentStoreState {
  /** Absent until a project is opened or created. The editor never invents a document. */
  history: GraphHistory | undefined;
  executionLocked: boolean;
  openDocument: (document: RinoProjectDocumentV1) => void;
  closeDocument: () => void;
  runCommand: (label: string, command: GraphCommand) => CommandOutcome;
  undoChange: () => void;
  redoChange: () => void;
  markDocumentSaved: (committedAt?: string) => void;
  markDocumentUnsaved: () => void;
  setExecutionLocked: (locked: boolean) => void;
}

export const useDocumentStore = create<DocumentStoreState>((set, get) => ({
  history: undefined,
  executionLocked: false,
  openDocument: (document) => {
    set({ history: createHistory(document), executionLocked: false });
  },
  closeDocument: () => {
    set({ history: undefined, executionLocked: false });
  },
  runCommand: (label, command) => {
    const { executionLocked, history } = get();
    if (executionLocked) {
      return { ok: false, reason: "executionLocked" };
    }
    if (!history) {
      return { ok: false, reason: "noDocument" };
    }
    const outcome = applyToHistory(history, label, command);
    if (!outcome.ok) {
      return outcome;
    }
    set({ history: outcome.history });
    return { ok: true };
  },
  undoChange: () => {
    const { executionLocked, history } = get();
    if (executionLocked || !history) {
      return;
    }
    const outcome = undo(history);
    if (outcome.ok) {
      set({ history: outcome.history });
    }
  },
  redoChange: () => {
    const { executionLocked, history } = get();
    if (executionLocked || !history) {
      return;
    }
    const outcome = redo(history);
    if (outcome.ok) {
      set({ history: outcome.history });
    }
  },
  markDocumentSaved: (committedAt) => {
    const { history } = get();
    if (history) {
      set({ history: markSaved(history, committedAt) });
    }
  },
  markDocumentUnsaved: () => {
    const { history } = get();
    if (history) {
      set({ history: markUnsaved(history) });
    }
  },
  setExecutionLocked: (executionLocked) => {
    set({ executionLocked });
  },
}));

/** Reads the open document without subscribing to anything else in the store. */
export function useActiveDocument(): RinoProjectDocumentV1 | undefined {
  return useDocumentStore((store) => store.history?.document);
}

/** Reads one graph. The selector returns the graph object itself, so a component
 * re-renders only when a command actually replaced that graph. */
export function useGraph(graphId: string | undefined): GraphV1 | undefined {
  return useDocumentStore((store) =>
    graphId === undefined
      ? undefined
      : store.history?.document.graphs.find(
          (graph) => graph.graphId === graphId,
        ),
  );
}

export interface HistoryStatus {
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  undoLabel: string | undefined;
  redoLabel: string | undefined;
}

export function readHistoryStatus(
  history: GraphHistory | undefined,
): HistoryStatus {
  if (!history) {
    return {
      canUndo: false,
      canRedo: false,
      dirty: false,
      undoLabel: undefined,
      redoLabel: undefined,
    };
  }
  const labels = pendingLabels(history);
  return {
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    dirty: isDirty(history),
    undoLabel: labels.undo,
    redoLabel: labels.redo,
  };
}
