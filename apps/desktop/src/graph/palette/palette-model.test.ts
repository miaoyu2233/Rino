import type { RinoNodeRegistrySnapshotV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import coreDefinitions from "../../../../../contracts/fixtures/registry/valid/core-definitions.json";
import {
  buildPaletteEntries,
  capabilityState,
  filterConnectable,
  findConnectablePort,
  groupPaletteEntries,
  normalizeSearchTerm,
  prioritizePaletteEntries,
  recommendConnectionTargets,
  searchPalette,
  type PaletteEntry,
  type PaletteEntryText,
} from "./palette-model";
import {
  VARIABLE_NODE_TYPE_KEYS,
  variableValueKindForNodeTypeKey,
} from "../variables/variable-authoring";

const registry = coreDefinitions as unknown as RinoNodeRegistrySnapshotV1;
const readValueRegistry = registry;
const entries = buildPaletteEntries(readValueRegistry);

function variableDefinition(typeKey: string) {
  const valueKind = variableValueKindForNodeTypeKey(typeKey);
  if (valueKind === undefined) {
    throw new Error(`The variable fixture must define ${typeKey}.`);
  }
  const setter = typeKey.startsWith("core.variable.set");
  return {
    typeKey,
    typeVersion: 1,
    runtimeKind: setter ? "execution" : "pure",
    sideEffect: setter ? "runtime" : "none",
    category: "values",
    titleKey: `${typeKey}.title`,
    descriptionKey: `${typeKey}.description`,
    iconKey: "node.variable",
    ports: setter
      ? [
          {
            portId: "run",
            direction: "input",
            portKind: "execution",
            type: { kind: "exec" },
            labelKey: `${typeKey}.port.run`,
          },
          {
            portId: "value",
            direction: "input",
            portKind: "data",
            type: { kind: valueKind },
            labelKey: `${typeKey}.port.value`,
            required: true,
          },
          {
            portId: "storedValue",
            direction: "output",
            portKind: "data",
            type: { kind: valueKind },
            labelKey: `${typeKey}.port.storedValue`,
          },
          {
            portId: "next",
            direction: "output",
            portKind: "execution",
            type: { kind: "exec" },
            labelKey: `${typeKey}.port.next`,
          },
        ]
      : [
          {
            portId: "value",
            direction: "output",
            portKind: "data",
            type: { kind: valueKind },
            labelKey: `${typeKey}.port.value`,
          },
        ],
  };
}

const variableRegistry = {
  ...readValueRegistry,
  definitions: [
    ...readValueRegistry.definitions,
    ...VARIABLE_NODE_TYPE_KEYS.map(variableDefinition),
  ],
} as unknown as RinoNodeRegistrySnapshotV1;

/** Stands in for the localization boundary, returning both display languages the way the
 * palette does at run time. */
const text: Record<string, PaletteEntryText> = {
  "core.flow.endPath": {
    titles: ["结束路径", "End path"],
    keywords: ["结束", "路径", "end", "path"],
    descriptions: ["结束当前或全部执行路径", "Ends one or all execution paths"],
  },
  "core.flow.start": {
    titles: ["开始", "Start"],
    keywords: [],
    descriptions: ["图的执行入口", "The graph's execution entry point"],
  },
  "core.logic.numberCompare": {
    titles: ["数值比较", "Compare numbers"],
    keywords: ["大于 小于 等于 比较", "greater less equal compare"],
    descriptions: ["比较两个数值", "Compares two numbers"],
  },
  "core.logic.branch": {
    titles: ["判断分支", "Judgment Branch"],
    keywords: ["判断", "分支", "judgment", "branch"],
    descriptions: ["根据条件选择分支", "Chooses a branch from a condition"],
  },
  "core.flow.sequenceOrder": {
    titles: ["更换执行顺序", "Execution Order"],
    keywords: ["执行顺序", "顺序", "execution", "order"],
    descriptions: [
      "输出已编排的顺序执行步骤列表。",
      "Outputs an authored order for sequence steps.",
    ],
  },
  "core.value.numberLiteral": {
    titles: ["数字常量", "Number"],
    keywords: [],
    descriptions: ["输出一个固定的数值", "Outputs a fixed numeric value"],
  },
  "template.textRecognition": {
    titles: ["文字识别", "Recognize text"],
    keywords: ["OCR", "ocr"],
    descriptions: ["识别文字", "Recognizes text"],
  },
};

function lookup(entry: PaletteEntry): PaletteEntryText {
  return (
    text[entry.key] ?? { titles: [entry.key], keywords: [], descriptions: [] }
  );
}

function entryFor(key: string): PaletteEntry {
  const entry = entries.find((candidate) => candidate.key === key);
  if (!entry) {
    throw new Error(`The fixture must define ${key}.`);
  }
  return entry;
}

describe("palette entries", () => {
  it("carries every node definition with its category and ports", () => {
    const compare = entryFor("core.logic.numberCompare");

    expect(compare.kind).toBe("node");
    expect(compare.category).toBe("logic");
    expect(compare.ports).toHaveLength(4);
    expect(compare.requiredCapabilities).toEqual([]);
  });

  it("records the capabilities a node needs", () => {
    expect(entryFor("template.textRecognition").requiredCapabilities).toEqual([
      "automation.captureScreen",
      "vision.ocr",
    ]);
  });

  it("adds workflow templates in their own category with the union of node capabilities", () => {
    const template = entryFor("template.recognizeNumberAndBranch");

    expect(template.kind).toBe("template");
    expect(template.category).toBe("templates");
    expect(template.ports).toEqual([]);
    expect(template.requiredCapabilities).toEqual([
      "automation.captureScreen",
      "vision.ocr",
    ]);
    expect(
      template.templatePorts?.map((port) => [port.proxyPortId, port.portId]),
    ).toEqual([
      ["run", "run"],
      ["next", "whenTrue"],
    ]);
  });

  it("shows integrated recognition workflows while hiding low-level vision nodes", () => {
    const groupedRegistry: RinoNodeRegistrySnapshotV1 = {
      ...registry,
      workflowTemplates: [
        ...(registry.workflowTemplates ?? []),
        {
          templateKey: "template.textRecognition",
          titleKey: "workflowGroup.textRecognition.title",
          descriptionKey: "workflowGroup.textRecognition.description",
          iconKey: "node.ocr",
          nodes: [
            {
              placeholderId: "recognizer",
              typeKey: "vision.ocr",
              offset: { x: 0, y: 0 },
            },
          ],
          workflowGroup: {
            kind: "textRecognition",
            members: [{ role: "recognizer", placeholderId: "recognizer" }],
            exposedPorts: [],
          },
        },
      ],
    };
    const groups = groupPaletteEntries(buildPaletteEntries(groupedRegistry));
    const common = groups.find((group) => group.category === "common");
    const vision = groups.find((group) => group.category === "vision");

    expect(common?.entries[0]?.key).toBe("template.imageRecognition");
    expect(vision?.entries.slice(0, 2).map((entry) => entry.key)).toEqual([
      "template.imageRecognition",
      "template.textRecognition",
    ]);
    const visibleKeys = vision?.entries.map((entry) => entry.key);
    expect(visibleKeys).not.toContain("vision.ocr");
    expect(visibleKeys).not.toContain("vision.templateMatch");
    expect(visibleKeys).not.toContain("vision.featureMatch");
    expect(visibleKeys).not.toContain("vision.colorMatch");
  });

  it("keeps project-image parameter nodes out of the ordinary node library", () => {
    const source = registry.definitions.find(
      (definition) => definition.typeKey === "core.value.numberLiteral",
    );
    if (source === undefined) {
      throw new Error("The registry fixture must define a number literal.");
    }
    const withInternalParameter: RinoNodeRegistrySnapshotV1 = {
      ...registry,
      definitions: [
        ...registry.definitions,
        {
          ...source,
          typeKey: "core.image.projectAsset",
          titleKey: "node.core.image.projectAsset.title",
          descriptionKey: "node.core.image.projectAsset.description",
        },
      ],
    };

    expect(
      buildPaletteEntries(withInternalParameter).some(
        (entry) => entry.key === "core.image.projectAsset",
      ),
    ).toBe(false);
  });

  it("hides rectangle-center compatibility nodes but keeps touch actions available", () => {
    const source = registry.definitions.find(
      (definition) => definition.typeKey === "automation.swipe",
    );
    if (source === undefined) {
      throw new Error("The registry fixture must define a swipe node.");
    }
    const rectCenter = registry.definitions.find(
      (definition) => definition.typeKey === "automation.clickRectCenter",
    );
    if (rectCenter === undefined) {
      throw new Error(
        "The registry fixture must define a rectangle-center node.",
      );
    }
    const withLegacyCompound: RinoNodeRegistrySnapshotV1 = {
      ...registry,
      definitions: [
        ...registry.definitions,
        { ...source, typeKey: "automation.touchAction" },
        { ...rectCenter, typeKey: "automation.clickRectCenter" },
      ],
    };

    expect(
      buildPaletteEntries(withLegacyCompound).some(
        (entry) => entry.key === "automation.touchAction",
      ),
    ).toBe(true);
    expect(
      buildPaletteEntries(withLegacyCompound).some(
        (entry) => entry.key === "automation.clickRectCenter",
      ),
    ).toBe(false);
    expect(entries.map((entry) => entry.key)).toEqual(
      expect.arrayContaining([
        "automation.launchAndroidApp",
        "automation.pressAndroidKey",
        "automation.swipe",
      ]),
    );
  });

  it("shows the configurable end-path node and hides the legacy stop node", () => {
    const keys = entries.map((entry) => entry.key);

    expect(keys).toContain("core.flow.endPath");
    expect(keys).not.toContain("core.flow.stop");
    expect(
      readValueRegistry.definitions.map((definition) => definition.typeKey),
    ).toEqual(expect.arrayContaining(["core.flow.endPath", "core.flow.stop"]));
  });

  it("keeps task-choice value overlays out of the node library", () => {
    const keys = entries.map((entry) => entry.key);

    expect(keys).not.toContain("core.logic.caseOverlayBool");
    expect(keys).not.toContain("core.logic.caseOverlayImageRef");
    expect(keys).not.toContain("core.logic.caseOverlayNumber");
    expect(
      readValueRegistry.definitions.map((definition) => definition.typeKey),
    ).toEqual(
      expect.arrayContaining([
        "core.logic.caseOverlayBool",
        "core.logic.caseOverlayImageRef",
        "core.logic.caseOverlayNumber",
      ]),
    );
  });

  it("shows output value while hiding legacy read nodes from the palette", () => {
    const keys = entries.map((entry) => entry.key);

    expect(keys).toContain("text.readValue");
    expect(keys).not.toContain("text.readText");
    expect(keys).not.toContain("text.readNumber");
    expect(
      readValueRegistry.definitions.map((definition) => definition.typeKey),
    ).toEqual(expect.arrayContaining(["text.readText", "text.readNumber"]));
  });

  it("hides typed variable nodes and generic function calls from palette entries", () => {
    const genericSource = registry.definitions.find(
      (definition) => definition.typeKey === "core.flow.start",
    );
    if (genericSource === undefined) {
      throw new Error("The registry fixture must define the start node.");
    }
    const withHiddenNodes: RinoNodeRegistrySnapshotV1 = {
      ...variableRegistry,
      definitions: [
        ...variableRegistry.definitions,
        { ...genericSource, typeKey: "core.function.call" },
      ],
    };
    const keys = buildPaletteEntries(withHiddenNodes).map((entry) => entry.key);

    expect(keys.some((key) => key.startsWith("core.variable."))).toBe(false);
    expect(keys).not.toContain("core.function.call");
  });
});

describe("search", () => {
  it("finds the execution-order configuration node by localized names", () => {
    expect(searchPalette(entries, lookup, "更换执行顺序")[0]?.key).toBe(
      "core.flow.sequenceOrder",
    );
    expect(searchPalette(entries, lookup, "execution order")[0]?.key).toBe(
      "core.flow.sequenceOrder",
    );
  });

  it("finds end path and judgment branch by their localized names", () => {
    expect(searchPalette(entries, lookup, "结束路径")[0]?.key).toBe(
      "core.flow.endPath",
    );
    expect(searchPalette(entries, lookup, "judgment")[0]?.key).toBe(
      "core.logic.branch",
    );
  });

  it("finds a node by its Chinese title while the query is Chinese", () => {
    const results = searchPalette(entries, lookup, "数值比较");

    expect(results[0]?.key).toBe("core.logic.numberCompare");
  });

  it("finds the same node by its English title", () => {
    const results = searchPalette(entries, lookup, "compare");

    expect(results[0]?.key).toBe("core.logic.numberCompare");
  });

  it("finds a node by a keyword in either language", () => {
    expect(searchPalette(entries, lookup, "大于")[0]?.key).toBe(
      "core.logic.numberCompare",
    );
    expect(searchPalette(entries, lookup, "greater")[0]?.key).toBe(
      "core.logic.numberCompare",
    );
  });

  it("finds a node by its technical type key", () => {
    expect(
      searchPalette(entries, lookup, "template.textRecognition")[0]?.key,
    ).toBe("template.textRecognition");
  });

  it("ranks a title match above a description mention", () => {
    const results = searchPalette(entries, lookup, "数值");
    const ranked = results.map((entry) => entry.key);

    // 数值比较 has it in the title; 数字常量 only in its description.
    expect(ranked.indexOf("core.logic.numberCompare")).toBeLessThan(
      ranked.indexOf("core.value.numberLiteral"),
    );
  });

  it("keeps every entry for an empty query and returns none for an unmatched one", () => {
    expect(searchPalette(entries, lookup, "   ")).toHaveLength(entries.length);
    expect(searchPalette(entries, lookup, "不存在的节点")).toEqual([]);
  });

  it("normalizes width and case so a full-width or capitalized query still matches", () => {
    expect(normalizeSearchTerm("　ＯＣＲ ")).toBe("ocr");
    expect(searchPalette(entries, lookup, "ＯＣＲ")[0]?.key).toBe(
      "template.textRecognition",
    );
  });
});

describe("grouping", () => {
  it("puts common authoring entries first and templates last", () => {
    const boundedRetry: PaletteEntry = {
      ...entryFor("core.time.delay"),
      key: "core.flow.boundedRetry",
      titleKey: "node.core.flow.boundedRetry.title",
      descriptionKey: "node.core.flow.boundedRetry.description",
    };
    const groups = groupPaletteEntries([...entries, boundedRetry]);
    const common = groups.find((group) => group.category === "common");

    expect(groups.map((group) => group.category)).toEqual([
      "common",
      "flow",
      "logic",
      "values",
      "text",
      "vision",
      "device",
      "timing",
      "diagnostics",
      "templates",
    ]);
    expect(common?.entries.map((entry) => entry.key)).toEqual(
      expect.arrayContaining([
        "core.flow.sequence",
        "core.flow.parallel",
        "core.math.arithmetic",
        "text.readValue",
        "core.flow.boundedRetry",
      ]),
    );
  });

  it("uses the same common-node priority for quick-add candidates", () => {
    const prioritized = prioritizePaletteEntries([
      entryFor("core.logic.numberCompare"),
      entryFor("core.logic.branch"),
      entryFor("template.textRecognition"),
    ]);

    expect(prioritized.map((entry) => entry.key)).toEqual([
      "template.textRecognition",
      "core.logic.branch",
      "core.logic.numberCompare",
    ]);
  });

  it("drops categories no entry uses", () => {
    const groups = groupPaletteEntries([entryFor("core.flow.start")]);

    expect(groups).toEqual([
      { category: "flow", entries: [entryFor("core.flow.start")] },
    ]);
  });
});

describe("capability state", () => {
  it("reports a node needing nothing as satisfied", () => {
    expect(capabilityState(entryFor("core.flow.start"), undefined)).toBe(
      "satisfied",
    );
  });

  it("distinguishes an unknown backend from one that lacks the capability", () => {
    const ocr = entryFor("template.textRecognition");

    expect(capabilityState(ocr, undefined)).toBe("unknown");
    expect(capabilityState(ocr, new Set())).toBe("unavailable");
    expect(
      capabilityState(ocr, new Set(["automation.captureScreen", "vision.ocr"])),
    ).toBe("satisfied");
  });
});

describe("connection-drop candidates", () => {
  it("connects the execution-order collection to a sequence order input", () => {
    const order = entryFor("core.flow.sequenceOrder").ports.find(
      (port) => port.portId === "order",
    );
    if (order === undefined) {
      throw new Error("The execution-order node must expose its order output.");
    }

    const origin = {
      type: order.type,
      portKind: "data" as const,
      direction: "output" as const,
    };
    expect(
      findConnectablePort(entryFor("core.flow.sequence"), origin)?.portId,
    ).toBe("order");
    expect(
      filterConnectable([entryFor("core.flow.sequence")], origin),
    ).toHaveLength(1);
  });

  it("offers only nodes that accept the dragged data type", () => {
    const candidates = filterConnectable(entries, {
      type: { kind: "number" },
      portKind: "data",
      direction: "output",
    });

    expect(candidates.map((entry) => entry.key)).toEqual([
      "automation.clickPoint",
      "core.diagnostic.log",
      "core.flow.runCounter",
      "core.geometry.point",
      "core.geometry.rectangle",
      "core.logic.numberCompare",
      "core.logic.numberSelect",
      "core.math.arithmetic",
      "core.math.expression",
      "core.time.delay",
    ]);
  });

  it("offers producers when the drag started at an input", () => {
    const candidates = filterConnectable(entries, {
      type: { kind: "number" },
      portKind: "data",
      direction: "input",
    });

    expect(candidates.map((entry) => entry.key)).toEqual([
      "template.imageRecognition",
      "template.textRecognition",
      "automation.captureScreen",
      "automation.clickPoint",
      "core.flow.boundedRetry",
      "core.flow.runCounter",
      "core.logic.numberSelect",
      "core.math.arithmetic",
      "core.math.expression",
      "core.value.numberLiteral",
      "text.parseNumber",
      "text.readValue",
    ]);
  });

  it("never offers an execution port for a data drag", () => {
    const candidates = filterConnectable(entries, {
      type: { kind: "exec" },
      portKind: "execution",
      direction: "output",
    });

    expect(candidates.map((entry) => entry.key)).not.toContain(
      "core.value.numberLiteral",
    );
    expect(candidates.map((entry) => entry.key)).toContain("core.logic.branch");
  });

  it("accepts a value into an optional input of the same type", () => {
    const candidates = filterConnectable(entries, {
      type: { kind: "rect" },
      portKind: "data",
      direction: "output",
    });

    expect(candidates.map((entry) => entry.key)).toEqual([
      "automation.clickPoint",
      "core.collection.regionList",
    ]);
    expect(
      findConnectablePort(entryFor("core.collection.regionList"), {
        type: { kind: "rect" },
        portKind: "data",
        direction: "output",
      })?.portId,
    ).toBe("item1");
  });

  it("offers templates only when their registry exposes an explicit endpoint", () => {
    const candidates = filterConnectable(entries, {
      type: { kind: "exec" },
      portKind: "execution",
      direction: "output",
    });

    expect(candidates.map((entry) => entry.key)).toContain(
      "template.recognizeNumberAndBranch",
    );
    expect(candidates.map((entry) => entry.key)).toContain(
      "template.imageRecognition",
    );
    expect(candidates.map((entry) => entry.key)).not.toContain(
      "template.compareNumbersAndBranch",
    );
  });

  it("puts integrated templates first for every execution connection", () => {
    const candidates = filterConnectable(entries, {
      type: { kind: "exec" },
      portKind: "execution",
      direction: "output",
    });

    expect(
      recommendConnectionTargets(candidates, {
        type: { kind: "exec" },
        portKind: "execution",
        direction: "output",
      })
        .slice(0, 3)
        .map((entry) => entry.key),
    ).toEqual([
      "template.imageRecognition",
      "template.textRecognition",
      "template.recognizeNumberAndBranch",
    ]);
  });
});
