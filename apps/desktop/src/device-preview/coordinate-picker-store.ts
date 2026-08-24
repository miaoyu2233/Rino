import { create } from "zustand";

import type { CoordinateNodeTypeKey } from "./authoring-selection";
import type { SourceCoordinateSpace } from "./geometry";

export type CoordinatePickerKind = "point" | "rectangle";

export interface CoordinatePickerTarget {
  graphId: string;
  nodeId: string;
  nodeTypeKey: CoordinateNodeTypeKey;
}

export interface CoordinatePickerSession {
  sessionId: number;
  kind: CoordinatePickerKind;
  target: CoordinatePickerTarget;
  source: SourceCoordinateSpace;
}

export interface CoordinatePickerRequest {
  requestId: number;
  kind: CoordinatePickerKind;
  target: CoordinatePickerTarget;
}

interface CoordinatePickerStoreState {
  nextRequestId: number;
  nextSessionId: number;
  pendingRequest: CoordinatePickerRequest | undefined;
  session: CoordinatePickerSession | undefined;
  requestSelection: (
    kind: CoordinatePickerKind,
    target: CoordinatePickerTarget,
  ) => number;
  clearRequest: (requestId?: number) => boolean;
  begin: (
    kind: CoordinatePickerKind,
    target: CoordinatePickerTarget,
    source: SourceCoordinateSpace,
  ) => number;
  finish: (sessionId: number) => boolean;
  cancel: (sessionId?: number) => boolean;
}

export const useCoordinatePickerStore = create<CoordinatePickerStoreState>(
  (set, get) => ({
    nextRequestId: 1,
    nextSessionId: 1,
    pendingRequest: undefined,
    session: undefined,
    requestSelection: (kind, target) => {
      const requestId = get().nextRequestId;
      set({
        nextRequestId: requestId + 1,
        pendingRequest: { requestId, kind, target },
      });
      return requestId;
    },
    clearRequest: (requestId) => {
      const current = get().pendingRequest;
      if (
        current === undefined ||
        (requestId !== undefined && current.requestId !== requestId)
      ) {
        return false;
      }
      set({ pendingRequest: undefined });
      return true;
    },
    begin: (kind, target, source) => {
      const sessionId = get().nextSessionId;
      set({
        nextSessionId: sessionId + 1,
        pendingRequest: undefined,
        session: { sessionId, kind, target, source },
      });
      return sessionId;
    },
    finish: (sessionId) => {
      if (get().session?.sessionId !== sessionId) {
        return false;
      }
      set({ session: undefined });
      return true;
    },
    cancel: (sessionId) => {
      const current = get().session;
      if (
        !current ||
        (sessionId !== undefined && current.sessionId !== sessionId)
      ) {
        return false;
      }
      set({ session: undefined });
      return true;
    },
  }),
);

export function coordinatePickerUsesCurrentFrame(
  session: CoordinatePickerSession,
  source: SourceCoordinateSpace,
): boolean {
  return (
    session.source.coordinateSpaceId === source.coordinateSpaceId &&
    session.source.sourceGeneration === source.sourceGeneration &&
    session.source.width === source.width &&
    session.source.height === source.height
  );
}
