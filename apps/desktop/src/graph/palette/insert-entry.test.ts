import {
  isValidProjectDocument,
  type RinoNodeRegistrySnapshotV1,
  type RinoProjectDocumentV1,
} from "@rino/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import coreDefinitions from "../../../../../contracts/fixtures/registry/valid/core-definitions.json";
import { createEmptyProject } from "../project-factory";
import { useRegistryStore } from "../registry/registry-store";
import { useDocumentStore } from "../store/document-store";
import { openProjectDocument } from "../store/project-lifecycle";
import { validateProjectDocument } from "../validate-graph";
import { insertImageAssetNode, insertPaletteEntry } from "./insert-entry";
import { buildPaletteEntries, type PaletteEntry } from "./palette-model";

const registry = {
  ...coreDefinitions,
  definitions: [
    ...coreDefinitions.definitions,
    {
      typeKey: "automation.captureScreen",
      typeVersion: 1,
      runtimeKind: "execution",
      sideEffect: "deviceRead",
      category: "device",
      titleKey: "node.automation.captureScreen.title",
      descriptionKey: "node.automation.captureScreen.description",
      iconKey: "node.capture",
      ports: [
        {
          portId: "run",
          direction: "input",
          portKind: "execution",
          type: { kind: "exec" },
          labelKey: "node.automation.captureScreen.port.run",
        },
        {
          portId: "image",
          direction: "output",
          portKind: "data",
          type: { kind: "imageRef" },
          labelKey: "node.automation.captureScreen.port.image",
        },
        {
          portId: "next",
          direction: "output",
          portKind: "execution",
          type: { kind: "exec" },
          labelKey: "node.automation.captureScreen.port.next",
        },
      ],
    },
    {
      typeKey: "core.geometry.point",
      typeVersion: 1,
      runtimeKind: "pure",
      sideEffect: "none",
      category: "values",
      titleKey: "node.core.geometry.point.title",
      descriptionKey: "node.core.geometry.point.description",
      iconKey: "node.coordinate",
      ports: [
        {
          portId: "image",
          direction: "input",
          portKind: "data",
          type: { kind: "imageRef" },
          labelKey: "node.core.geometry.point.port.image",
          required: true,
        },
        ...["x", "y", "referenceWidth", "referenceHeight"].map((portId) => ({
          portId,
          direction: "input",
          portKind: "data",
          type: { kind: "number" },
          labelKey: `node.core.geometry.point.port.${portId}`,
          required: true,
          acceptsLiteral: true,
        })),
        {
          portId: "point",
          direction: "output",
          portKind: "data",
          type: { kind: "point" },
          labelKey: "node.core.geometry.point.port.point",
        },
      ],
    },
    {
      typeKey: "automation.clickPoint",
      typeVersion: 1,
      runtimeKind: "execution",
      sideEffect: "deviceWrite",
      category: "device",
      titleKey: "node.automation.clickPoint.title",
      descriptionKey: "node.automation.clickPoint.description",
      iconKey: "node.click",
      ports: [
        {
          portId: "run",
          direction: "input",
          portKind: "execution",
          type: { kind: "exec" },
          labelKey: "node.automation.clickPoint.port.run",
        },
        {
          portId: "point",
          direction: "input",
          portKind: "data",
          type: { kind: "point" },
          labelKey: "node.automation.clickPoint.port.point",
          required: true,
        },
        {
          portId: "clicked",
          direction: "output",
          portKind: "data",
          type: { kind: "bool" },
          labelKey: "node.automation.clickPoint.port.clicked",
        },
        {
          portId: "next",
          direction: "output",
          portKind: "execution",
          type: { kind: "exec" },
          labelKey: "node.automation.clickPoint.port.next",
        },
      ],
    },
    {
      typeKey: "core.image.projectAsset",
      typeVersion: 1,
      runtimeKind: "pure",
      sideEffect: "none",
      category: "values",
      titleKey: "node.core.image.projectAsset.title",
      descriptionKey: "node.core.image.projectAsset.description",
      iconKey: "node.imageRecognition",
      ports: [
        {
          portId: "image",
          direction: "output",
          portKind: "data",
          type: { kind: "imageRef" },
          labelKey: "node.core.image.projectAsset.port.image",
        },
      ],
      propertySchema: {
        type: "object",
        additionalProperties: false,
        required: ["assetId"],
        properties: {
          assetId: {
            type: "string",
            format: "uuid",
            "x-rinoLabelKey":
              "node.core.image.projectAsset.property.assetId.label",
            "x-rinoDescriptionKey":
              "node.core.image.projectAsset.property.assetId.description",
          },
        },
      },
    },
  ],
} as unknown as RinoNodeRegistrySnapshotV1;
const entries = buildPaletteEntries(registry);

