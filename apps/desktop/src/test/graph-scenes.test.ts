import { isValidProjectDocument } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import { developmentRegistrySnapshot } from "../graph/registry/development-registry";
import { validateProjectDocument } from "../graph/validate-graph";
import {
  buildGraphScene,
  expectedSceneSize,
  sceneDigest,
  type GraphSceneName,
} from "./graph-scenes";

const SCENES: readonly GraphSceneName[] = ["small", "reference", "stress"];

/** Recorded so a scene cannot drift without the change being visible in a diff. A
 * measurement quoted against one of these digests describes a known graph. */
const EXPECTED_DIGESTS: Record<GraphSceneName, string> = {
  small: "f9baa5b9",
  reference: "177bb2f1",
  stress: "96449b80",
};

describe("performance scenes", () => {
  it("matches the node and edge totals the performance plan names", () => {
    expect(
      SCENES.map((name) => {
        const scene = buildGraphScene(name);
        return { name, nodes: scene.nodeCount, edges: scene.edgeCount };
      }),
    ).toEqual([
      { name: "small", nodes: 100, edges: 150 },
      { name: "reference", nodes: 500, edges: 750 },
      { name: "stress", nodes: 1000, edges: 1500 },
    ]);
    expect(expectedSceneSize.reference).toEqual({ nodes: 500, edges: 750 });
  });

  it("produces documents the persisted format and the validator both accept", () => {
    const registry = developmentRegistrySnapshot();
    for (const name of SCENES) {
      const scene = buildGraphScene(name);
      expect(isValidProjectDocument(scene.document)).toBe(true);
      // A scene used to measure editing must not also be measuring the cost of drawing a
      // thousand diagnostics, so every required input is wired.
      const report = validateProjectDocument(scene.document, registry);
      expect(report.diagnostics).toEqual([]);
      expect(report.executable).toBe(true);
    }
  });

  it("rebuilds byte-identically, so two measurements describe the same graph", () => {
    for (const name of SCENES) {
      const first = buildGraphScene(name);
      const second = buildGraphScene(name);
      expect(JSON.stringify(first.document)).toBe(
        JSON.stringify(second.document),
      );
      expect(sceneDigest(first)).toBe(EXPECTED_DIGESTS[name]);
    }
  });

  it("gives every node and edge a distinct identifier", () => {
    for (const name of SCENES) {
      const scene = buildGraphScene(name);
      expect(new Set(scene.graph.nodes.map((node) => node.nodeId)).size).toBe(
        scene.nodeCount,
      );
      expect(new Set(scene.graph.edges.map((edge) => edge.edgeId)).size).toBe(
        scene.edgeCount,
      );
    }
  });
});
