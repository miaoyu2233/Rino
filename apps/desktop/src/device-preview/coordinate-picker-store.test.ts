import { beforeEach, describe, expect, it } from "vitest";

import {
  coordinatePickerUsesCurrentFrame,
  useCoordinatePickerStore,
} from "./coordinate-picker-store";

const source = {
  width: 1080,
  height: 1920,
  coordinateSpaceId: "source-space",
  sourceGeneration: 7,
};

const target = {
  graphId: "89d7d0e1-5a91-47d8-b969-65f95a5b36dc",
  nodeId: "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f",
  nodeTypeKey: "core.geometry.point" as const,
};

describe("coordinate picker session store", () => {
  beforeEach(() => {
    useCoordinatePickerStore.setState({
      nextRequestId: 1,
      nextSessionId: 1,
      pendingRequest: undefined,
      session: undefined,
    });
  });

  it("keeps only the latest selection request and consumes it when a session begins", () => {
    const first = useCoordinatePickerStore
      .getState()
      .requestSelection("point", target);
    const second = useCoordinatePickerStore
      .getState()
      .requestSelection("point", target);

    expect(useCoordinatePickerStore.getState().clearRequest(first)).toBe(false);
    expect(useCoordinatePickerStore.getState().pendingRequest?.requestId).toBe(
      second,
    );

    useCoordinatePickerStore.getState().begin("point", target, source);
    expect(useCoordinatePickerStore.getState().pendingRequest).toBeUndefined();
    expect(useCoordinatePickerStore.getState().session).toBeDefined();
  });

  it("replaces an older session and rejects its delayed completion", () => {
    const first = useCoordinatePickerStore
      .getState()
      .begin("point", target, source);
    const second = useCoordinatePickerStore
      .getState()
      .begin("point", target, source);

    expect(useCoordinatePickerStore.getState().finish(first)).toBe(false);
    expect(useCoordinatePickerStore.getState().session?.sessionId).toBe(second);
    expect(useCoordinatePickerStore.getState().finish(second)).toBe(true);
    expect(useCoordinatePickerStore.getState().session).toBeUndefined();
  });

  it("detects a replaced preview frame and supports guarded cancellation", () => {
    const sessionId = useCoordinatePickerStore
      .getState()
      .begin("point", target, source);
    const session = useCoordinatePickerStore.getState().session;
    expect(session).toBeDefined();
    if (session === undefined) {
      throw new Error("The picker session was not created.");
    }
    expect(coordinatePickerUsesCurrentFrame(session, source)).toBe(true);
    expect(
      coordinatePickerUsesCurrentFrame(session, {
        ...source,
        sourceGeneration: 8,
      }),
    ).toBe(false);
    expect(useCoordinatePickerStore.getState().cancel(sessionId + 1)).toBe(
      false,
    );
    expect(useCoordinatePickerStore.getState().cancel(sessionId)).toBe(true);
  });
});