const VARIABLE_NODE_KINDS = [
  ["Bool", "bool"],
  ["Number", "number"],
  ["String", "string"],
  ["Point", "point"],
  ["Rect", "rect"],
  ["ImageRef", "imageRef"],
] as const;

const variableDefinitions = VARIABLE_NODE_KINDS.flatMap(([suffix, kind]) => [
  {
    typeKey: `core.variable.get${suffix}`,
    typeVersion: 1,
    runtimeKind: "pure",
    sideEffect: "none",
    category: "values",
    titleKey: `node.core.variable.get${suffix}.title`,
    descriptionKey: `node.core.variable.get${suffix}.description`,
    iconKey: "node.variable",
    ports: [
      {
        portId: "value",
        direction: "output",
        portKind: "data",
        type: { kind },
        labelKey: `node.core.variable.get${suffix}.port.value`,
      },
    ],
  },
  {
    typeKey: `core.variable.set${suffix}`,
    typeVersion: 1,
    runtimeKind: "execution",
    sideEffect: "runtime",
    category: "values",
    titleKey: `node.core.variable.set${suffix}.title`,
    descriptionKey: `node.core.variable.set${suffix}.description`,
    iconKey: "node.variable",
    ports: [
      {
        portId: "run",
        direction: "input",
        portKind: "execution",
        type: { kind: "exec" },
        labelKey: `node.core.variable.set${suffix}.port.run`,
      },
      {
        portId: "value",
        direction: "input",
        portKind: "data",
        type: { kind },
        labelKey: `node.core.variable.set${suffix}.port.value`,
        required: true,
      },
      {
        portId: "storedValue",
        direction: "output",
        portKind: "data",
        type: { kind },
        labelKey: `node.core.variable.set${suffix}.port.storedValue`,
      },
      {
        portId: "next",
        direction: "output",
        portKind: "execution",
        type: { kind: "exec" },
        labelKey: `node.core.variable.set${suffix}.port.next`,
      },
    ],
  },
]);
const variableRegistry = {
  ...registry,
  definitions: [...registry.definitions, ...variableDefinitions],
} as unknown as RinoNodeRegistrySnapshotV1;
const variableEntries = buildPaletteEntries(variableRegistry);

function entryFor(key: string): PaletteEntry {
  const entry = entries.find((candidate) => candidate.key === key);
  if (!entry) {
    throw new Error(`The fixture must define ${key}.`);
  }
  return entry;
}

function variableEntryFor(key: string): PaletteEntry {
  const entry = variableEntries.find((candidate) => candidate.key === key);
  if (!entry) {
    throw new Error(`The variable fixture must define ${key}.`);
  }
  return entry;
}

function identifierFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `feed0000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
  };
}

function currentDocument(): RinoProjectDocumentV1 {
  const document = useDocumentStore.getState().history?.document;
  if (!document) {
    throw new Error("A project must be open.");
  }
  return document;
}

function nodes() {
  return currentDocument().graphs[0]?.nodes ?? [];
}

function edges() {
  return currentDocument().graphs[0]?.edges ?? [];
}

beforeEach(() => {
  useRegistryStore.getState().installSnapshot(registry, "development");
  openProjectDocument(
    createEmptyProject({
      name: "测试项目",
      entryGraphName: "主图",
      createdAt: "2026-07-26T10:00:00Z",
      createIdentifier: identifierFactory(),
    }),
  );
});

describe("inserting a node", () => {
  it("places the node centred on the requested position with its property defaults", () => {
    const outcome = insertPaletteEntry(entryFor("core.logic.numberCompare"), {
      centerOn: { x: 400, y: 300 },
    });

    expect(outcome.ok).toBe(true);
    expect(nodes()).toHaveLength(1);
    // The pointer holds the node by its header: 400 - 220/2 = 290 and 300 - 32/2 = 284,
    // both then snapped to the 8 px grid.
    expect(nodes()[0]?.position).toEqual({ x: 288, y: 288 });
    expect(nodes()[0]?.properties).toEqual({ operator: "greaterThan" });
    expect(isValidProjectDocument(currentDocument())).toBe(true);
  });

  it("places the node exactly at an explicit origin", () => {
    insertPaletteEntry(entryFor("core.flow.start"), {
      origin: { x: 64, y: 128 },
    });

    expect(nodes()[0]?.position).toEqual({ x: 64, y: 128 });
  });

  it("refuses when no project is open", () => {
    useDocumentStore.getState().closeDocument();

    expect(insertPaletteEntry(entryFor("core.flow.start"))).toEqual({
      ok: false,
      reason: "noProject",
    });
  });

  it("refuses when no registry is installed", () => {
    useRegistryStore.getState().clearSnapshot();

    expect(insertPaletteEntry(entryFor("core.flow.start"))).toEqual({
      ok: false,
      reason: "noRegistry",
    });
  });

  it("inserts a ready-to-edit capture and point bundle for click coordinates", () => {
    const outcome = insertPaletteEntry(entryFor("automation.clickPoint"), {
      centerOn: { x: 800, y: 320 },
    });

    expect(outcome.ok).toBe(true);
    expect(nodes().map((node) => node.typeKey)).toEqual([
      "automation.captureScreen",
      "core.geometry.point",
      "automation.clickPoint",
    ]);
    const [capture, point, click] = nodes();
    expect(point?.inputValues).toEqual({
      x: 0,
      y: 0,
      referenceWidth: 1,
      referenceHeight: 1,
    });
    expect(edges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeKind: "execution",
          sourceNodeId: capture?.nodeId,
          sourcePortId: "next",
          targetNodeId: click?.nodeId,
          targetPortId: "run",
        }),
        expect.objectContaining({
          sourceNodeId: capture?.nodeId,
          sourcePortId: "image",
          targetNodeId: point?.nodeId,
          targetPortId: "image",
        }),
        expect.objectContaining({
          sourceNodeId: point?.nodeId,
          sourcePortId: "point",
          targetNodeId: click?.nodeId,
          targetPortId: "point",
        }),
      ]),
    );

    useDocumentStore.getState().undoChange();
    expect(nodes()).toHaveLength(0);
    expect(edges()).toHaveLength(0);
  });
});

describe("inserting a node wired to a dragged connection", () => {
  it("creates the node and the edge as one undoable step", () => {
    insertPaletteEntry(entryFor("core.value.numberLiteral"), {
      centerOn: { x: 0, y: 0 },
    });
    const literalId = nodes()[0]?.nodeId ?? "";

    const outcome = insertPaletteEntry(entryFor("core.logic.numberCompare"), {
      centerOn: { x: 400, y: 0 },
      connectFrom: {
        nodeId: literalId,
        portId: "value",
        type: { kind: "number" },
        portKind: "data",
        direction: "output",
      },
    });

    expect(outcome.ok).toBe(true);
    expect(nodes()).toHaveLength(2);
    expect(edges()).toHaveLength(1);
    expect(edges()[0]).toMatchObject({
      edgeKind: "data",
      sourceNodeId: literalId,
      sourcePortId: "value",
      targetPortId: "left",
    });

    useDocumentStore.getState().undoChange();

    expect(nodes()).toHaveLength(1);
    expect(edges()).toHaveLength(0);
  });

  it("wires the other way round when the drag started at an input", () => {
    insertPaletteEntry(entryFor("core.logic.numberCompare"), {
      centerOn: { x: 400, y: 0 },
    });
    const compareId = nodes()[0]?.nodeId ?? "";

    insertPaletteEntry(entryFor("core.value.numberLiteral"), {
      centerOn: { x: 0, y: 0 },
      connectFrom: {
        nodeId: compareId,
        portId: "left",
        type: { kind: "number" },
        portKind: "data",
        direction: "input",
      },
    });

    expect(edges()[0]).toMatchObject({
      sourcePortId: "value",
      targetNodeId: compareId,
      targetPortId: "left",
    });
  });

  it("connects an incoming execution path to the capture at the front of a click bundle", () => {
    insertPaletteEntry(entryFor("core.flow.start"), {
      centerOn: { x: 0, y: 0 },
    });
    const startId = nodes()[0]?.nodeId ?? "";

    const outcome = insertPaletteEntry(entryFor("automation.clickPoint"), {
      centerOn: { x: 800, y: 0 },
      connectFrom: {
        nodeId: startId,
        portId: "next",
        type: { kind: "exec" },
        portKind: "execution",
        direction: "output",
      },
    });

    expect(outcome.ok).toBe(true);
    const capture = nodes().find(
      (node) => node.typeKey === "automation.captureScreen",
    );
    const click = nodes().find(
      (node) => node.typeKey === "automation.clickPoint",
    );
    expect(edges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: startId,
          sourcePortId: "next",
          targetNodeId: capture?.nodeId,
          targetPortId: "run",
        }),
        expect.objectContaining({
          sourceNodeId: capture?.nodeId,
          sourcePortId: "next",
          targetNodeId: click?.nodeId,
          targetPortId: "run",
        }),
      ]),
    );
  });

  it("adds the execution edge when a boolean recognition result creates a branch", () => {
    insertPaletteEntry(entryFor("vision.ocr"), {
      centerOn: { x: 0, y: 0 },
    });
    const recognitionId = nodes()[0]?.nodeId ?? "";

    const outcome = insertPaletteEntry(entryFor("core.logic.branch"), {
      centerOn: { x: 400, y: 0 },
      connectFrom: {
        nodeId: recognitionId,
        portId: "matched",
        type: { kind: "bool" },
        portKind: "data",
        direction: "output",
      },
      companionExecutionFrom: {
        nodeId: recognitionId,
        portId: "next",
      },
    });

    expect(outcome.ok).toBe(true);
    const branchId = outcome.ok ? outcome.nodeId : undefined;
    expect(edges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeKind: "data",
          sourceNodeId: recognitionId,
          sourcePortId: "matched",
          targetNodeId: branchId,
          targetPortId: "condition",
        }),
        expect.objectContaining({
          edgeKind: "execution",
          sourceNodeId: recognitionId,
          sourcePortId: "next",
          targetNodeId: branchId,
          targetPortId: "run",
        }),
      ]),
    );
  });

  it("connects a click result to both the branch condition and execution input", () => {
    const pointEntry = entryFor("core.geometry.point");
    insertPaletteEntry(pointEntry, { centerOn: { x: 0, y: 200 } });
    const pointId = nodes()[0]?.nodeId ?? "";
    const clickOutcome = insertPaletteEntry(entryFor("automation.clickPoint"), {
      centerOn: { x: 300, y: 0 },
      connectFrom: {
        nodeId: pointId,
        portId: "point",
        type: { kind: "point" },
        portKind: "data",
        direction: "output",
      },
    });
    const clickId = clickOutcome.ok ? (clickOutcome.nodeId ?? "") : "";

    const branchOutcome = insertPaletteEntry(entryFor("core.logic.branch"), {
      centerOn: { x: 620, y: 0 },
      connectFrom: {
        nodeId: clickId,
        portId: "clicked",
        type: { kind: "bool" },
        portKind: "data",
        direction: "output",
      },
      companionExecutionFrom: { nodeId: clickId, portId: "next" },
    });

    expect(branchOutcome.ok).toBe(true);
    const branchId = branchOutcome.ok ? branchOutcome.nodeId : undefined;
    expect(edges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: clickId,
          sourcePortId: "clicked",
          targetNodeId: branchId,
          targetPortId: "condition",
        }),
        expect.objectContaining({
          edgeKind: "execution",
          sourceNodeId: clickId,
          sourcePortId: "next",
          targetNodeId: branchId,
          targetPortId: "run",
        }),
      ]),
    );
  });
});

describe("inserting variable nodes", () => {
  beforeEach(() => {
    useRegistryStore
      .getState()
      .installSnapshot(variableRegistry, "development");
  });

  it("creates and binds one variable for every typed getter and setter", () => {
    for (const [suffix] of VARIABLE_NODE_KINDS) {
      insertPaletteEntry(variableEntryFor(`core.variable.get${suffix}`), {
        centerOn: { x: 200, y: 120 },
      });
      insertPaletteEntry(variableEntryFor(`core.variable.set${suffix}`), {
        centerOn: { x: 480, y: 120 },
      });
    }

    const document = currentDocument();
    expect(document.graphs[0]?.nodes).toHaveLength(12);
    expect(document.variables).toHaveLength(6);
    for (const node of document.graphs[0]?.nodes ?? []) {
      expect(node.properties["variableId"]).toBeDefined();
      expect(
        document.variables?.some(
          (variable) => variable.variableId === node.properties["variableId"],
        ),
      ).toBe(true);
    }
  });

  it("reuses the first authored variable of the matching kind", () => {
    const variableId = "feed0000-0000-4000-8000-000000000099";
    const setResult = useDocumentStore
      .getState()
      .runCommand("graph.history.setVariables", {
        kind: "setProjectVariables",
        variables: [
          {
            variableId,
            name: "existingNumber",
            valueKind: "number",
            persistent: false,
          },
        ],
      });
    expect(setResult.ok).toBe(true);

    const outcome = insertPaletteEntry(
      variableEntryFor("core.variable.getNumber"),
      {
        centerOn: { x: 200, y: 120 },
      },
    );
    expect(outcome.ok).toBe(true);
    expect(nodes()[0]?.properties["variableId"]).toBe(variableId);
    expect(currentDocument().variables).toHaveLength(1);
  });

  it("undoes a newly created variable and its node as one change", () => {
    const before = currentDocument();
    const outcome = insertPaletteEntry(
      variableEntryFor("core.variable.getBool"),
      {
        centerOn: { x: 200, y: 120 },
      },
    );
    expect(outcome.ok).toBe(true);
    expect(currentDocument().variables).toHaveLength(1);

    useDocumentStore.getState().undoChange();
    expect(currentDocument()).toEqual(before);
    expect(Object.hasOwn(currentDocument().graphs[0] ?? {}, "variables")).toBe(
      false,
    );
  });

  it("uses typed connection-drop direction for getters and setters", () => {
    insertPaletteEntry(entryFor("core.value.numberLiteral"), {
      centerOn: { x: 0, y: 0 },
    });
    const literalId = nodes()[0]?.nodeId ?? "";
    const setter = insertPaletteEntry(
      variableEntryFor("core.variable.setNumber"),
      {
        centerOn: { x: 280, y: 0 },
        connectFrom: {
          nodeId: literalId,
          portId: "value",
          type: { kind: "number" },
          portKind: "data",
          direction: "output",
        },
      },
    );
    expect(setter.ok).toBe(true);
    expect(edges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetNodeId: setter.ok ? setter.nodeId : undefined,
          targetPortId: "value",
        }),
      ]),
    );

    const compare = insertPaletteEntry(entryFor("core.logic.numberCompare"), {
      centerOn: { x: 600, y: 0 },
    });
    expect(compare.ok).toBe(true);
    const getter = insertPaletteEntry(
      variableEntryFor("core.variable.getNumber"),
      {
        centerOn: { x: 880, y: 0 },
        connectFrom: {
          nodeId: compare.ok ? (compare.nodeId ?? "") : "",
          portId: "left",
          type: { kind: "number" },
          portKind: "data",
          direction: "input",
        },
      },
    );
    expect(getter.ok).toBe(true);
    expect(edges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: getter.ok ? getter.nodeId : undefined,
          sourcePortId: "value",
          targetPortId: "left",
        }),
      ]),
    );
  });
});

describe("inserting a project screenshot", () => {
  it("creates a project image node already bound to the dragged asset", () => {
    const assetId = "2d87a2f4-37d0-46e8-9f44-1f2db9f97e71";
    useDocumentStore.getState().runCommand("graph.history.insertNode", {
      kind: "addAsset",
      asset: {
        assetId,
        displayName: "capture-001",
        contentHash: "a".repeat(64),
        mediaType: "image/png",
        byteLength: 128,
        coordinateSpace: { spaceId: "capture-space", width: 1280, height: 720 },
        sourceKind: "regionCapture",
        createdAt: "2026-07-29T12:00:00.000Z",
      },
    });

    const outcome = insertImageAssetNode(assetId, {
      origin: { x: 80, y: 96 },
    });

    expect(outcome.ok).toBe(true);
    expect(nodes()[0]).toMatchObject({
      typeKey: "core.image.projectAsset",
      position: { x: 80, y: 96 },
      properties: { assetId },
    });
  });
});

describe("inserting a workflow template", () => {
  it("expands into ordinary nodes the registry defines and nothing else", () => {
    const outcome = insertPaletteEntry(
      entryFor("template.recognizeNumberAndBranch"),
      { centerOn: { x: 200, y: 200 } },
    );

    expect(outcome.ok).toBe(true);

    const document = currentDocument();
    const definedTypeKeys = new Set(
      registry.definitions.map((definition) => definition.typeKey),
    );
    const expanded = document.graphs[0]?.nodes ?? [];

    expect(expanded).toHaveLength(8);
    for (const node of expanded) {
      // Every node is a normal registry node; the expansion introduces no runtime
      // construct of its own.
      expect(definedTypeKeys.has(node.typeKey)).toBe(true);
    }
    // The template key survives nowhere in the saved document, so a template is
    // authoring assistance rather than a hidden grouping the runtime would have to know.
    expect(JSON.stringify(document)).not.toContain(
      "template.recognizeNumberAndBranch",
    );
    expect(isValidProjectDocument(document)).toBe(true);
  });

  it("leaves only the diagnostics the user still has to resolve", () => {
    insertPaletteEntry(entryFor("template.recognizeNumberAndBranch"), {
      centerOn: { x: 200, y: 200 },
    });

    const report = validateProjectDocument(currentDocument(), registry);

    // The template deliberately exposes its run port instead of inserting a second
    // entry node; an unconnected insertion therefore reports a missing graph entry.
    expect(new Set(report.diagnostics.map((item) => item.code))).toEqual(
      new Set(["GRAPH_ENTRY_NODE_MISSING"]),
    );
  });

  it("connects an execution output to the template's exposed run port", () => {
    insertPaletteEntry(entryFor("core.flow.start"), {
      centerOn: { x: 0, y: 0 },
    });
    const startId = nodes()[0]?.nodeId ?? "";

    const outcome = insertPaletteEntry(
      entryFor("template.recognizeNumberAndBranch"),
      {
        centerOn: { x: 400, y: 0 },
        connectFrom: {
          nodeId: startId,
          portId: "next",
          type: { kind: "exec" },
          portKind: "execution",
          direction: "output",
        },
      },
    );

    expect(outcome.ok).toBe(true);
    const capture = nodes().find(
      (node) => node.typeKey === "automation.captureScreen",
    );
    expect(edges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: startId,
          sourcePortId: "next",
          targetNodeId: capture?.nodeId,
          targetPortId: "run",
        }),
      ]),
    );
  });

  it("is undone as a single step", () => {
    const before = currentDocument();

    insertPaletteEntry(entryFor("template.recognizeNumberAndBranch"), {
      centerOn: { x: 200, y: 200 },
    });
    useDocumentStore.getState().undoChange();

    expect(currentDocument()).toEqual(before);
  });
});
