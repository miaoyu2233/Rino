import type { ImageAssetV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import { createEmptyProject } from "../project-factory";
import {
  parseProject,
  serializeProject,
  serializedProjectsMatch,
  type SerializedProject,
} from "./project-format";
import {
  allocateGraphFileName,
  ENTRY_GRAPH_FILE_NAME,
  imageAssetObjectPath,
  isAllocatableGraphFileName,
  PROJECT_MANIFEST_FILE_NAME,
} from "./project-paths";

const DOCUMENT_ID = "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9";
const GRAPH_ID = "1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea";
const PROJECT_VARIABLE_ID = "2c3d4e5f-6071-4283-9495-a6b7c8d9eafb";
const LEGACY_VARIABLE_ID = "3d4e5f60-7182-4394-a5b6-c7d8e9fa0b1c";
const LEGACY_CONFLICT_ID = "4e5f6071-8293-44a5-b6c7-d8e9fa0b1c2d";
const NODE_ID = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f";
const SECOND_NODE_ID = "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80";
const WORKFLOW_GROUP_ID = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";
const EDGE_ID = "6a5c9b8f-a3b4-4fc0-9be3-5d6e7f809102";
const REPEAT_HINT_ID = "7b6dac90-b4c5-40d1-8cf4-6e7f80910213";
const FUNCTION_GRAPH_ID = "8c7ebda1-c5d6-41e2-9d05-7f8091021324";
const FUNCTION_INPUT_A = "9d8fceb2-d6e7-42f3-8e16-80910213245a";
const FUNCTION_INPUT_B = "ae90dfc3-e7f8-4304-9f27-910213245f60";
const FUNCTION_OUTPUT = "bfa1e0d4-f809-4415-8038-0213245f6071";

function project(): RinoProjectDocumentV1 {
  let sequence = 0;
  // createEmptyProject asks for the entry graph's identifier before the document's.
  const identifiers = [GRAPH_ID, DOCUMENT_ID];
  return createEmptyProject({
    name: "示例项目",
    entryGraphName: "主图",
    createdAt: "2026-07-27T09:00:00Z",
    createIdentifier: () => {
      const identifier = identifiers[sequence];
      sequence += 1;
      if (identifier === undefined) {
        throw new Error("The fixture ran out of identifiers.");
      }
      return identifier;
    },
  });
}

function asset(overrides: Partial<ImageAssetV1> = {}): ImageAssetV1 {
  return {
    assetId: "2c3d4e5f-6071-4283-9495-a6b7c8d9eafb",
    displayName: "开始按钮",
    contentHash: "0a".repeat(32),
    mediaType: "image/png",
    byteLength: 4096,
    coordinateSpace: { spaceId: "device:1080x1920", width: 1080, height: 1920 },
    sourceKind: "deviceCapture",
    createdAt: "2026-07-27T09:05:00Z",
    ...overrides,
  };
}

function serialized(document: RinoProjectDocumentV1): SerializedProject {
  const outcome = serializeProject(document, new Map());
  if (!outcome.ok) {
    throw new Error(`The document should serialize: ${outcome.failure.reason}`);
  }
  return outcome.value;
}

describe("project file names", () => {
  it("allocates main for the entry graph and numbered names after it", () => {
    const taken = new Set<string>();
    expect(allocateGraphFileName(true, taken)).toBe(ENTRY_GRAPH_FILE_NAME);
    taken.add(ENTRY_GRAPH_FILE_NAME);
    expect(allocateGraphFileName(false, taken)).toBe("graph-2.rino.graph.json");
    taken.add("graph-2.rino.graph.json");
    expect(allocateGraphFileName(false, taken)).toBe("graph-3.rino.graph.json");
  });

  it("accepts only names the editor itself allocates", () => {
    expect(isAllocatableGraphFileName(ENTRY_GRAPH_FILE_NAME)).toBe(true);
    expect(isAllocatableGraphFileName("../main.rino.graph.json")).toBe(false);
    expect(isAllocatableGraphFileName("Main.rino.graph.json")).toBe(false);
    expect(isAllocatableGraphFileName("主图.rino.graph.json")).toBe(false);
  });

  it("addresses an image object by its content hash", () => {
    expect(imageAssetObjectPath("0a".repeat(32))).toBe(
      `assets/images/${"0a".repeat(32)}.png`,
    );
  });
});

describe("serializing a project", () => {
  it("splits a document into a manifest and one file per graph", () => {
    const files = serialized(project());

    expect(files.graphs).toHaveLength(1);
    expect(files.graphs[0]?.fileName).toBe(ENTRY_GRAPH_FILE_NAME);
    expect(JSON.parse(files.manifest)).toMatchObject({
      schemaVersion: 1,
      documentId: DOCUMENT_ID,
      entryGraphId: GRAPH_ID,
      graphs: [{ graphId: GRAPH_ID, fileName: ENTRY_GRAPH_FILE_NAME }],
    });
    expect(JSON.parse(files.graphs[0]?.contents ?? "")).toMatchObject({
      schemaVersion: 1,
      documentId: DOCUMENT_ID,
      graph: { graphId: GRAPH_ID, name: "主图", kind: "entry" },
    });
  });

  it("writes project variables to the manifest and never to graph files", () => {
    const document: RinoProjectDocumentV1 = {
      ...project(),
      variables: [
        {
          variableId: PROJECT_VARIABLE_ID,
          name: "sharedCount",
          valueKind: "number",
          persistent: true,
        },
      ],
    };
    const files = serialized(document);
    expect(JSON.parse(files.manifest)).toMatchObject({
      variables: [
        {
          variableId: PROJECT_VARIABLE_ID,
          name: "sharedCount",
          valueKind: "number",
          persistent: true,
        },
      ],
    });
    expect(
      JSON.parse(files.graphs[0]?.contents ?? "").graph,
    ).not.toHaveProperty("variables");
    expect(parseProject(files)).toMatchObject({
      ok: true,
      value: { document },
    });
  });

  it("promotes legacy graph variables when saving an unnormalized document", () => {
    const original = project();
    const entry = original.graphs[0];
    if (entry === undefined) {
      throw new Error("The fixture must hold an entry graph.");
    }
    const { variables: _variables, ...withoutProjectVariables } = original;
    const legacyDocument = {
      ...withoutProjectVariables,
      graphs: [
        {
          ...entry,
          variables: [
            {
              variableId: LEGACY_VARIABLE_ID,
              name: "legacyCount",
              valueKind: "number" as const,
              persistent: true,
            },
          ],
        },
      ],
    };

    const files = serialized(legacyDocument);
    expect(JSON.parse(files.manifest)).toMatchObject({
      variables: [
        {
          variableId: LEGACY_VARIABLE_ID,
          name: "legacyCount",
          valueKind: "number",
          persistent: true,
        },
      ],
    });
    expect(
      JSON.parse(files.graphs[0]?.contents ?? "").graph,
    ).not.toHaveProperty("variables");
    const parsed = parseProject(files);
    expect(parsed.ok && parsed.value.document.variables).toEqual([
      {
        variableId: LEGACY_VARIABLE_ID,
        name: "legacyCount",
        valueKind: "number",
        persistent: true,
      },
    ]);
  });

  it("rejects conflicting legacy definitions while saving", () => {
    const original = project();
    const entry = original.graphs[0];
    if (entry === undefined) {
      throw new Error("The fixture must hold an entry graph.");
    }
    const { variables: _variables, ...withoutProjectVariables } = original;
    const outcome = serializeProject(
      {
        ...withoutProjectVariables,
        graphs: [
          {
            ...entry,
            variables: [
              {
                variableId: LEGACY_CONFLICT_ID,
                name: "score",
                valueKind: "number" as const,
                persistent: false,
              },
              {
                variableId: LEGACY_CONFLICT_ID,
                name: "score",
                valueKind: "string" as const,
                persistent: false,
              },
            ],
          },
        ],
      },
      new Map(),
    );

    expect(outcome).toEqual({
      ok: false,
      failure: {
        reason: "documentInvalid",
        detail: `/variables/${LEGACY_CONFLICT_ID} has conflicting definitions`,
      },
    });
  });

  it("keeps function signature fields canonical without sorting parameter order", () => {
    const original = project();
    const entry = original.graphs[0];
    if (entry === undefined) {
      throw new Error("The fixture must hold an entry graph.");
    }
    const functionGraph: RinoProjectDocumentV1["graphs"][number] = {
      ...entry,
      graphId: FUNCTION_GRAPH_ID,
      name: "公共函数",
      kind: "function",
      functionSignature: {
        inputs: [
          {
            parameterId: FUNCTION_INPUT_B,
            portId: "secondInput",
            name: "第二个输入",
            valueKind: "string",
          },
          {
            parameterId: FUNCTION_INPUT_A,
            portId: "firstInput",
            name: "第一个输入",
            valueKind: "number",
          },
        ],
        outputs: [
          {
            parameterId: FUNCTION_OUTPUT,
            portId: "result",
            name: "结果",
            valueKind: "number",
          },
        ],
      },
    };
    const document: RinoProjectDocumentV1 = {
      ...original,
      graphs: [entry, functionGraph],
    };

    const files = serialized(document);
    const graphFile = files.graphs.find(
      (file) => file.fileName === "graph-2.rino.graph.json",
    );
    if (graphFile === undefined) {
      throw new Error("The function graph file should be allocated.");
    }
    const graphDocument = JSON.parse(graphFile.contents) as {
      graph: Record<string, unknown>;
    };
    const signature = graphDocument.graph["functionSignature"] as {
      inputs: Record<string, unknown>[];
      outputs: Record<string, unknown>[];
    };
    expect(Object.keys(graphDocument.graph)).toEqual([
      "graphId",
      "name",
      "kind",
      "functionSignature",
      "nodes",
      "edges",
    ]);
    expect(
      signature.inputs.map((parameter) => parameter["parameterId"]),
    ).toEqual([FUNCTION_INPUT_B, FUNCTION_INPUT_A]);
    expect(Object.keys(signature.inputs[0] ?? {})).toEqual([
      "parameterId",
      "portId",
      "name",
      "valueKind",
    ]);
    expect(
      signature.outputs.map((parameter) => parameter["parameterId"]),
    ).toEqual([FUNCTION_OUTPUT]);
    expect(parseProject(files)).toMatchObject({
      ok: true,
      value: { document },
    });
  });

  it("serializes and reopens multiple tasks in graph-array order", () => {
    const original = project();
    const entry = original.graphs[0];
    if (entry === undefined) {
      throw new Error("The fixture must hold an entry graph.");
    }
    const document: RinoProjectDocumentV1 = {
      ...original,
      graphs: [
        entry,
        {
          graphId: "2c3d4e5f-6071-4283-9495-a6b7c8d9eafb",
          name: "刷金币",
          kind: "entry",
          nodes: [],
          edges: [],
        },
        {
          graphId: "3d4e5f60-7182-4394-a5b6-c7d8e9fa0b1c",
          name: "刷钻石",
          kind: "entry",
          nodes: [],
          edges: [],
        },
      ],
    };

    const files = serialized(document);
    expect(files.graphs.map((file) => file.fileName)).toEqual([
      ENTRY_GRAPH_FILE_NAME,
      "graph-2.rino.graph.json",
      "graph-3.rino.graph.json",
    ]);
    expect(parseProject(files)).toMatchObject({
      ok: true,
      value: { document },
    });
  });

  it("preserves an optional comment size in canonical graph files", () => {
    const original = project();
    const graph = original.graphs[0];
    if (graph === undefined) {
      throw new Error("The fixture must hold an entry graph.");
    }
    const document: RinoProjectDocumentV1 = {
      ...original,
      graphs: [
        {
          ...graph,
          editorMetadata: {
            comments: [
              {
                commentId: "4e5f6071-8293-44a5-b6c7-d8e9fa0b1c2d",
                text: "带尺寸的说明",
                position: { x: 8, y: 16 },
                size: { width: 320, height: 160 },
              },
            ],
          },
        },
      ],
    };

    const parsed = parseProject(serialized(document));
    expect(parsed.ok && parsed.value.document).toStrictEqual(document);
  });

  it("round-trips repeat hints in graph files without changing the direct edge", () => {
    const original = project();
    const graph = original.graphs[0];
    if (graph === undefined) {
      throw new Error("The fixture must hold an entry graph.");
    }
    const document: RinoProjectDocumentV1 = {
      ...original,
      graphs: [
        {
          ...graph,
          nodes: [
            {
              nodeId: NODE_ID,
              typeKey: "core.flow.start",
              typeVersion: 1,
              position: { x: 0, y: 0 },
              properties: {},
              inputValues: {},
            },
            {
              nodeId: SECOND_NODE_ID,
              typeKey: "core.logic.branch",
              typeVersion: 1,
              position: { x: 240, y: 0 },
              properties: {},
              inputValues: {},
            },
          ],
          edges: [
            {
              edgeId: EDGE_ID,
              edgeKind: "execution",
              sourceNodeId: NODE_ID,
              sourcePortId: "next",
              targetNodeId: SECOND_NODE_ID,
              targetPortId: "run",
            },
          ],
          editorMetadata: {
            repeatHints: [
              {
                hintId: REPEAT_HINT_ID,
                edgeId: EDGE_ID,
                position: { x: 120, y: 80 },
              },
            ],
          },
        },
      ],
    };

    const files = serialized(document);
    expect(JSON.parse(files.graphs[0]?.contents ?? "")).toMatchObject({
      graph: {
        edges: [{ edgeId: EDGE_ID, edgeKind: "execution" }],
        editorMetadata: {
          repeatHints: [
            {
              hintId: REPEAT_HINT_ID,
              edgeId: EDGE_ID,
              position: { x: 120, y: 80 },
            },
          ],
        },
      },
    });
    const parsed = parseProject(files);
    expect(parsed.ok && parsed.value.document).toStrictEqual(document);
  });

  it("produces identical bytes for a document whose keys arrive in another order", () => {
    const document = project();
    const graph = document.graphs[0];
    if (!graph) {
      throw new Error("The fixture must hold an entry graph.");
    }
    const reordered: RinoProjectDocumentV1 = {
      requiredCapabilities: document.requiredCapabilities,
      assets: document.assets,
      graphs: [
        {
          edges: graph.edges,
          nodes: [
            {
              inputValues: { right: 100, left: 4 },
              properties: { operator: "greaterThan", tolerance: 1 },
              position: { y: 8, x: 4 },
              typeVersion: 1,
              typeKey: "core.logic.numberCompare",
              nodeId: NODE_ID,
            },
          ],
          kind: graph.kind,
          name: graph.name,
          graphId: graph.graphId,
        },
      ],
      entryGraphId: document.entryGraphId,
      metadata: document.metadata,
      documentId: document.documentId,
      schemaVersion: 1,
    };
    const ordered: RinoProjectDocumentV1 = {
      ...document,
      graphs: [
        {
          ...graph,
          nodes: [
            {
              nodeId: NODE_ID,
              typeKey: "core.logic.numberCompare",
              typeVersion: 1,
              position: { x: 4, y: 8 },
              properties: { tolerance: 1, operator: "greaterThan" },
              inputValues: { left: 4, right: 100 },
            },
          ],
        },
      ],
    };

    expect(serialized(reordered)).toStrictEqual(serialized(ordered));
  });

  it("keeps the file name a graph already had rather than reallocating one", () => {
    const document = project();
    const outcome = serializeProject(
      document,
      new Map([[GRAPH_ID, "graph-7.rino.graph.json"]]),
    );

    expect(outcome.ok && outcome.value.graphs[0]?.fileName).toBe(
      "graph-7.rino.graph.json",
    );
  });

  it("refuses a file name the format does not define and allocates one instead", () => {
    const outcome = serializeProject(
      project(),
      new Map([[GRAPH_ID, "../escape.rino.graph.json"]]),
    );

    expect(outcome.ok && outcome.value.graphs[0]?.fileName).toBe(
      ENTRY_GRAPH_FILE_NAME,
    );
  });

  it("rejects a commit whose asset names collide after normalization", () => {
    const document = {
      ...project(),
      assets: [
        asset({ displayName: "按钮 " }),
        asset({
          assetId: "3d4e5f60-7182-4394-a5b6-c7d8e9fa0b1c",
          displayName: "按钮",
        }),
      ],
    };

    const outcome = serializeProject(document, new Map());

    expect(outcome).toEqual({
      ok: false,
      failure: { reason: "duplicateAssetName", displayName: "按钮" },
    });
  });

  it("refuses to write a value JSON cannot represent", () => {
    const document = project();
    const graph = document.graphs[0];
    if (!graph) {
      throw new Error("The fixture must hold an entry graph.");
    }
    const withInfinity: RinoProjectDocumentV1 = {
      ...document,
      graphs: [
        {
          ...graph,
          nodes: [
            {
              nodeId: NODE_ID,
              typeKey: "core.value.numberLiteral",
              typeVersion: 1,
              position: { x: 0, y: 0 },
              properties: { value: Number.POSITIVE_INFINITY },
              inputValues: {},
            },
          ],
        },
      ],
    };

    const outcome = serializeProject(withInfinity, new Map());

    expect(outcome.ok).toBe(false);
  });
});

describe("parsing a project directory", () => {
  it("reassembles the document a save produced", () => {
    const document = project();
    const files = serialized(document);

    const parsed = parseProject(files);

    expect(parsed.ok && parsed.value.document).toStrictEqual(document);
    expect(parsed.ok && parsed.value.graphFileNames.get(GRAPH_ID)).toBe(
      ENTRY_GRAPH_FILE_NAME,
    );
    expect(parsed.ok && parsed.value.needsMigration).toBe(false);
  });

  it("opens a legacy monolithic document and allocates stable graph file names", () => {
    const original = project();
    const entry = original.graphs[0];
    if (entry === undefined) {
      throw new Error("The fixture must hold an entry graph.");
    }
    const legacy: RinoProjectDocumentV1 = {
      ...original,
      graphs: [
        entry,
        {
          ...entry,
          graphId: FUNCTION_GRAPH_ID,
          name: "刷金币",
        },
      ],
    };

    const parsed = parseProject({
      manifest: JSON.stringify(legacy),
      graphs: [],
    });
    if (!parsed.ok) {
      throw new Error(`Legacy project should open: ${parsed.failure.reason}`);
    }

    expect(parsed.value.document).toStrictEqual(legacy);
    expect(parsed.value.needsMigration).toBe(true);
    expect([...parsed.value.graphFileNames.entries()]).toEqual([
      [GRAPH_ID, ENTRY_GRAPH_FILE_NAME],
      [FUNCTION_GRAPH_ID, "graph-2.rino.graph.json"],
    ]);
  });

  it("promotes legacy graph variables into one project directory", () => {
    const original = project();
    const entry = original.graphs[0];
    if (entry === undefined) {
      throw new Error("The fixture must hold an entry graph.");
    }
    const secondGraph: RinoProjectDocumentV1["graphs"][number] = {
      ...entry,
      graphId: "5f607182-93a4-45b6-87d8-e9fa0b1c2d3e",
      name: "另一任务",
    };
    const files = serialized({ ...original, graphs: [entry, secondGraph] });
    const manifest = JSON.parse(files.manifest) as Record<string, unknown>;
    delete manifest["variables"];
    const legacyFiles = files.graphs.map((file) => {
      const decoded = JSON.parse(file.contents) as {
        graph: Record<string, unknown>;
      };
      decoded.graph["variables"] = [
        {
          variableId:
            file.fileName === ENTRY_GRAPH_FILE_NAME
              ? LEGACY_VARIABLE_ID
              : LEGACY_CONFLICT_ID,
          name: "score",
          valueKind: "number",
          persistent: false,
        },
      ];
      return { ...file, contents: JSON.stringify(decoded) };
    });
    const parsed = parseProject({
      manifest: JSON.stringify(manifest),
      graphs: legacyFiles,
    });
    if (!parsed.ok) {
      throw new Error(`Legacy project should open: ${parsed.failure.reason}`);
    }
    expect(parsed.value.document.variables).toEqual([
      {
        variableId: LEGACY_VARIABLE_ID,
        name: "score",
        valueKind: "number",
        persistent: false,
      },
      {
        variableId: LEGACY_CONFLICT_ID,
        name: "score (另一任务)",
        valueKind: "number",
        persistent: false,
      },
    ]);
    expect(
      Object.hasOwn(parsed.value.document.graphs[0] ?? {}, "variables"),
    ).toBe(false);
    expect(
      Object.hasOwn(parsed.value.document.graphs[1] ?? {}, "variables"),
    ).toBe(false);
  });

  it("rejects conflicting project and legacy variable definitions", () => {
    const files = serialized(project());
    const manifest = JSON.parse(files.manifest) as Record<string, unknown>;
    manifest["variables"] = [
      {
        variableId: LEGACY_CONFLICT_ID,
        name: "score",
        valueKind: "number",
        persistent: false,
      },
    ];
    const decoded = JSON.parse(files.graphs[0]?.contents ?? "") as {
      graph: Record<string, unknown>;
    };
    decoded.graph["variables"] = [
      {
        variableId: LEGACY_CONFLICT_ID,
        name: "score",
        valueKind: "string",
        persistent: false,
      },
    ];
    const parsed = parseProject({
      manifest: JSON.stringify(manifest),
      graphs: [
        {
          fileName: ENTRY_GRAPH_FILE_NAME,
          contents: JSON.stringify(decoded),
        },
      ],
    });
    expect(parsed).toEqual({
      ok: false,
      failure: {
        reason: "documentInvalid",
        detail: `/variables/${LEGACY_CONFLICT_ID} has conflicting definitions`,
      },
    });
  });

  it("round-trips collapsible workflow metadata without changing executable nodes", () => {
    const document = project();
    const graph = document.graphs[0];
    if (graph === undefined) {
      throw new Error("The fixture must hold an entry graph.");
    }
    const grouped: RinoProjectDocumentV1 = {
      ...document,
      graphs: [
        {
          ...graph,
          nodes: [
            {
              nodeId: NODE_ID,
              typeKey: "automation.captureScreen",
              typeVersion: 1,
              position: { x: 80, y: 120 },
              properties: {},
              inputValues: {},
            },
            {
              nodeId: SECOND_NODE_ID,
              typeKey: "vision.ocr",
              typeVersion: 1,
              position: { x: 360, y: 120 },
              properties: {},
              inputValues: {},
            },
          ],
          editorMetadata: {
            workflowGroups: [
              {
                groupId: WORKFLOW_GROUP_ID,
                kind: "textRecognition",
                collapsed: true,
                members: [
                  { role: "capture", nodeId: NODE_ID },
                  { role: "recognizer", nodeId: SECOND_NODE_ID },
                ],
                exposedPorts: [
                  {
                    proxyPortId: "run",
                    nodeId: NODE_ID,
                    portId: "run",
                    labelKey: "workflowGroup.textRecognition.port.run",
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    const parsed = parseProject(serialized(grouped));

    expect(parsed.ok && parsed.value.document).toStrictEqual(grouped);
  });

  it("writes identical bytes after a reopen", () => {
    const first = serialized(project());
    const parsed = parseProject(first);
    if (!parsed.ok) {
      throw new Error("The saved project should reopen.");
    }
    const second = serializeProject(
      parsed.value.document,
      parsed.value.graphFileNames,
    );

    expect(second.ok && serializedProjectsMatch(first, second.value)).toBe(
      true,
    );
  });

  it("refuses a manifest from a newer format instead of guessing at it", () => {
    const files = serialized(project());
    const manifest: unknown = JSON.parse(files.manifest);
    const raised = { ...(manifest as object), schemaVersion: 2 };

    const parsed = parseProject({
      manifest: JSON.stringify(raised),
      graphs: files.graphs,
    });

    expect(parsed).toEqual({
      ok: false,
      failure: { reason: "unsupportedVersion", foundVersion: 2 },
    });
  });

  it("reports a manifest that is not JSON at all", () => {
    const parsed = parseProject({ manifest: "not json", graphs: [] });

    expect(parsed).toEqual({
      ok: false,
      failure: { reason: "notJson", fileName: PROJECT_MANIFEST_FILE_NAME },
    });
  });

  it("reports a graph file the manifest names but the directory does not hold", () => {
    const files = serialized(project());

    const parsed = parseProject({ manifest: files.manifest, graphs: [] });

    expect(parsed).toEqual({
      ok: false,
      failure: {
        reason: "graphFileMissing",
        fileName: ENTRY_GRAPH_FILE_NAME,
      },
    });
  });

  it("refuses a graph file copied in from another project", () => {
    const files = serialized(project());
    const graphFile: unknown = JSON.parse(files.graphs[0]?.contents ?? "");
    const foreign = {
      ...(graphFile as object),
      documentId: "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a",
    };

    const parsed = parseProject({
      manifest: files.manifest,
      graphs: [
        { fileName: ENTRY_GRAPH_FILE_NAME, contents: JSON.stringify(foreign) },
      ],
    });

    expect(parsed).toEqual({
      ok: false,
      failure: {
        reason: "graphFileMismatch",
        fileName: ENTRY_GRAPH_FILE_NAME,
      },
    });
  });

  it("ignores a graph file the manifest does not name", () => {
    const files = serialized(project());

    const parsed = parseProject({
      manifest: files.manifest,
      graphs: [
        ...files.graphs,
        { fileName: "graph-9.rino.graph.json", contents: "{ not json" },
      ],
    });

    expect(parsed.ok).toBe(true);
  });

  it("rejects a project whose entry graph is not among its graphs", () => {
    const files = serialized(project());
    const manifest: unknown = JSON.parse(files.manifest);
    const orphaned = {
      ...(manifest as object),
      entryGraphId: "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a",
    };

    const parsed = parseProject({
      manifest: JSON.stringify(orphaned),
      graphs: files.graphs,
    });

    expect(parsed).toEqual({
      ok: false,
      failure: { reason: "entryGraphMissing" },
    });
  });
});
