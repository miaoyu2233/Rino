import {
  isValidProjectDocument,
  type GraphV1,
  type NodeV1,
  type RinoNodeRegistrySnapshotV1,
  type RinoProjectDocumentV1,
} from "@rino/contracts";
import { describe, expect, it } from "vitest";

import coreDefinitions from "../../../../../contracts/fixtures/registry/valid/core-definitions.json";
import { evaluateConnection } from "../connection-rules";
import { validateProjectDocument } from "../validate-graph";
import { applyCommand } from "./graph-commands";
import {
  buildDisconnectPortCommand,
  buildDuplicateCommand,
  buildPasteCommand,
  buildReconnectEdgeCommand,
  buildRemoveSelectionCommand,
  buildRetargetPortConnectionsCommand,
  buildTemplateInsertCommand,
  extractFragment,
} from "./graph-editing";

const registrySnapshot =
  coreDefinitions as unknown as RinoNodeRegistrySnapshotV1;

const GRAPH_ID = "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e";
const NODE_LITERAL = "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80";
const NODE_COMPARE = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";
const NODE_START = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const REPEAT_HINT_ID = "6a5c9b8f-a3b4-4fc0-9be3-5d6e7f809102";

/** Deterministic identifiers so a test asserts structure rather than randomness. */
function createIdentifierFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `feed0000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
  };
}

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

function baseDocument(): RinoProjectDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "1b0d4c3a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    metadata: {
      name: "测试项目",
      createdAt: "2026-07-26T10:00:00Z",
      updatedAt: "2026-07-26T10:00:00Z",
    },
    entryGraphId: GRAPH_ID,
    graphs: [
      {
        graphId: GRAPH_ID,
        name: "主图",
        kind: "entry",
        nodes: [
          node(NODE_START, "core.flow.start"),
          node(NODE_LITERAL, "core.value.numberLiteral", {
            position: { x: 40, y: 180 },
            breakpoint: true,
          }),
          node(NODE_COMPARE, "core.logic.numberCompare", {
            position: { x: 320, y: 120 },
            inputValues: { left: 7 },
          }),
        ],
        edges: [
          {
            edgeId: "8c7ebda1-c5d6-41e2-9d05-7f8091021324",
            edgeKind: "data",
            sourceNodeId: NODE_LITERAL,
            sourcePortId: "value",
            targetNodeId: NODE_COMPARE,
            targetPortId: "right",
          },
        ],
      },
    ],
    assets: [],
    requiredCapabilities: [],
  };
}

function applyOrThrow(
  document: RinoProjectDocumentV1,
  command: Parameters<typeof applyCommand>[1],
): RinoProjectDocumentV1 {
  const outcome = applyCommand(document, command);
  if (!outcome.ok) {
    throw new Error(`The command should have applied: ${outcome.reason}`);
  }
  return outcome.document;
}

/** The entry graph of a fresh document, which is what the editor hands the fragment and
 * duplicate builders. */
function baseGraph(): GraphV1 {
  const graph = baseDocument().graphs[0];
  if (!graph) {
    throw new Error("The document must contain one graph.");
  }
  return graph;
}

function graphWithRepeatHint(): GraphV1 {
  const graph = baseGraph();
  const edge = graph.edges[0];
  if (edge === undefined) {
    throw new Error("The base graph must contain one edge.");
  }
  return {
    ...graph,
    edges: [{ ...edge, edgeKind: "execution" }],
    editorMetadata: {
      repeatHints: [
        {
          hintId: REPEAT_HINT_ID,
          edgeId: edge.edgeId,
          position: { x: 100, y: 140 },
        },
      ],
    },
  };
}

describe("fragment extraction", () => {
  it("carries only the edges wholly inside the selection", () => {
    const fragment = extractFragment(baseGraph(), [NODE_LITERAL, NODE_COMPARE]);

    expect(fragment.nodes).toHaveLength(2);
    expect(fragment.edges).toHaveLength(1);
  });

  it("drops an edge that leaves the selection", () => {
    const fragment = extractFragment(baseGraph(), [NODE_LITERAL]);

    expect(fragment.nodes).toHaveLength(1);
    expect(fragment.edges).toHaveLength(0);
  });

  it("drops a hint when its referenced edge is outside the selection", () => {
    const graph = graphWithRepeatHint();
    const fragment = extractFragment(graph, [NODE_LITERAL]);

    expect(fragment.repeatHints).toBeUndefined();
  });

  it("ignores identifiers that name no node in the graph", () => {
    const fragment = extractFragment(baseGraph(), [
      "00000000-0000-4000-8000-000000000000",
    ]);

    expect(fragment).toEqual({ nodes: [], edges: [], workflowGroups: [] });
  });
});

describe("paste", () => {
  it("inserts the fragment under fresh identifiers with rewritten references", () => {
    const original = baseDocument();
    const fragment = extractFragment(baseGraph(), [NODE_LITERAL, NODE_COMPARE]);
    const command = buildPasteCommand(
      GRAPH_ID,
      fragment,
      createIdentifierFactory(),
    );

    const pasted = applyOrThrow(original, command);
    const graph = pasted.graphs[0];
    if (!graph) {
      throw new Error("The document must contain one graph.");
    }

    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges).toHaveLength(2);

    const newEdge = graph.edges[1];
    const originalNodeIds = new Set([NODE_LITERAL, NODE_COMPARE]);
    expect(originalNodeIds.has(newEdge?.sourceNodeId ?? "")).toBe(false);
    expect(originalNodeIds.has(newEdge?.targetNodeId ?? "")).toBe(false);
    expect(isValidProjectDocument(pasted)).toBe(true);
  });

  it("can paste the same fragment repeatedly without collisions", () => {
    const original = baseDocument();
    const fragment = extractFragment(baseGraph(), [NODE_LITERAL]);
    const createIdentifier = createIdentifierFactory();

    let current = original;
    for (let repeat = 0; repeat < 3; repeat += 1) {
      current = applyOrThrow(
        current,
        buildPasteCommand(GRAPH_ID, fragment, createIdentifier),
      );
    }

    const nodeIds = current.graphs[0]?.nodes.map((item) => item.nodeId) ?? [];
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(nodeIds).toHaveLength(6);
  });

  it("offsets the pasted nodes and clears their breakpoints", () => {
    const original = baseDocument();
    const fragment = extractFragment(baseGraph(), [NODE_LITERAL]);

    const pasted = applyOrThrow(
      original,
      buildPasteCommand(GRAPH_ID, fragment, createIdentifierFactory(), {
        offset: { x: 10, y: 20 },
      }),
    );

    const inserted = pasted.graphs[0]?.nodes.at(-1);
    expect(inserted?.position).toEqual({ x: 50, y: 200 });
    // A breakpoint belongs to a debugging session, not to the copied logic.
    expect(inserted?.breakpoint).toBe(false);
    expect(inserted?.inputValues).toEqual({});
  });

  it("remaps and offsets repeat hints together with their copied edge", () => {
    const source = graphWithRepeatHint();
    const original = {
      ...baseDocument(),
      graphs: [source],
    };
    const fragment = extractFragment(source, [NODE_LITERAL, NODE_COMPARE]);
    const pasted = applyOrThrow(
      original,
      buildPasteCommand(GRAPH_ID, fragment, createIdentifierFactory(), {
        offset: { x: 10, y: 20 },
      }),
    );
    const graph = pasted.graphs[0];
    if (graph === undefined) {
      throw new Error("The document must contain one graph.");
    }

    expect(graph.editorMetadata?.repeatHints).toHaveLength(2);
    const copiedHint = graph.editorMetadata?.repeatHints?.[1];
    expect(copiedHint?.hintId).not.toBe(REPEAT_HINT_ID);
    expect(copiedHint?.edgeId).toBe(graph.edges[1]?.edgeId);
    expect(copiedHint?.position).toEqual({ x: 110, y: 160 });
    expect(isValidProjectDocument(pasted)).toBe(true);
  });

  it("is undone as a single step", () => {
    const original = baseDocument();
    const fragment = extractFragment(baseGraph(), [NODE_LITERAL, NODE_COMPARE]);
    const outcome = applyCommand(
      original,
      buildPasteCommand(GRAPH_ID, fragment, createIdentifierFactory()),
    );
    if (!outcome.ok) {
      throw new Error("The paste should have applied.");
    }

    const reverted = applyOrThrow(outcome.document, outcome.inverse);
    expect(reverted).toEqual(original);
  });
});

describe("duplicate", () => {
  it("copies a selection in place under fresh identifiers", () => {
    const original = baseDocument();
    const duplicated = applyOrThrow(
      original,
      buildDuplicateCommand(
        baseGraph(),
        [NODE_LITERAL, NODE_COMPARE],
        createIdentifierFactory(),
      ),
    );

    expect(duplicated.graphs[0]?.nodes).toHaveLength(5);
    expect(isValidProjectDocument(duplicated)).toBe(true);
  });
});

describe("remove selection", () => {
  it("removes the nodes and their edges as one step", () => {
    const original = baseDocument();
    const outcome = applyCommand(
      original,
      buildRemoveSelectionCommand(GRAPH_ID, [NODE_LITERAL, NODE_COMPARE]),
    );
    if (!outcome.ok) {
      throw new Error("The removal should have applied.");
    }

    expect(outcome.document.graphs[0]?.nodes).toHaveLength(1);
    expect(outcome.document.graphs[0]?.edges).toHaveLength(0);

    const restored = applyOrThrow(outcome.document, outcome.inverse);
    expect(restored).toEqual(original);
  });
});

describe("connection gestures", () => {
  it("removes every wire on a port as one reversible edit", () => {
    const original = baseDocument();
    const edgeId = original.graphs[0]?.edges[0]?.edgeId;
    if (!edgeId) {
      throw new Error("The base graph must contain one edge.");
    }

    const outcome = applyCommand(
      original,
      buildDisconnectPortCommand(GRAPH_ID, [edgeId]),
    );
    if (!outcome.ok) {
      throw new Error("Disconnecting the port should apply.");
    }

    expect(outcome.document.graphs[0]?.edges).toEqual([]);
    expect(applyOrThrow(outcome.document, outcome.inverse)).toEqual(original);
  });

  it("moves every connection to a matching-side port in one reversible edit", () => {
    const original = baseDocument();
    const command = buildRetargetPortConnectionsCommand(
      baseGraph(),
      registrySnapshot,
      { nodeId: NODE_COMPARE, portId: "right", direction: "input" },
      { nodeId: NODE_COMPARE, portId: "left", direction: "input" },
      createIdentifierFactory(),
    );
    if (!command.ok) {
      throw new Error(`The retarget should be accepted: ${command.reason}`);
    }

    const outcome = applyCommand(original, command.command);
    if (!outcome.ok) {
      throw new Error("Moving the port wires should apply.");
    }
    expect(outcome.document.graphs[0]?.edges).toMatchObject([
      {
        sourceNodeId: NODE_LITERAL,
        sourcePortId: "value",
        targetNodeId: NODE_COMPARE,
        targetPortId: "left",
      },
    ]);
    expect(applyOrThrow(outcome.document, outcome.inverse)).toEqual(original);
  });

  it("reconnects one selected wire without leaving its original behind", () => {
    const original = baseDocument();
    const edgeId = original.graphs[0]?.edges[0]?.edgeId;
    if (!edgeId) {
      throw new Error("The base graph must contain one edge.");
    }
    const candidate = {
      sourceNodeId: NODE_LITERAL,
      sourcePortId: "value",
      targetNodeId: NODE_COMPARE,
      targetPortId: "left",
    };
    const evaluation = evaluateConnection(
      baseGraph(),
      registrySnapshot,
      candidate,
    );
    if (!evaluation.accepted) {
      throw new Error("The replacement connection should be accepted.");
    }

    const outcome = applyCommand(
      original,
      buildReconnectEdgeCommand(
        GRAPH_ID,
        edgeId,
        candidate,
        evaluation,
        createIdentifierFactory(),
      ),
    );
    if (!outcome.ok) {
      throw new Error("Reconnecting the wire should apply.");
    }
    expect(outcome.document.graphs[0]?.edges).toMatchObject([
      { targetPortId: "left" },
    ]);
    expect(applyOrThrow(outcome.document, outcome.inverse)).toEqual(original);
  });

  it("does not move a port's wires onto an opposite-side port", () => {
    const result = buildRetargetPortConnectionsCommand(
      baseGraph(),
      registrySnapshot,
      { nodeId: NODE_COMPARE, portId: "right", direction: "input" },
      { nodeId: NODE_LITERAL, portId: "value", direction: "output" },
      createIdentifierFactory(),
    );

    expect(result).toEqual({ ok: false, reason: "directionMismatch" });
  });
});

describe("workflow template insertion", () => {
  it("expands into ordinary editable nodes and edges", () => {
    const original = baseDocument();
    const expansion = buildTemplateInsertCommand(
      GRAPH_ID,
      "template.recognizeNumberAndBranch",
      registrySnapshot,
      { x: 600, y: 400 },
      createIdentifierFactory(),
    );
    if (!expansion.ok) {
      throw new Error(`The template should have expanded: ${expansion.reason}`);
    }

    const inserted = applyOrThrow(original, expansion.command);
    const graph = inserted.graphs[0];
    if (!graph) {
      throw new Error("The document must contain one graph.");
    }

    // The template contributes eight ordinary nodes and eleven internal edges.
    expect(graph.nodes).toHaveLength(11);
    expect(graph.edges).toHaveLength(12);
    expect(isValidProjectDocument(inserted)).toBe(true);

    const insertedNodes = graph.nodes.slice(3);
    expect(insertedNodes.map((item) => item.typeKey)).toEqual([
      "automation.captureScreen",
      "vision.ocr",
      "core.logic.branch",
      "text.parseNumber",
      "core.logic.numberCompare",
      "core.logic.branch",
      "core.diagnostic.log",
      "core.diagnostic.log",
    ]);
    expect(insertedNodes[0]?.position).toEqual({ x: 880, y: 520 });
    expect(insertedNodes[4]?.inputValues).toEqual({ right: 100 });
  });

  it("takes the definition version from the registry rather than assuming one", () => {
    const expansion = buildTemplateInsertCommand(
      GRAPH_ID,
      "template.recognizeNumberAndBranch",
      registrySnapshot,
      { x: 0, y: 0 },
      createIdentifierFactory(),
    );
    if (!expansion.ok) {
      throw new Error("The template should have expanded.");
    }

    const inserted = applyOrThrow(baseDocument(), expansion.command);
    for (const item of inserted.graphs[0]?.nodes ?? []) {
      const definition = registrySnapshot.definitions.find(
        (candidate) => candidate.typeKey === item.typeKey,
      );
      expect(item.typeVersion).toBe(definition?.typeVersion);
    }
  });

  it("creates one collapsible authoring group while keeping ordinary nodes authoritative", () => {
    const groupedRegistry: RinoNodeRegistrySnapshotV1 = {
      ...registrySnapshot,
      workflowTemplates: [
        ...(registrySnapshot.workflowTemplates ?? []),
        {
          templateKey: "template.groupedRecognition",
          titleKey: "workflowGroup.textRecognition.title",
          descriptionKey: "workflowGroup.textRecognition.description",
          iconKey: "node.ocr",
          nodes: [
            {
              placeholderId: "capture",
              typeKey: "automation.captureScreen",
              offset: { x: 0, y: 0 },
            },
            {
              placeholderId: "recognizer",
              typeKey: "vision.ocr",
              offset: { x: 280, y: 0 },
            },
          ],
          edges: [
            {
              edgeKind: "data",
              sourcePlaceholderId: "capture",
              sourcePortId: "image",
              targetPlaceholderId: "recognizer",
              targetPortId: "image",
            },
          ],
          workflowGroup: {
            kind: "textRecognition",
            members: [
              { role: "capture", placeholderId: "capture" },
              { role: "recognizer", placeholderId: "recognizer" },
            ],
            exposedPorts: [
              {
                proxyPortId: "run",
                placeholderId: "capture",
                portId: "run",
                labelKey: "workflowGroup.textRecognition.port.run",
              },
              {
                proxyPortId: "next",
                placeholderId: "recognizer",
                portId: "next",
                labelKey: "workflowGroup.textRecognition.port.next",
              },
            ],
          },
        },
      ],
    };
    const expansion = buildTemplateInsertCommand(
      GRAPH_ID,
      "template.groupedRecognition",
      groupedRegistry,
      { x: 600, y: 400 },
      createIdentifierFactory(),
    );
    if (!expansion.ok) {
      throw new Error(
        `The grouped template should expand: ${expansion.reason}`,
      );
    }

    const inserted = applyOrThrow(baseDocument(), expansion.command);
    const graph = inserted.graphs[0];
    const group = graph?.editorMetadata?.workflowGroups?.[0];

    expect(graph?.nodes.slice(-2).map((item) => item.typeKey)).toEqual([
      "automation.captureScreen",
      "vision.ocr",
    ]);
    expect(group).toMatchObject({
      kind: "textRecognition",
      collapsed: true,
      members: [{ role: "capture" }, { role: "recognizer" }],
    });
    expect(group?.members.map((member) => member.nodeId)).toEqual(
      graph?.nodes.slice(-2).map((item) => item.nodeId),
    );
  });

  it("configures default self-repeat without adding a repeat card", () => {
    const expansion = buildTemplateInsertCommand(
      GRAPH_ID,
      "template.textRecognition",
      registrySnapshot,
      { x: 600, y: 400 },
      createIdentifierFactory(),
    );
    if (!expansion.ok) {
      throw new Error(
        `The recognition template should expand: ${expansion.reason}`,
      );
    }

    const inserted = applyOrThrow(baseDocument(), expansion.command);
    const graph = inserted.graphs[0];
    const group = graph?.editorMetadata?.workflowGroups?.[0];
    const retryMember = group?.members.find(
      (member) => member.role === "retryDelay",
    );
    const retryNode = graph?.nodes.find(
      (item) => item.nodeId === retryMember?.nodeId,
    );
    const noMatch = group?.exposedPorts.find(
      (port) => port.proxyPortId === "noMatch",
    );
    const run = group?.exposedPorts.find((port) => port.proxyPortId === "run");
    const repeatEdge = graph?.edges.find(
      (edge) =>
        edge.sourceNodeId === noMatch?.nodeId &&
        edge.sourcePortId === noMatch.portId &&
        edge.targetNodeId === retryNode?.nodeId,
    );

    expect(retryNode).toMatchObject({
      typeKey: "core.time.delay",
      inputValues: { durationMilliseconds: 1_000 },
    });
    expect(graph?.edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: retryNode?.nodeId,
        sourcePortId: "next",
        targetNodeId: run?.nodeId,
        targetPortId: run?.portId,
      }),
    );
    expect(repeatEdge).toBeDefined();
    expect(graph?.editorMetadata?.repeatHints).toBeUndefined();
    expect(isValidProjectDocument(inserted)).toBe(true);
  });
  it("is undone as a single step", () => {
    const original = baseDocument();
    const expansion = buildTemplateInsertCommand(
      GRAPH_ID,
      "template.recognizeNumberAndBranch",
      registrySnapshot,
      { x: 600, y: 400 },
      createIdentifierFactory(),
    );
    if (!expansion.ok) {
      throw new Error("The template should have expanded.");
    }

    const outcome = applyCommand(original, expansion.command);
    if (!outcome.ok) {
      throw new Error("The insertion should have applied.");
    }
    const reverted = applyOrThrow(outcome.document, outcome.inverse);

    expect(reverted).toEqual(original);
  });

  it("reports an unknown template instead of inserting a partial graph", () => {
    const expansion = buildTemplateInsertCommand(
      GRAPH_ID,
      "template.doesNotExist",
      registrySnapshot,
      { x: 0, y: 0 },
      createIdentifierFactory(),
    );

    expect(expansion).toEqual({ ok: false, reason: "templateUnknown" });
  });

  it("reports a template that references a definition the registry lacks", () => {
    const reducedRegistry: RinoNodeRegistrySnapshotV1 = {
      ...registrySnapshot,
      definitions: registrySnapshot.definitions.filter(
        (definition) => definition.typeKey !== "core.logic.branch",
      ),
    };

    const expansion = buildTemplateInsertCommand(
      GRAPH_ID,
      "template.recognizeNumberAndBranch",
      reducedRegistry,
      { x: 0, y: 0 },
      createIdentifierFactory(),
    );

    expect(expansion).toEqual({ ok: false, reason: "definitionUnknown" });
  });

  it("produces a graph the validator accepts apart from its unconnected inputs", () => {
    const expansion = buildTemplateInsertCommand(
      GRAPH_ID,
      "template.recognizeNumberAndBranch",
      registrySnapshot,
      { x: 600, y: 400 },
      createIdentifierFactory(),
    );
    if (!expansion.ok) {
      throw new Error("The template should have expanded.");
    }

    const inserted = applyOrThrow(baseDocument(), expansion.command);
    const report = validateProjectDocument(inserted, registrySnapshot);

    // The template has a real external run port and no nested graph entry; its internal
    // OCR, parsing, and comparison inputs are fully wired.
    expect(new Set(report.diagnostics.map((item) => item.code))).toEqual(
      new Set(),
    );
  });
});
