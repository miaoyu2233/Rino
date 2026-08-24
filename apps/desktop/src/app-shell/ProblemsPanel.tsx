import { useTranslation } from "react-i18next";

import { useDiagnosticStore } from "../diagnostics/diagnostic-store";
import { ProblemsList } from "../diagnostics/ProblemsList";
import { GraphProblemsSection } from "../graph/problems/GraphProblemsSection";
import { useActiveDocument } from "../graph/store/document-store";
import { EmptyState } from "./EmptyState";

/** Everything that currently needs the user's attention, in one surface.
 *
 * Graph validation and application failures reach the user through different paths — one
 * is derived from the document on every edit, the other is reported by a boundary or a
 * service — but they are the same question for the user, so they share this panel.
 */
export function ProblemsPanel() {
  const { t } = useTranslation();
  const document = useActiveDocument();
  const hasApplicationProblems = useDiagnosticStore(
    (state) => state.problems.length > 0,
  );

  if (document === undefined && !hasApplicationProblems) {
    return (
      <EmptyState
        icon="panel.problems"
        title={t("diagnostics.problems.emptyTitle")}
        description={t("diagnostics.problems.emptyDescription")}
      />
    );
  }

  return (
    <div className="problems-panel">
      <GraphProblemsSection />
      <ProblemsList />
    </div>
  );
}
