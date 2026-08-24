import { useMemo, useState } from "react";

import { useNodeRegistry } from "../registry/registry-store";
import { useActiveDocument } from "../store/document-store";
import { createIncrementalValidation } from "./incremental-validation";
import {
  countProblems,
  orderProblems,
  type GraphProblem,
  type ProblemCounts,
} from "./problem-model";

export type GraphProblemsState =
  | { status: "noProject" }
  | { status: "registryUnavailable" }
  | {
      status: "validated";
      problems: GraphProblem[];
      counts: ProblemCounts;
      /** False while any error-severity problem remains, which is the same condition the
       * runtime applies before it agrees to execute the document. */
      executable: boolean;
    };

/** Validates the open document and orders the result for display.
 *
 * Revalidation happens whenever a command replaces the document, and reuses the
 * diagnostics of every graph the edit left untouched. The validator instance belongs to
 * the component that calls this so its cache is released with the panel.
 */
export function useGraphProblems(): GraphProblemsState {
  const document = useActiveDocument();
  const registry = useNodeRegistry();
  const [validation] = useState(createIncrementalValidation);

  return useMemo<GraphProblemsState>(() => {
    if (document === undefined) {
      return { status: "noProject" };
    }
    if (registry === undefined) {
      return { status: "registryUnavailable" };
    }
    const report = validation.validate(document, registry);
    const problems = orderProblems(report.diagnostics);
    return {
      status: "validated",
      problems,
      counts: countProblems(problems),
      executable: report.executable,
    };
  }, [document, registry, validation]);
}
