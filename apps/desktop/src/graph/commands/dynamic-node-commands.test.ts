import type { GraphV1, NodeV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { useDocumentStore } from "../store/document-store";
import {
  buildRemoveDynamicPortCommand,
  removeDynamicPort,
} from "./dynamic-node-commands";

const GRAPH_ID = "20000000-0000-4000-8000-000000000001";
const LIST_ID = "10000000-0000-4000-8000-000000000001";
const SOURCE_ID = "10000000-0000-4000-8000-000000000002";
const EDGE_ID = "30000000-0000-4000-8000-000000000001";

function node(
  nodeId: string,
  typeKey: string,
  overrides: Partial<NodeV1> = {},
): NodeV1 {
  return {
    nodeId,
    typeKey,
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
    ...overrides,
  };
}

function graph(): GraphV1 {
  return {
    graphId: GRAPH_ID,
    name: "Collection editing",
    kind: "entry",
    nodes: [
      node(LIST_ID, "core.collection.regionList", {
        inputValues: { item2: "stale-value" },
        dynamicPortState: { collectionItemCount: 2 },
      }),
      node(SOURCE_ID, "core.geometry.rectangle"),
    ],
    edges: [
      {
        edgeId: EDGE_ID,
        edgeKind: "data",
        sourceNodeId: SOURCE_ID,
        sourcePortId: "rectangle",
        targetNodeId: LIST_ID,
        targetPortId: "item2",
      },
    ],
  };
}

function document(source: GraphV1): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "40000000-0000-4000-8000-000000000001",
    metadata: {
      name: "Collection editing",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    },
    entryGraphId: source.graphId,
    graphs: [source],
    assets: [],
    requiredCapabilities: [],
  };
}

afterEach(() => {
  useDocumentStore.getState().closeDocument();
});

describe("dynamic collection item editing", () => {
  it("removes the last item and all wires targeting it in one command", () => {
    const result = buildRemoveDynamicPortCommand(graph(), LIST_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.portId).toBe("item2");
    expect(result.count).toBe(1);
    expect(result.command.commands).toEqual([
      expect.objectContaining({
        kind: "replaceNode",
        node: expect.objectContaining({
          dynamicPortState: { collectionItemCount: 1 },
          inputValues: {},
        }) as unknown,
      }),
      { kind: "removeEdge", graphId: GRAPH_ID, edgeId: EDGE_ID },
    ]);
  });

  it("keeps one collection item as the authored minimum", () => {
    const source = graph();
    const list = source.nodes[0];
    if (list === undefined) throw new Error("Expected a collection node.");
    const result = buildRemoveDynamicPortCommand(
      {
        ...source,
        nodes: [
          {
            ...list,
            dynamicPortState: { collectionItemCount: 1 },
          },
          ...source.nodes.slice(1),
        ],
      },
      LIST_ID,
    );

    expect(result).toEqual({ ok: false, reason: "minimumCount" });
  });

  it("keeps collection removal undoable and restores the wire on redo", () => {
    const source = graph();
    useDocumentStore.getState().openDocument(document(source));

    expect(removeDynamicPort(GRAPH_ID, LIST_ID)).toBe(true);
    let current = useDocumentStore.getState().history?.document.graphs[0];
    expect(current?.nodes[0]?.dynamicPortState).toEqual({
      collectionItemCount: 1,
    });
    expect(current?.nodes[0]?.inputValues).toEqual({});
    expect(current?.edges).toEqual([]);

    useDocumentStore.getState().undoChange();
    current = useDocumentStore.getState().history?.document.graphs[0];
    expect(current?.nodes[0]?.dynamicPortState).toEqual({
      collectionItemCount: 2,
    });
    expect(current?.nodes[0]?.inputValues).toEqual({ item2: "stale-value" });
    expect(current?.edges).toHaveLength(1);

    useDocumentStore.getState().redoChange();
    current = useDocumentStore.getState().history?.document.graphs[0];
    expect(current?.nodes[0]?.dynamicPortState).toEqual({
      collectionItemCount: 1,
    });
    expect(current?.edges).toEqual([]);
  });
});
