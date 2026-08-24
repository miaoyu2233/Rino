import { useMemo } from "react";

import { useDocumentStore } from "../../graph/store/document-store";
import { useEditorSessionStore } from "../../graph/store/editor-session-store";
import {
  isGraphRunActive,
  useRuntimeExecutionStore,
} from "../../ipc/runtime-execution-store";

interface TaskIdentity {
  graphId: string;
  name: string;
}

interface TaskMetadataPayload {
  entryGraphId: string;
  graphs: readonly TaskIdentity[];
}

export interface TaskMetadata {
  graphId: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  isRunning: boolean;
}

const EMPTY_TASK_METADATA: readonly TaskMetadata[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTaskIdentity(value: unknown): value is TaskIdentity {
  return (
    isRecord(value) &&
    typeof value["graphId"] === "string" &&
    typeof value["name"] === "string"
  );
}

function isTaskMetadataPayload(value: unknown): value is TaskMetadataPayload {
  return (
    isRecord(value) &&
    typeof value["entryGraphId"] === "string" &&
    Array.isArray(value["graphs"]) &&
    value["graphs"].every(isTaskIdentity)
  );
}

/**
 * The top bar needs task names and IDs, but never node or edge collections. Returning a
 * primitive key keeps the selector stable when a graph's editable structure changes.
 */
export function selectTaskMetadataKey(
  state: ReturnType<typeof useDocumentStore.getState>,
): string {
  const document = state.history?.document;
  if (document === undefined) {
    return "";
  }

  return JSON.stringify({
    entryGraphId: document.entryGraphId,
    graphs: document.graphs.map(({ graphId, name }) => ({ graphId, name })),
  });
}

function parseTaskMetadataKey(key: string): TaskMetadataPayload | undefined {
  if (key === "") {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(key);
    return isTaskMetadataPayload(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function useTaskMetadata(): readonly TaskMetadata[] {
  const taskMetadataKey = useDocumentStore(selectTaskMetadataKey);
  const activeGraphId = useEditorSessionStore((state) => state.activeGraphId);
  const runningGraphId = useRuntimeExecutionStore(
    (state) => state.run?.graphId,
  );
  const runningState = useRuntimeExecutionStore((state) => state.run?.state);

  const payload = useMemo(
    () => parseTaskMetadataKey(taskMetadataKey),
    [taskMetadataKey],
  );

  return useMemo(() => {
    if (payload === undefined) {
      return EMPTY_TASK_METADATA;
    }

    const runIsActive = isGraphRunActive(runningState);
    return payload.graphs.map((graph) => ({
      graphId: graph.graphId,
      name: graph.name,
      isDefault: graph.graphId === payload.entryGraphId,
      isActive: graph.graphId === activeGraphId,
      isRunning: runIsActive && graph.graphId === runningGraphId,
    }));
  }, [activeGraphId, payload, runningGraphId, runningState]);
}

export function hasOpenTaskDocument(
  state: ReturnType<typeof useDocumentStore.getState>,
): boolean {
  return state.history !== undefined;
}
