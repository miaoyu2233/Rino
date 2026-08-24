import type { GraphV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import {
  buildGraphScene,
  sceneIdentifier,
  type GraphSceneName,
} from "../../test/graph-scenes";
import { applyCommand, type GraphCommand } from "../commands/graph-commands";
import { developmentRegistrySnapshot } from "../registry/development-registry";
import {
  EMPTY_EDGE_ACTIVITY,
  GraphProjection,
  type RinoFlowEdge,
  type RinoFlowNode,
} from "./graph-view-model";

const SCENES: readonly GraphSceneName[] = ["small", "reference", "stress"];

interface ProjectionProbe {
  document: RinoProjectDocumentV1;
  graph: GraphV1;
  project: () => { nodes: RinoFlowNode[]; edges: RinoFlowEdge[] };
  /** Applies a command and reports how many node and edge views the next projection had
   * to rebuild. A rebuilt view is a new object, which is exactly what defeats the memo on
   * the node and edge components. */
  runCommand: (command: GraphCommand) => { nodes: number; edges: number };
}

function createProbe(sceneName: GraphSceneName): ProjectionProbe {
  const scene = buildGraphScene(sceneName);
  const registry = developmentRegistrySnapshot();
  const projection = new GraphProjection();
  let document = scene.document;

  const activeGraph = (): GraphV1 => {
    const graph = document.graphs[0];
    if (graph === undefined) {
      throw new Error("The scene document always holds its entry graph.");
    }
    return graph;
  };

  const project = () => ({
    nodes: projection.projectNodes(activeGraph(), registry),
    edges: projection.projectEdges(
      activeGraph(),
      registry,
      EMPTY_EDGE_ACTIVITY,
    ),
  });

  return {
    document,
    graph: scene.graph,
    project,
    runCommand: (command) => {
      const before = project();
      const beforeNodes = new Set<unknown>(before.nodes);
      const beforeEdges = new Set<unknown>(before.edges);

      const result = applyCommand(document, command);
      if (!result.ok) {
        throw new Error(`The command should have applied: ${result.reason}`);
      }
      document = result.document;

      const after = project();
      return {
        nodes: after.nodes.filter((node) => !beforeNodes.has(node)).length,
        edges: after.edges.filter((edge) => !beforeEdges.has(edge)).length,
      };
    },
  };
}

/** Node identifiers a probe can act on without knowing how a scene is assembled. */
function pick(graph: GraphV1, typeKey: string, occurrence = 0): string {
  const matches = graph.nodes.filter((node) => node.typeKey === typeKey);
  const node = matches[occurrence];
  if (node === undefined) {
    throw new Error(
      `The scene has no ${typeKey} at index ${String(occurrence)}.`,
    );
  }
  return node.nodeId;
}

describe("graph projection cost", () => {
  it.each(SCENES)(
    "rebuilds nothing when the %s scene is re-projected unchanged",
    (sceneName) => {
      const probe = createProbe(sceneName);
      const first = probe.project();
      const second = probe.project();

      expect(second.nodes).toEqual(first.nodes);
      expect(second.edges).toEqual(first.edges);
      for (const [index, node] of second.nodes.entries()) {
        expect(node).toBe(first.nodes[index]);
      }
      for (const [index, edge] of second.edges.entries()) {
        expect(edge).toBe(first.edges[index]);
      }
    },
  );

  it.each(SCENES)(
    "rebuilds one node view when a node moves in the %s scene",
    (sceneName) => {
      const probe = createProbe(sceneName);
      const nodeId = pick(probe.graph, "core.logic.branch");

      expect(
        probe.runCommand({
          kind: "moveNode",
          graphId: probe.graph.graphId,
          nodeId,
          position: { x: 4008, y: 4008 },
        }),
      ).toEqual({ nodes: 1, edges: 0 });
    },
  );

  it.each(SCENES)(
    "rebuilds one node view when a property changes in the %s scene",
    (sceneName) => {
      const probe = createProbe(sceneName);

      expect(
        probe.runCommand({
          kind: "setNodeProperty",
          graphId: probe.graph.graphId,
          nodeId: pick(probe.graph, "core.logic.numberCompare"),
          propertyKey: "operator",
          value: "notEqualTo",
        }),
      ).toEqual({ nodes: 1, edges: 0 });
    },
  );

  it.each(SCENES)(
    "rebuilds only the connected node and the new edge in the %s scene",
    (sceneName) => {
      const probe = createProbe(sceneName);
      // The second comparison of the first unit publishes a result nothing consumes, and
      // the last branch's remaining execution output is free, so this connection is one
      // the editor would accept.
      const source = pick(probe.graph, "core.value.numberLiteral");
      const target = pick(probe.graph, "core.logic.branch", 1);

      expect(
        probe.runCommand({
          kind: "addEdge",
          graphId: probe.graph.graphId,
          edge: {
            edgeId: sceneIdentifier("probe/edge/added"),
            edgeKind: "data",
            sourceNodeId: source,
            sourcePortId: "value",
            targetNodeId: target,
            targetPortId: "condition",
          },
        }),
      ).toEqual({ nodes: 1, edges: 1 });
    },
  );

  it("rebuilds every view when the registry snapshot is replaced", () => {
    const scene = buildGraphScene("reference");
    const projection = new GraphProjection();
    const first = projection.projectNodes(
      scene.graph,
      developmentRegistrySnapshot(),
    );
    // A different snapshot object carrying the same definitions: port views are derived
    // from it, so none of them may survive the replacement.
    const second = projection.projectNodes(
      scene.graph,
      structuredClone(developmentRegistrySnapshot()),
    );

    expect(second).toHaveLength(first.length);
    expect(second.filter((node) => first.includes(node))).toHaveLength(0);
  });

  it("keeps a full projection of the stress scene proportional to its size", () => {
    const stress = createProbe("stress");
    const small = createProbe("small");

    const measure = (probe: ProjectionProbe): number => {
      // One warm pass so the measured pass is not paying for lazy module work.
      probe.project();
      const started = performance.now();
      for (let round = 0; round < 10; round += 1) {
        new GraphProjection().projectNodes(
          probe.graph,
          developmentRegistrySnapshot(),
        );
      }
      return performance.now() - started;
    };

    const smallCost = Math.max(measure(small), 1);
    const stressCost = measure(stress);

    // The stress scene holds ten times the nodes and ten times the edges of the small
    // one, so a projection whose cost follows their sum stays near ten. Scanning every
    // edge once per node put this above twelve before the pass was rewritten and would
    // put it near a hundred at the sizes the persisted format allows. The ceiling is
    // loose because this runs on unknown hardware: it exists to catch a return to
    // per-node edge scanning, not to police a few milliseconds.
    expect(stressCost / smallCost).toBeLessThan(10);
  });
});
