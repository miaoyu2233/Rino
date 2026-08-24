import { create } from "zustand";

import type { GraphFragment } from "../commands/graph-editing";

/** Editor session state.
 *
 * Selection, the active graph, and the clipboard describe what the user is looking at
 * rather than what the project contains. They are kept out of the document so an edit
 * never has to carry presentation state, and so undo never moves the user's selection
 * around unexpectedly.
 */
interface EditorSessionState {
  activeGraphId: string | undefined;
  graphNavigationStack: readonly string[];
  selectedNodeIds: readonly string[];
  selectedEdgeIds: readonly string[];
  /** In-application clipboard. The system clipboard cannot hold typed graph fragments,
   * and routing them through text would lose their structure. */
  clipboard: GraphFragment | undefined;
  setActiveGraph: (graphId: string | undefined) => void;
  enterGraph: (graphId: string) => void;
  leaveGraph: (fallbackGraphId: string | undefined) => void;
  setSelection: (
    selectedNodeIds: readonly string[],
    selectedEdgeIds: readonly string[],
  ) => void;
  setClipboard: (fragment: GraphFragment) => void;
  resetSession: () => void;
}

function sameIdentifiers(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export const useEditorSessionStore = create<EditorSessionState>((set, get) => ({
  activeGraphId: undefined,
  graphNavigationStack: [],
  selectedNodeIds: [],
  selectedEdgeIds: [],
  clipboard: undefined,
  setActiveGraph: (activeGraphId) => {
    set({
      activeGraphId,
      graphNavigationStack: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
  },
  enterGraph: (graphId) => {
    const current = get();
    const stack =
      current.activeGraphId === undefined || current.activeGraphId === graphId
        ? current.graphNavigationStack
        : [...current.graphNavigationStack, current.activeGraphId];
    set({
      activeGraphId: graphId,
      graphNavigationStack: stack,
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
  },
  leaveGraph: (fallbackGraphId) => {
    const current = get();
    const stack = [...current.graphNavigationStack];
    const previousGraphId = stack.pop() ?? fallbackGraphId;
    set({
      activeGraphId: previousGraphId,
      graphNavigationStack: stack,
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
  },
  setSelection: (selectedNodeIds, selectedEdgeIds) => {
    const current = get();
    // React Flow reports selection on every interaction. Ignoring an unchanged report
    // keeps the inspector and any other subscriber from re-rendering on every click.
    if (
      sameIdentifiers(current.selectedNodeIds, selectedNodeIds) &&
      sameIdentifiers(current.selectedEdgeIds, selectedEdgeIds)
    ) {
      return;
    }
    set({ selectedNodeIds, selectedEdgeIds });
  },
  setClipboard: (clipboard) => {
    set({ clipboard });
  },
  resetSession: () => {
    set({
      activeGraphId: undefined,
      graphNavigationStack: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
      clipboard: undefined,
    });
  },
}));
