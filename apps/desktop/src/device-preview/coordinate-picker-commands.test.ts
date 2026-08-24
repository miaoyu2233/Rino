import type { RinoProjectDocumentV1 } from "@rino/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { commitPointPickerSelection } from "./coordinate-picker-commands";
import { useCoordinatePickerStore } from "./coordinate-picker-store";
import { useDocumentStore } from "../graph/store/document-store";

const graphId = "89d7d0e1-5a91-47d8-b969-65f95a5b36dc";
const nodeId = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const source = {
  width: 1080,
  height: 1920,
  coordinateSpaceId: "source-space",
  sourceGeneration: 7,
};

function document(): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "80a43598-f806-477e-840c-345ce1ef1578",
    metadata: {
      name: "Coordinate picker",
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
    },
    entryGraphId: graphId,
    graphs: [
      {
        graphId,
        name: "Main",
        kind: "entry",
        nodes: [
          {
            nodeId,
            typeKey: "core.geometry.point",
            typeVersion: 1,
            position: { x: 0, y: 0 },
            properties: {},
            inputValues: {},
          },
        ],
        edges: [],
      },
    ],
    assets: [],
    requiredCapabilities: [],
  };
}

describe("coordinate picker command integration", () => {
  beforeEach(() => {
    useDocumentStore.getState().openDocument(document());
    useCoordinatePickerStore.setState({ nextSessionId: 1, session: undefined });
  });

  it("commits one current-frame point and closes the picker", () => {
    const sessionId = useCoordinatePickerStore
      .getState()
      .begin(
        "point",
        { graphId, nodeId, nodeTypeKey: "core.geometry.point" },
        source,
      );
    expect(
      commitPointPickerSelection(sessionId, {
        x: 120,
        y: 340,
        coordinateSpaceId: "source-space",
        sourceGeneration: 7,
      }),
    ).toMatchObject({ ok: true });

    const node =
      useDocumentStore.getState().history?.document.graphs[0]?.nodes[0];
    expect(node?.inputValues).toEqual({
      x: 120,
      y: 340,
      referenceWidth: 1080,
      referenceHeight: 1920,
    });
    expect(useCoordinatePickerStore.getState().session).toBeUndefined();
  });

  it("keeps the session open when a stale frame or edit lock rejects it", () => {
    const sessionId = useCoordinatePickerStore
      .getState()
      .begin(
        "point",
        { graphId, nodeId, nodeTypeKey: "core.geometry.point" },
        source,
      );
    expect(
      commitPointPickerSelection(sessionId, {
        x: 120,
        y: 340,
        coordinateSpaceId: "source-space",
        sourceGeneration: 8,
      }),
    ).toEqual({ ok: false, reason: "staleOrInvalidSelection" });
    expect(useCoordinatePickerStore.getState().session).toBeDefined();

    useDocumentStore.getState().setExecutionLocked(true);
    expect(
      commitPointPickerSelection(sessionId, {
        x: 120,
        y: 340,
        coordinateSpaceId: "source-space",
        sourceGeneration: 7,
      }),
    ).toEqual({ ok: false, reason: "commandRejected" });
    expect(useCoordinatePickerStore.getState().session).toBeDefined();
  });
});
