import type { RinoProjectDocumentV1 } from "@rino/contracts";

import { useProblemFocusStore } from "../problems/problem-focus";
import { useDocumentStore } from "./document-store";
import { useEditorSessionStore } from "./editor-session-store";

/** Opens a document and points the editor session at its entry graph.
 *
 * Document state and session state live in separate stores so an edit never carries
 * selection with it. Opening a project is the one moment both must change together, so
 * it happens here rather than in either store.
 */
export function openProjectDocument(document: RinoProjectDocumentV1): void {
  useDocumentStore.getState().openDocument(document);
  useEditorSessionStore.getState().setActiveGraph(document.entryGraphId);
}

export function closeProjectDocument(): void {
  useDocumentStore.getState().closeDocument();
  useEditorSessionStore.getState().resetSession();
  // A pending reveal names elements of the document being closed. Reopening the same
  // project would otherwise replay it against the newly loaded graph.
  useProblemFocusStore.getState().clearFocus();
}
