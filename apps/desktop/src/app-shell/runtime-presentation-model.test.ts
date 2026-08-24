import type { GraphV1, RinoNodeRegistrySnapshotV1 } from "@rino/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { applicationI18n } from "../localization/i18n";
import {
  buildNodeNameIndex,
  getResolvedNodeName,
  resolveNodeName,
} from "./runtime-presentation-model";

const GRAPH_ID = "graph-101";
const NODE_1 = "node-101-aaaa-bbbb";
const NODE_2 = "node-102-cccc-dddd";
const NODE_3 = "node-103-eeee-ffff";

const TEST_GRAPH: GraphV1 = {
  graphId: GRAPH_ID,
  kind: "entry",
  name: "测试图",
  nodes: [
    {
      nodeId: NODE_1,
      typeKey: "core.logic.numberCompare",
      typeVersion: 1,
      position: { x: 0, y: 0 },
      properties: {},
      inputValues: {},
    },
    {
      nodeId: NODE_2,
      typeKey: "core.logic.branch",
      typeVersion: 1,
      position: { x: 100, y: 0 },
      properties: {},
      inputValues: {},
      displayAlias: "条件判断节点",
    },
    {
      nodeId: NODE_3,
      typeKey: "custom.unknown.type",
      typeVersion: 1,
      position: { x: 200, y: 0 },
      properties: {},
      inputValues: {},
    },
  ],
  edges: [],
};

const TEST_REGISTRY: RinoNodeRegistrySnapshotV1 = {
  schemaVersion: 1,
  registryVersion: "test-v1",
  definitions: [
    {
      typeKey: "core.logic.numberCompare",
      typeVersion: 1,
      category: "logic",
      titleKey: "node.core.logic.numberCompare.title",
      descriptionKey: "node.core.logic.numberCompare.description",
      iconKey: "category.logic",
      runtimeKind: "pure",
      sideEffect: "none",
      ports: [],
    },
    {
      typeKey: "core.logic.branch",
      typeVersion: 1,
      category: "logic",
      titleKey: "node.core.logic.branch.title",
      descriptionKey: "node.core.logic.branch.description",
      iconKey: "category.logic",
      runtimeKind: "pure",
      sideEffect: "none",
      ports: [],
    },
  ],
};

describe("runtime presentation model node-name resolution", () => {
  beforeEach(async () => {
    await applicationI18n.changeLanguage("zh-CN");
  });

  it("resolves registry title and bilingual secondary title when no alias is set", () => {
    const t = applicationI18n.t;
    const resolved = resolveNodeName(
      TEST_GRAPH,
      NODE_1,
      TEST_REGISTRY,
      t,
      applicationI18n,
      "zh-CN",
    );

    expect(resolved.isAvailable).toBe(true);
    expect(resolved.title).toBe("数值比较");
    expect(resolved.secondaryTitle).toBe("Compare numbers");
    expect(resolved.displayAlias).toBeUndefined();
    expect(resolved.typeKey).toBe("core.logic.numberCompare");
    expect(resolved.shortNodeId).toBe("node-101");
  });

  it("prefers displayAlias as primary title and moves registry title to secondaryTitle", () => {
    const t = applicationI18n.t;
    const resolved = resolveNodeName(
      TEST_GRAPH,
      NODE_2,
      TEST_REGISTRY,
      t,
      applicationI18n,
      "zh-CN",
    );

    expect(resolved.isAvailable).toBe(true);
    expect(resolved.title).toBe("条件判断节点");
    expect(resolved.secondaryTitle).toBe("判断分支");
    expect(resolved.displayAlias).toBe("条件判断节点");
    expect(resolved.typeKey).toBe("core.logic.branch");
  });

  it("falls back gracefully when the node type is un-registered or unknown", () => {
    const t = applicationI18n.t;
    const resolved = resolveNodeName(
      TEST_GRAPH,
      NODE_3,
      TEST_REGISTRY,
      t,
      applicationI18n,
      "zh-CN",
    );

    expect(resolved.isAvailable).toBe(true);
    expect(resolved.title).toContain("custom.unknown.type");
    expect(resolved.typeKey).toBe("custom.unknown.type");
  });

  it("returns unknown node representation when node is missing from graph", () => {
    const t = applicationI18n.t;
    const missingNodeId = "node-missing-99999";
    const resolved = resolveNodeName(
      TEST_GRAPH,
      missingNodeId,
      TEST_REGISTRY,
      t,
      applicationI18n,
      "zh-CN",
    );

    expect(resolved.isAvailable).toBe(false);
    expect(resolved.title).toBe("未知节点 (node-mis)");
    expect(resolved.shortNodeId).toBe("node-mis");
  });

  it("builds a fast node name index for the whole graph", () => {
    const t = applicationI18n.t;
    const index = buildNodeNameIndex(
      TEST_GRAPH,
      TEST_REGISTRY,
      t,
      applicationI18n,
      "zh-CN",
    );

    expect(index.size).toBe(3);
    const n1 = getResolvedNodeName(index, NODE_1, t);
    expect(n1.title).toBe("数值比较");

    const missing = getResolvedNodeName(index, "non-existent", t);
    expect(missing.isAvailable).toBe(false);
    expect(missing.title).toBe("未知节点 (non-exis)");
  });
});
