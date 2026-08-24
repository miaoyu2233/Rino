import type {
  DiagnosticLocationV1,
  DiagnosticSeverityV1,
  GraphDiagnosticCodeV1,
  GraphDiagnosticV1,
} from "@rino/contracts";

/** Where the editor should take the user when a problem is activated.
 *
 * A diagnostic names its location by identifier; this is the same information reduced to
 * what the canvas and the inspector can act on. A location the editor cannot navigate to,
 * such as an asset, produces no target rather than a guess.
 */
export interface ProblemFocusTarget {
  graphId: string;
  nodeId: string | undefined;
  edgeId: string | undefined;
  portId: string | undefined;
}

/** Interpolation values a diagnostic message may use. */
export type ProblemParameters = Record<string, string | number | boolean>;

export interface GraphProblem {
  /** Stable across revalidations, so an unchanged row is not remounted when an unrelated
   * problem appears above it. */
  key: string;
  code: GraphDiagnosticCodeV1;
  severity: DiagnosticSeverityV1;
  messageKey: string;
  parameters: ProblemParameters;
  location: DiagnosticLocationV1;
  focus: ProblemFocusTarget | undefined;
}

export function focusTargetOf(
  location: DiagnosticLocationV1,
): ProblemFocusTarget | undefined {
  switch (location.scope) {
    case "graph":
      return {
        graphId: location.graphId,
        nodeId: undefined,
        edgeId: undefined,
        portId: undefined,
      };
    case "node":
      return {
        graphId: location.graphId,
        nodeId: location.nodeId,
        edgeId: undefined,
        portId: undefined,
      };
    case "port":
      return {
        graphId: location.graphId,
        nodeId: location.nodeId,
        edgeId: undefined,
        portId: location.portId,
      };
    case "edge":
      return {
        graphId: location.graphId,
        nodeId: undefined,
        edgeId: location.edgeId,
        portId: undefined,
      };
    case "document":
    case "asset":
      return undefined;
    default: {
      const unhandled: never = location;
      return unhandled;
    }
  }
}

/** A textual identity for a location, used to build stable row keys. */
function locationKey(location: DiagnosticLocationV1): string {
  switch (location.scope) {
    case "document":
      return "document";
    case "graph":
      return `graph/${location.graphId}`;
    case "node":
      return `node/${location.graphId}/${location.nodeId}`;
    case "port":
      return `port/${location.graphId}/${location.nodeId}/${location.portId}`;
    case "edge":
      return `edge/${location.graphId}/${location.edgeId}`;
    case "asset":
      return `asset/${location.assetId}`;
    default: {
      const unhandled: never = location;
      return unhandled;
    }
  }
}

/** Keeps only the scalars a message can interpolate.
 *
 * Diagnostic parameters are declared as arbitrary JSON so the contract can carry richer
 * values later. Anything that is not a scalar has no textual form the catalogs could use,
 * so it is dropped rather than rendered as `[object Object]`.
 */
function readParameters(diagnostic: GraphDiagnosticV1): ProblemParameters {
  const parameters: ProblemParameters = {};
  for (const [name, value] of Object.entries(diagnostic.parameters)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      parameters[name] = value;
    }
  }
  return parameters;
}

const SEVERITY_ORDER: Record<DiagnosticSeverityV1, number> = {
  error: 0,
  warning: 1,
};

/** Orders diagnostics for display: everything that blocks a run first, then warnings.
 *
 * Within a severity the validator's own order is preserved, which reads as document
 * structure followed by each graph in document order.
 */
export function orderProblems(
  diagnostics: readonly GraphDiagnosticV1[],
): GraphProblem[] {
  const occurrences = new Map<string, number>();

  return diagnostics
    .map((diagnostic): GraphProblem => {
      const identity = `${diagnostic.code}@${locationKey(diagnostic.location)}`;
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      return {
        key: `${identity}#${String(occurrence)}`,
        code: diagnostic.code,
        severity: diagnostic.severity,
        messageKey: diagnostic.messageKey,
        parameters: readParameters(diagnostic),
        location: diagnostic.location,
        focus: focusTargetOf(diagnostic.location),
      };
    })
    .sort(
      (left, right) =>
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
    );
}

export interface ProblemCounts {
  errors: number;
  warnings: number;
}

export function countProblems(
  problems: readonly GraphProblem[],
): ProblemCounts {
  return {
    errors: problems.filter((problem) => problem.severity === "error").length,
    warnings: problems.filter((problem) => problem.severity === "warning")
      .length,
  };
}
