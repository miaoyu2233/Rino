import type {
  EdgeV1,
  GraphV1,
  NodeV1,
  RinoProjectDocumentV1,
} from "@rino/contracts";
import type { TFunction } from "i18next";

import { translateDataKey } from "../../localization/data-keys";
import type { NodeRegistryIndex } from "../node-registry-index";
import type { GraphProblem } from "./problem-model";

/** One step of the breadcrumb that says where a problem is.
 *
 * The pieces stay separate rather than being joined into a sentence, so a translation is
 * never assembled from fragments and the interface can lay them out per locale.
 */
export interface ProblemSubjectPiece {
  key: string;
  text: string;
}

/** The document, arranged for repeated lookup by identifier.
 *
 * A panel listing a thousand problems asks for a graph, a node, and an edge by identifier
 * once per row. Searching the arrays each time is quadratic in a large broken graph, which
 * is what a project with nothing wired up produces, so the arrangement is built once per
 * document and reused for every row.
 */
export interface ProblemSubjectIndex {
  graphs: ReadonlyMap<string, IndexedGraph>;
}

interface IndexedGraph {
  graph: GraphV1;
  nodes: ReadonlyMap<string, NodeV1>;
  edges: ReadonlyMap<string, EdgeV1>;
}

export function indexDocumentForSubjects(
  document: RinoProjectDocumentV1,
): ProblemSubjectIndex {
  const graphs = new Map<string, IndexedGraph>();
  for (const graph of document.graphs) {
    graphs.set(graph.graphId, {
      graph,
      nodes: new Map(graph.nodes.map((node) => [node.nodeId, node])),
      edges: new Map(graph.edges.map((edge) => [edge.edgeId, edge])),
    });
  }
  return { graphs };
}

/** What a node is called in the interface: the user's own alias when they set one, the
 * definition's localized title otherwise, and the raw type key when the registry has no
 * definition for it. */
function nodeTitle(
  graph: IndexedGraph | undefined,
  nodeId: string,
  registry: NodeRegistryIndex,
  translate: TFunction,
): string {
  const node = graph?.nodes.get(nodeId);
  if (!node) {
    return translate("graph.problems.subject.missingNode");
  }
  if (node.displayAlias !== undefined && node.displayAlias.length > 0) {
    return node.displayAlias;
  }
  const definition = registry.find(node.typeKey);
  return definition
    ? translateDataKey(translate, definition.definition.titleKey, node.typeKey)
    : node.typeKey;
}

function portLabel(
  graph: IndexedGraph | undefined,
  nodeId: string,
  portId: string,
  registry: NodeRegistryIndex,
  translate: TFunction,
): string {
  const node = graph?.nodes.get(nodeId);
  const port = node
    ? registry.find(node.typeKey)?.ports.get(portId)
    : undefined;
  return port ? translateDataKey(translate, port.labelKey, portId) : portId;
}

/** Describes the element a problem is attached to, in document terms. */
export function describeProblemSubject(
  problem: GraphProblem,
  index: ProblemSubjectIndex,
  registry: NodeRegistryIndex,
  translate: TFunction,
): ProblemSubjectPiece[] {
  const location = problem.location;
  if (location.scope === "document") {
    return [
      { key: "document", text: translate("graph.problems.subject.document") },
    ];
  }
  if (location.scope === "asset") {
    return [{ key: "asset", text: translate("graph.problems.subject.asset") }];
  }

  const graph = index.graphs.get(location.graphId);
  const pieces: ProblemSubjectPiece[] = [
    {
      key: "graph",
      text:
        graph?.graph.name ?? translate("graph.problems.subject.missingGraph"),
    },
  ];

  if (location.scope === "node" || location.scope === "port") {
    pieces.push({
      key: "node",
      text: nodeTitle(graph, location.nodeId, registry, translate),
    });
  }
  if (location.scope === "port") {
    pieces.push({
      key: "port",
      text: portLabel(
        graph,
        location.nodeId,
        location.portId,
        registry,
        translate,
      ),
    });
  }
  if (location.scope === "edge") {
    const edge = graph?.edges.get(location.edgeId);
    pieces.push({
      key: "edgeSource",
      text: edge
        ? nodeTitle(graph, edge.sourceNodeId, registry, translate)
        : translate("graph.problems.subject.missingEdge"),
    });
    if (edge) {
      pieces.push({
        key: "edgeTarget",
        text: nodeTitle(graph, edge.targetNodeId, registry, translate),
      });
    }
  }

  return pieces;
}
