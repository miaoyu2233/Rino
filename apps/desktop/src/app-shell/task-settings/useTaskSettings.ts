import { useMemo } from "react";

import { useNodeRegistry } from "../../graph/registry/registry-store";
import { useDocumentStore } from "../../graph/store/document-store";
import { useEditorSessionStore } from "../../graph/store/editor-session-store";
import {
  readTaskSettings,
  taskSettingsSignature,
  type TaskSettingView,
} from "./task-settings-model";

export function useTaskSettings(): readonly TaskSettingView[] {
  const activeGraphId = useEditorSessionStore((state) => state.activeGraphId);
  const registry = useNodeRegistry();
  const signature = useDocumentStore((state) => {
    const graph = state.history?.document.graphs.find(
      (candidate) => candidate.graphId === activeGraphId,
    );
    return taskSettingsSignature(graph);
  });

  return useMemo(() => {
    const graph = useDocumentStore
      .getState()
      .history?.document.graphs.find(
        (candidate) => candidate.graphId === activeGraphId,
      );
    return readTaskSettings(graph, registry);
    // The signature is a deliberate invalidation token; the current graph is read from the
    // store only after that narrow selector changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGraphId, registry, signature]);
}
