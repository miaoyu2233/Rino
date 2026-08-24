import type { NodeV1 } from "@rino/contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "../../components/ui/Select";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { translateDataKey } from "../../localization/data-keys";
import { commitNodeProperty } from "../fields/field-commands";
import {
  taskChoiceCaseForId,
  taskChoiceCases,
  taskChoiceHasUnmatchedSelection,
  taskChoiceSelection,
} from "../task-choice";

interface TaskChoiceInspectorSectionProps {
  node: NodeV1;
}

/** The selected case uses the same graph property as the top-bar projection. */
export function TaskChoiceInspectorSection({
  node,
}: TaskChoiceInspectorSectionProps) {
  const { t } = useTranslation();
  const cases = taskChoiceCases(node);
  const selectedCaseId = taskChoiceSelection(node);
  const selectedCase =
    selectedCaseId === undefined
      ? undefined
      : taskChoiceCaseForId(node, selectedCaseId);
  const options = useMemo(
    () =>
      (cases ?? []).map((choice) => ({
        value: choice.caseId,
        label: choice.label,
      })),
    [cases],
  );

  if (cases === undefined) {
    return (
      <section
        className="inspector-section task-choice-inspector"
        aria-live="polite"
      >
        <h3 className="inspector-section__title">
          {t("node.core.logic.taskChoice.title")}
        </h3>
        <p className="inspector-notice" data-severity="warning">
          <ProductIcon icon="runtime.warning" size="small" />
          <span>{t("shell.tasks.taskSettings.invalid")}</span>
        </p>
      </section>
    );
  }

  return (
    <section className="inspector-section task-choice-inspector">
      <h3 className="inspector-section__title">
        {t("node.core.logic.taskChoice.title")}
      </h3>
      <label className="inspector-field">
        <span className="inspector-field__label">
          {t("node.core.logic.taskChoice.property.selectedCaseId.label")}
        </span>
        <div className="inspector-field__body">
          <Select
            aria-label={t(
              "node.core.logic.taskChoice.property.selectedCaseId.label",
            )}
            value={selectedCase === undefined ? "" : selectedCase.caseId}
            placeholder={selectedCaseId ?? t("graph.inspector.noProperties")}
            options={options}
            onValueChange={(value) => {
              commitNodeProperty(node.nodeId, "selectedCaseId", value);
            }}
          />
        </div>
      </label>
      {taskChoiceHasUnmatchedSelection(node) ? (
        <p className="inspector-notice" data-severity="warning">
          {t("shell.tasks.taskSettings.unmatched")}
        </p>
      ) : null}
      <p className="inspector-empty-note">
        {translateDataKey(
          t,
          "node.core.logic.taskChoice.description",
          t("node.core.logic.taskChoice.description"),
        )}
      </p>
    </section>
  );
}
