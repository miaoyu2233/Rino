import type {
  GraphDiagnosticV1,
  GraphV1,
  RinoNodeRegistrySnapshotV1,
  RinoProjectDocumentV1,
} from "@rino/contracts";

import {
  assembleValidationReport,
  createDocumentValidator,
  type DocumentValidator,
  type ValidationOptions,
  type ValidationReport,
} from "../validate-graph";
import { FUNCTION_CALL_NODE_TYPE } from "../function-node-semantics";

export interface IncrementalValidation {
  /** Revalidates the document, reusing the diagnostics of graphs the last edit did not
   * touch. The result is identical to a full pass over the same inputs. */
  validate: (
    document: RinoProjectDocumentV1,
    registry: RinoNodeRegistrySnapshotV1,
    options?: ValidationOptions,
  ) => ValidationReport;
}

interface GraphCacheEntry {
  source: GraphV1;
  diagnostics: GraphDiagnosticV1[];
}

/** The identity of the capability set, so a runtime that reports the same capabilities in
 * a different order does not discard every cached graph. */
function capabilitySignature(
  availableCapabilities: readonly string[] | undefined,
): string | undefined {
  return availableCapabilities === undefined
    ? undefined
    : [...availableCapabilities].sort().join(" ");
}

/** Dynamic function ports depend on every signature and call target in the document. */
function functionContextSignature(document: RinoProjectDocumentV1): string {
  return JSON.stringify(
    document.graphs.map((graph) => ({
      graphId: graph.graphId,
      kind: graph.kind,
      functionSignature: graph.functionSignature,
      calls: graph.nodes
        .filter((node) => node.typeKey === FUNCTION_CALL_NODE_TYPE)
        .map((node) => ({
          nodeId: node.nodeId,
          target: node.properties["functionGraphId"],
        })),
    })),
  );
}

/** Validation that only revalidates what changed.
 *
 * A command replaces the graph it edits and leaves every other graph object untouched, so
 * object identity is an exact record of what an edit affected. Document structure is
 * always rechecked because it is proportional to the number of graphs and assets rather
 * than to the size of the graph the user is editing.
 *
 * The cache is keyed on the registry snapshot and the advertised capabilities as well:
 * both change what a graph's diagnostics are, and neither is visible in the graph itself.
 */
export function createIncrementalValidation(): IncrementalValidation {
  const graphCache = new Map<string, GraphCacheEntry>();
  let validator: DocumentValidator | undefined;
  let cachedRegistry: RinoNodeRegistrySnapshotV1 | undefined;
  let cachedCapabilities: string | undefined;
  let cachedFunctionContext: string | undefined;

  return {
    validate: (document, registry, options = {}) => {
      const capabilities = capabilitySignature(options.availableCapabilities);
      const functionContext = functionContextSignature(document);
      if (
        validator === undefined ||
        cachedRegistry !== registry ||
        cachedCapabilities !== capabilities
      ) {
        validator = createDocumentValidator(registry, options);
        cachedRegistry = registry;
        cachedCapabilities = capabilities;
        graphCache.clear();
      }
      if (cachedFunctionContext !== functionContext) {
        graphCache.clear();
        cachedFunctionContext = functionContext;
      }

      const diagnostics = validator.validateStructure(document);
      const live = new Set<string>();
      for (const graph of document.graphs) {
        live.add(graph.graphId);
        const cached = graphCache.get(graph.graphId);
        if (cached?.source === graph) {
          diagnostics.push(...cached.diagnostics);
          continue;
        }
        const produced = validator.validateGraph(graph, document);
        graphCache.set(graph.graphId, { source: graph, diagnostics: produced });
        diagnostics.push(...produced);
      }

      for (const graphId of [...graphCache.keys()]) {
        if (!live.has(graphId)) {
          graphCache.delete(graphId);
        }
      }

      return assembleValidationReport(diagnostics);
    },
  };
}
