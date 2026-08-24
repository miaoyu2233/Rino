import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/Button";
import { IconAction } from "../app-shell/IconAction";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import type { ProductIconKey } from "../design-system/icons/product-icons";
import type {
  ApplicationDiagnostic,
  DiagnosticSeverity,
} from "./diagnostic-model";
import { useDiagnosticStore } from "./diagnostic-store";
import { translateDiagnostic } from "./translate-diagnostic";

const SEVERITY_ICONS: Record<DiagnosticSeverity, ProductIconKey> = {
  error: "runtime.failed",
  warning: "runtime.warning",
  info: "runtime.idle",
};

function ProblemRow({
  problem,
  onDismiss,
}: {
  problem: ApplicationDiagnostic;
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <li className={`problem-row problem-row--${problem.severity}`}>
      <span className="problem-row__icon" aria-hidden="true">
        <ProductIcon icon={SEVERITY_ICONS[problem.severity]} size="small" />
      </span>
      <span className="problem-row__body">
        <strong className="problem-row__title">
          {translateDiagnostic(t, problem.titleKey, problem.parameters)}
        </strong>
        <span className="problem-row__description">
          {translateDiagnostic(t, problem.descriptionKey, problem.parameters)}
        </span>
        <span className="problem-row__meta">
          <span className="problem-row__severity">
            {t(`diagnostics.severity.${problem.severity}`)}
          </span>
          {problem.code === undefined ? null : (
            <code className="problem-row__code">{problem.code}</code>
          )}
        </span>
      </span>
      <IconAction
        icon="action.close"
        label={t("diagnostics.actions.dismiss")}
        onClick={() => {
          onDismiss(problem.id);
        }}
      />
    </li>
  );
}

/** Application, runtime, and project failures that need attention or continued diagnosis.
 *
 * Renders nothing when there is nothing to report: the problems panel owns the single
 * empty state that covers both this list and graph validation. */
export function ProblemsList() {
  const { t } = useTranslation();
  const problems = useDiagnosticStore((state) => state.problems);
  const dismissProblem = useDiagnosticStore((state) => state.dismissProblem);
  const clearProblems = useDiagnosticStore((state) => state.clearProblems);

  if (problems.length === 0) {
    return null;
  }

  return (
    <section
      className="problems problems-section"
      aria-label={t("diagnostics.problems.applicationTitle")}
    >
      <div className="problems__toolbar">
        <h3 className="problems-section__title">
          {t("diagnostics.problems.applicationTitle")}
        </h3>
        <span className="problems__count">
          {t("diagnostics.problems.count", { count: problems.length })}
        </span>
        <Button
          variant="ghost"
          size="compact"
          onClick={() => {
            clearProblems();
          }}
        >
          {t("diagnostics.actions.dismissAll")}
        </Button>
      </div>
      <ul className="problems__list">
        {problems.map((problem) => (
          <ProblemRow
            key={problem.id}
            problem={problem}
            onDismiss={dismissProblem}
          />
        ))}
      </ul>
    </section>
  );
}
