import type {
  GraphV1,
  RinoProjectDocumentV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";
import { describe, expect, it } from "vitest";

import coreDefinitions from "../../../../../contracts/fixtures/registry/valid/core-definitions.json";
import { connectionTargetKey } from "./connection-highlight";
import {
  connectionIndexFor,
  useConnectionDragStore,
} from "./connection-drag-store";

const registry = coreDefinitions as unknown as RinoNodeRegistrySnapshotV1;
const ENTRY_GRAPH_ID = "entry-graph";
const FUNCTION_GRAPH_ID = "function-graph";
const CALL_NODE_ID = "function-call";
const COMPARE_NODE_ID = "compare-node";

function node(nodeId: string, typeKey: string) {
  return {
    nodeId,
    typeKey,
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties:
      typeKey === "core.function.call"
        ? { functionGraphId: FUNCTION_GRAPH_ID }
        : {},
    inputValues: {},
  };
}

function documentWithOutputKind(
  outputKind: "number" | "string",
): RinoProjectDocumentV1 {
  const entryGraph: GraphV1 = {
    graphId: ENTRY_GRAPH_ID,
    name: "Main graph",
    kind: "entry",
    nodes: [
      node(CALL_NODE_ID, "core.function.call"),
      node(COMPARE_NODE_ID, "core.logic.numberCompare"),
    ],
    edges: [],
  };
  return {
    schemaVersion: 1,
    documentId: "document-id",
    metadata: {
      name: "Project",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    entryGraphId: ENTRY_GRAPH_ID,
    graphs: [
      entryGraph,
      {
        graphId: FUNCTION_GRAPH_ID,
        name: "Score function",
        kind: "function",
        functionSignature: {
          inputs: [],
          outputs: [
            {
              parameterId: "output-parameter",
              portId: "output-value",
              name: "Output value",
              valueKind: outputKind,
            },
          ],
        },
        nodes: [],
        edges: [],
      },
    ],
    assets: [],
    requiredCapabilities: [],
  };
}

describe("function-aware connection drag cache", () => {
  it("uses the document identity when preparing compatible targets", () => {
    const numberDocument = documentWithOutputKind("number");
    const stringDocument: RinoProjectDocumentV1 = {
      ...numberDocument,
      graphs: numberDocument.graphs.map((candidate) =>
        candidate.graphId === FUNCTION_GRAPH_ID
          ? {
              ...candidate,
              functionSignature: {
                inputs: [],
                outputs: [
                  {
                    parameterId: "output-parameter",
                    portId: "output-value",
                    name: "Output value",
                    valueKind: "string" as const,
                  },
                ],
              },
            }
          : candidate,
      ),
    };
    const graph = numberDocument.graphs[0];
    if (graph === undefined) {
      throw new Error("Entry graph is required.");
    }
    const origin = {
      nodeId: CALL_NODE_ID,
      portId: "output-value",
      handleType: "source" as const,
    };

    useConnectionDragStore
      .getState()
      .beginDrag(graph, registry, origin, numberDocument);
    expect(
      useConnectionDragStore
        .getState()
        .compatibleTargets.has(connectionTargetKey(COMPARE_NODE_ID, "left")),
    ).toBe(true);
    const numberIndex = connectionIndexFor(graph, registry, numberDocument);

    useConnectionDragStore
      .getState()
      .beginDrag(graph, registry, origin, stringDocument);
    expect(
      useConnectionDragStore
        .getState()
        .compatibleTargets.has(connectionTargetKey(COMPARE_NODE_ID, "left")),
    ).toBe(false);
    const stringIndex = connectionIndexFor(graph, registry, stringDocument);

    expect(stringIndex).not.toBe(numberIndex);
    useConnectionDragStore.getState().endDrag();
    expect(
      connectionIndexFor(graph, registry, stringDocument).evaluate({
        sourceNodeId: CALL_NODE_ID,
        sourcePortId: "output-value",
        targetNodeId: COMPARE_NODE_ID,
        targetPortId: "left",
      }),
    ).toEqual({ accepted: false, reason: "typeIncompatible" });
  });
});
