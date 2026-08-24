import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ProductIcon } from "../../design-system/icons/ProductIcon";
import type { ProductIconKey } from "../../design-system/icons/product-icons";
import { translateDataMessage } from "../../localization/data-keys";
import { NodeRegistryIndex } from "../node-registry-index";
import { useNodeRegistry } from "../registry/registry-store";
import { useActiveDocument } from "../store/document-store";
import { revealProblem } from "./problem-focus";
import type { GraphProblem } from "./problem-model";
import {
  describeProblemSubject,
  indexDocumentForSubjects,
  type ProblemSubjectPiece,
} from "./problem-subject";
import { useGraphProblems } from "./useGraphProblems";
import "./graph-problems.css";

const SEVERITY_ICONS = {
  error: "runtime.failed",
  warning: "runtime.warning",
} as const satisfies Record<GraphProblem["severity"], ProductIconKey>;

interface GraphProblemRowProps {
  problem: GraphProblem;
  subject: readonly ProblemSubjectPiece[];
}

function GraphProblemRow({ problem, subject }: GraphProblemRowProps) {
  const { t } = useTranslation();
  const message = translateDataMessage(
    t,
    problem.messageKey,
    problem.parameters,
    problem.code,
  );
  const focus = problem.focus;

  const body = (
    <>
      <span className="problem-row__icon" aria-hidden="true">
        <ProductIcon icon={SEVERITY_ICONS[problem.severity]} size="small" />
      </span>
      <span className="problem-row__body">
        <strong className="problem-row__title">{message}</strong>
        <span className="problem-row__meta">
          <span className="problem-row__severity">
            {t(`diagnostics.severity.${problem.severity}`)}
          </span>
          {/* A breadcrumb of names, kept as separate pieces so no translated sentence is
              assembled from fragments. */}
          <span className="problem-row__subject">
            {subject.map((piece) => (
              <span key={piece.key} className="problem-row__subject-piece">
                {piece.text}
              </span>
            ))}
          </span>
          <code className="problem-row__code">{problem.code}</code>
        </span>
      </span>
    </>
  );

  return (
    <li className={`problem-row problem-row--${problem.severity}`}>
      {focus === undefined ? (
        // Nothing on the canvas represents this problem, so the row states it without
        // offering navigation that would go nowhere.
        <div className="problem-row__content">{body}</div>
      ) : (
        <button
          type="button"
          className="problem-row__content problem-row__content--actionable"
          title={t("graph.problems.focus")}
          onClick={() => {
            revealProblem(focus);
          }}
        >
          {body}
        </button>
      )}
    </li>
  );
}

/** Graph validation results for the open project.
 *
 * Diagnostics are produced by the same validator the runtime mirrors, so a problem listed
 * here is the problem that will block a run. Activating a row takes the user to the node,
 * edge, or field it names.
 */
export function GraphProblemsSection() {
  const { t } = useTranslation();
  const state = useGraphProblems();
  const document = useActiveDocument();
  const registry = useNodeRegistry();

  const registryIndex = useMemo(
    () => (registry ? new NodeRegistryIndex(registry) : undefined),
    [registry],
  );

  // Built once per document rather than once per row: a project with nothing wired up
  // produces a problem for every required input, and searching the node array for each of
  // them is quadratic in the size of the graph.
  const subjectIndex = useMemo(
    () => (document ? indexDocumentForSubjects(document) : undefined),
    [document],
  );

  const rows = useMemo(() => {
    if (state.status !== "validated" || !subjectIndex || !registryIndex) {
      return [];
    }
    return state.problems.map((problem) => ({
      problem,
      subject: describeProblemSubject(problem, subjectIndex, registryIndex, t),
    }));
  }, [registryIndex, state, subjectIndex, t]);

  if (state.status === "noProject") {
    // Without a project there is nothing to validate. The surrounding panel says so once,
    // rather than every section repeating it.
    return null;
  }

  return (
    <section
      className="problems-section"
      aria-label={t("graph.problems.title")}
    >
      <header className="problems-section__header">
        <ProductIcon icon="panel.problems" size="small" />
        <h3 className="problems-section__title">{t("graph.problems.title")}</h3>
        {state.status === "validated" ? (
          <span className="problems-section__summary">
            {state.problems.length === 0
              ? t("graph.problems.none")
              : t("graph.problems.summary", {
                  errors: state.counts.errors,
                  warnings: state.counts.warnings,
                })}
          </span>
        ) : null}
      </header>

      {state.status === "registryUnavailable" ? (
        <p className="problems-section__note">
          {t("graph.problems.registryUnavailable")}
        </p>
      ) : null}

      {state.status === "validated" && !state.executable ? (
        <p className="problems-section__note" data-severity="error">
          {t("graph.problems.blocksRun")}
        </p>
      ) : null}

      {rows.length === 0 ? null : (
        <ul className="problems__list">
          {rows.map(({ problem, subject }) => (
            <GraphProblemRow
              key={problem.key}
              problem={problem}
              subject={subject}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
