import type {
  DiagnosticLocationV1,
  GraphDiagnosticCodeV1,
  GraphDiagnosticV1,
} from "@rino/contracts";

/** Interpolation values carried with a diagnostic.
 *
 * Only identifiers, type names, and counts belong here. Project content such as a node
 * alias, a comment, or an asset display name is never interpolated, so a diagnostic can
 * be logged or reported without disclosing what the user is automating.
 */
export type DiagnosticParameters = Record<string, string | number>;

/** Severities that block a run, keyed by code.
 *
 * A code that is absent is a warning: it is surfaced in the Problems panel but does not
 * prevent execution.
 */
const WARNING_CODES: ReadonlySet<GraphDiagnosticCodeV1> = new Set([
  "NODE_TYPE_DEPRECATED",
  "NODE_CAPABILITY_UNAVAILABLE",
]);

/** The localization key a code resolves to. Keys are derived so a new code cannot ship
 * with a message key that silently disagrees with it. */
function messageKeyFor(code: GraphDiagnosticCodeV1): string {
  const camelCase = code
    .toLowerCase()
    .split("_")
    .map((segment, index) =>
      index === 0
        ? segment
        : segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join("");
  return `graph.diagnostics.${camelCase}`;
}

export function buildDiagnostic(
  code: GraphDiagnosticCodeV1,
  location: DiagnosticLocationV1,
  parameters: DiagnosticParameters = {},
): GraphDiagnosticV1 {
  return {
    code,
    severity: WARNING_CODES.has(code) ? "warning" : "error",
    location,
    messageKey: messageKeyFor(code),
    parameters,
  };
}

export function documentLocation(): DiagnosticLocationV1 {
  return { scope: "document" };
}

export function graphLocation(graphId: string): DiagnosticLocationV1 {
  return { scope: "graph", graphId };
}

export function nodeLocation(
  graphId: string,
  nodeId: string,
): DiagnosticLocationV1 {
  return { scope: "node", graphId, nodeId };
}

export function portLocation(
  graphId: string,
  nodeId: string,
  portId: string,
): DiagnosticLocationV1 {
  return { scope: "port", graphId, nodeId, portId };
}

export function edgeLocation(
  graphId: string,
  edgeId: string,
): DiagnosticLocationV1 {
  return { scope: "edge", graphId, edgeId };
}

export function assetLocation(assetId: string): DiagnosticLocationV1 {
  return { scope: "asset", assetId };
}
