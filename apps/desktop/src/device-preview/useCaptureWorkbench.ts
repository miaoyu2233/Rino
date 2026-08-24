import type { PreviewArtifactDescriptorV1 } from "@rino/contracts";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  saveProject,
  storeProjectCapture,
} from "../graph/project/project-actions";
import { useDocumentStore } from "../graph/store/document-store";
import { createIdentifier } from "../platform/identifiers";
import {
  currentInstallationCode,
  useApplicationDataStore,
} from "../preferences/application-data-store";
import { useRuntime } from "../ipc/useRuntime";
import {
  CaptureWorkbenchController,
  type CaptureWorkbenchState,
} from "./capture-workbench-controller";
import type { SourceRectangle } from "./geometry";

export interface CaptureWorkbenchViewModel {
  state: CaptureWorkbenchState;
  prepare: (
    preview: PreviewArtifactDescriptorV1,
    region?: SourceRectangle,
  ) => Promise<boolean>;
  setDisplayName: (displayName: string) => boolean;
  commit: () => Promise<boolean>;
  retrySave: () => Promise<boolean>;
  discard: () => Promise<boolean>;
  reset: () => boolean;
}

export function useCaptureWorkbench(): CaptureWorkbenchViewModel {
  const runtime = useRuntime();
  const projectDocumentId = useDocumentStore(
    (store) => store.history?.document.documentId,
  );
  const controller = useMemo(
    () =>
      new CaptureWorkbenchController({
        runtime: {
          prepareCapture: async (payload) =>
            (await runtime.request("capturePrepare", payload)).capture,
          readCapture: runtime.readCapture,
          releaseCapture: async (captureToken) =>
            (
              await runtime.request("captureRelease", {
                captureToken,
              })
            ).released,
        },
        project: {
          storeCapture: storeProjectCapture,
        },
        document: {
          readDocument: () => useDocumentStore.getState().history?.document,
          isExecutionLocked: () => useDocumentStore.getState().executionLocked,
          runCommand: (label, command) =>
            useDocumentStore.getState().runCommand(label, command),
          saveProject,
        },
        objectUrls: {
          create: (bytes, mediaType) =>
            URL.createObjectURL(
              new Blob([Uint8Array.from(bytes).buffer], { type: mediaType }),
            ),
          revoke: (objectUrl) => {
            URL.revokeObjectURL(objectUrl);
          },
        },
        createIdentifier,
        readInstallationCode: currentInstallationCode,
        readNextAssetNameOrdinal: (visibleName) =>
          useApplicationDataStore.getState().nextAssetNameOrdinal(visibleName),
        recordAssetNameOrdinal: (visibleName, ordinal) => {
          useApplicationDataStore
            .getState()
            .recordAssetNameOrdinal(visibleName, ordinal);
        },
        now: () => new Date(),
      }),
    [runtime],
  );

  useEffect(
    () => () => {
      controller.dispose();
    },
    [controller],
  );

  useEffect(() => {
    controller.validateProjectContext(projectDocumentId);
  }, [controller, projectDocumentId]);

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  const prepare = useCallback(
    (preview: PreviewArtifactDescriptorV1, region?: SourceRectangle) =>
      controller.prepare(preview, region),
    [controller],
  );
  const setDisplayName = useCallback(
    (displayName: string) => controller.setDisplayName(displayName),
    [controller],
  );
  const commit = useCallback(() => controller.commit(), [controller]);
  const retrySave = useCallback(() => controller.retrySave(), [controller]);
  const discard = useCallback(() => controller.discard(), [controller]);
  const reset = useCallback(() => controller.reset(), [controller]);

  return {
    state,
    prepare,
    setDisplayName,
    commit,
    retrySave,
    discard,
    reset,
  };
}
