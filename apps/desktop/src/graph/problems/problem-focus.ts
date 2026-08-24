import { create } from "zustand";

import { useLayoutPreferenceStore } from "../../preferences/layout-preference-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import type { ProblemFocusTarget } from "./problem-model";

export interface ProblemFocusRequest extends ProblemFocusTarget {
  /** Monotonic. Activating the same problem twice must reveal it again, which an
   * otherwise identical target would not express. */
  requestId: number;
}

interface ProblemFocusState {
  request: ProblemFocusRequest | undefined;
  requestFocus: (target: ProblemFocusTarget) => void;
  clearFocus: () => void;
}

let requestSequence = 0;

/** The editor's pending "show me this" request.
 *
 * The canvas and the inspector each answer the part of a request they own: the canvas
 * selects and brings the node or edge into view, the inspector moves keyboard focus to the
 * affected field. Routing that through a store keeps the problems list free of any
 * knowledge of React Flow or of the inspector's field layout.
 */
export const useProblemFocusStore = create<ProblemFocusState>((set) => ({
  request: undefined,
  requestFocus: (target) => {
    requestSequence += 1;
    set({ request: { ...target, requestId: requestSequence } });
  },
  clearFocus: () => {
    set({ request: undefined });
  },
}));

/** Takes the user to the element a problem is about.
 *
 * Selection and the active graph are session state, the right workbench tab is a layout
 * preference, and revealing the element on the canvas is a rendering concern. This is the
 * one place that sequences all three, so activating a problem behaves the same however it
 * was activated.
 */
export function revealProblem(target: ProblemFocusTarget): void {
  const session = useEditorSessionStore.getState();
  if (session.activeGraphId !== target.graphId) {
    session.setActiveGraph(target.graphId);
  }
  session.setSelection(
    target.nodeId === undefined ? [] : [target.nodeId],
    target.edgeId === undefined ? [] : [target.edgeId],
  );

  // A node or port problem is fixed in the inspector, so the panel that holds the fix is
  // opened rather than leaving the user to find it.
  if (target.nodeId !== undefined) {
    useLayoutPreferenceStore.getState().updateLayout({
      activeRightTab: "inspector",
      rightCollapsed: false,
    });
  }

  useProblemFocusStore.getState().requestFocus(target);
}
