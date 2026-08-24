import type { NodeDefinitionV1, NodeV1 } from "@rino/contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { translateDataKey } from "../../localization/data-keys";
import {
  buildNumericWorkflowModel,
  type CompareOperator,
  type SourceState,
} from "./numeric-workflow-model";

export interface NumericWorkflowInspectorSectionProps {
  node: NodeV1;
  definition: NodeDefinitionV1;
  connectedPortIds: ReadonlySet<string>;
}

const OPERATOR_SYMBOLS: Record<CompareOperator, string> = {
  greaterThan: ">",
  greaterThanOrEqual: ">=",
  lessThan: "<",
  lessThanOrEqual: "<=",
  equalTo: "=",
  notEqualTo: "!=",
};

function getOperatorNameKey(operator: CompareOperator) {
  switch (operator) {
    case "greaterThan":
      return "graph.inspector.numericWorkflow.numberCompare.operatorNames.greaterThan" as const;
    case "greaterThanOrEqual":
      return "graph.inspector.numericWorkflow.numberCompare.operatorNames.greaterThanOrEqual" as const;
    case "lessThan":
      return "graph.inspector.numericWorkflow.numberCompare.operatorNames.lessThan" as const;
    case "lessThanOrEqual":
      return "graph.inspector.numericWorkflow.numberCompare.operatorNames.lessThanOrEqual" as const;
    case "equalTo":
      return "graph.inspector.numericWorkflow.numberCompare.operatorNames.equalTo" as const;
    case "notEqualTo":
      return "graph.inspector.numericWorkflow.numberCompare.operatorNames.notEqualTo" as const;
  }
}

interface SourceDisplayProps {
  source: SourceState;
  fallbackLabel: string;
  connectedLabelKey:
    | "graph.inspector.numericWorkflow.numberCompare.connected"
    | "graph.inspector.numericWorkflow.branch.connected";
}

function SourceDisplay({
  source,
  fallbackLabel,
  connectedLabelKey,
}: SourceDisplayProps) {
  const { t } = useTranslation();

  if (source.kind === "connected") {
    return (
      <span className="numeric-workflow-source numeric-workflow-source--connected">
        <ProductIcon icon="category.flow" size="small" />
        <span>{t(connectedLabelKey)}</span>
      </span>
    );
  }

  if (source.kind === "literal") {
    return (
      <code className="numeric-workflow-source numeric-workflow-source--literal font-code">
        {String(source.value)}
      </code>
    );
  }

  if (source.kind === "invalid") {
    return (
      <span className="numeric-workflow-source numeric-workflow-source--required">
        <ProductIcon icon="runtime.warning" size="small" />
        <span>{t("graph.inspector.numericWorkflow.invalidStoredValue")}</span>
      </span>
    );
  }

  return (
    <span className="numeric-workflow-source numeric-workflow-source--required">
      <ProductIcon icon="runtime.warning" size="small" />
      <span>{fallbackLabel}</span>
    </span>
  );
}

export function NumericWorkflowInspectorSection({
  node,
  definition,
  connectedPortIds,
}: NumericWorkflowInspectorSectionProps) {
  const { t } = useTranslation();

  const model = useMemo(
    () => buildNumericWorkflowModel(node, definition, connectedPortIds),
    [node, definition, connectedPortIds],
  );

  if (!model) {
    return null;
  }

  if (model.kind === "parseNumber") {
    const hasWarnings =
      model.equalSeparatorsWarning ||
      model.reversedBoundsWarning ||
      model.configurationInvalid;

    if (!hasWarnings) {
      return null;
    }

    return (
      <section
        className="numeric-workflow-section"
        aria-label={t("graph.inspector.numericWorkflow.parseNumber.title")}
      >
        {model.equalSeparatorsWarning && (
          <p className="inspector-notice" data-severity="warning">
            <ProductIcon icon="runtime.warning" size="small" />
            <span>
              {t(
                "graph.inspector.numericWorkflow.parseNumber.equalSeparatorsWarning",
              )}
            </span>
          </p>
        )}

        {model.reversedBoundsWarning && (
          <p className="inspector-notice" data-severity="warning">
            <ProductIcon icon="runtime.warning" size="small" />
            <span>
              {t(
                "graph.inspector.numericWorkflow.parseNumber.reversedBoundsWarning",
              )}
            </span>
          </p>
        )}

        {model.configurationInvalid && (
          <p className="inspector-notice" data-severity="warning">
            <ProductIcon icon="runtime.warning" size="small" />
            <span>
              {t(
                "graph.inspector.numericWorkflow.parseNumber.invalidConfigurationWarning",
              )}
            </span>
          </p>
        )}
      </section>
    );
  }

  if (model.kind === "numberCompare") {
    const isKnownOp = model.operator !== "unknown";
    const opSymbol =
      model.operator !== "unknown"
        ? OPERATOR_SYMBOLS[model.operator]
        : undefined;
    const opName =
      model.operator !== "unknown"
        ? t(getOperatorNameKey(model.operator))
        : undefined;

    return (
      <section
        className="numeric-workflow-section"
        aria-label={t("graph.inspector.numericWorkflow.numberCompare.title")}
      >
        <h3 className="inspector-section__title">
          <ProductIcon icon="node.compare" size="small" />
          {t("graph.inspector.numericWorkflow.numberCompare.title")}
        </h3>

        <div className="numeric-workflow-card">
          <div className="numeric-workflow-expression">
            <SourceDisplay
              source={model.leftSource}
              fallbackLabel={t(
                "graph.inspector.numericWorkflow.numberCompare.required",
              )}
              connectedLabelKey="graph.inspector.numericWorkflow.numberCompare.connected"
            />

            <span className="numeric-workflow-operator">
              {isKnownOp ? (
                <>
                  <code className="font-code">{opSymbol}</code>
                  <span>({opName})</span>
                </>
              ) : (
                <span className="numeric-workflow-source--required">
                  <ProductIcon icon="runtime.warning" size="small" />
                  <span>
                    {t(
                      "graph.inspector.numericWorkflow.numberCompare.unsupportedOperator",
                      {
                        operator: model.rawOperator ?? "",
                      },
                    )}
                  </span>
                </span>
              )}
            </span>

            <SourceDisplay
              source={model.rightSource}
              fallbackLabel={t(
                "graph.inspector.numericWorkflow.numberCompare.required",
              )}
              connectedLabelKey="graph.inspector.numericWorkflow.numberCompare.connected"
            />

            <span className="numeric-workflow-arrow">→</span>
            <span>
              {t("graph.inspector.numericWorkflow.numberCompare.resultTitle")}
            </span>
          </div>

          <div className="numeric-workflow-chips">
            <span className="numeric-workflow-chip numeric-workflow-chip--bool">
              <ProductIcon icon="category.logic" size="small" />
              <span>
                {t("graph.inspector.numericWorkflow.numberCompare.resultLabel")}
              </span>
            </span>
            <span className="numeric-workflow-chip numeric-workflow-chip--string">
              <ProductIcon icon="panel.values" size="small" />
              <span>
                {t(
                  "graph.inspector.numericWorkflow.numberCompare.relationLabel",
                )}
              </span>
            </span>
          </div>
        </div>
      </section>
    );
  }

  const whenTrueLabel = translateDataKey(
    t,
    model.whenTruePortLabelKey,
    model.whenTruePortId,
  );
  const whenFalseLabel = translateDataKey(
    t,
    model.whenFalsePortLabelKey,
    model.whenFalsePortId,
  );

  return (
    <section
      className="numeric-workflow-section"
      aria-label={t("graph.inspector.numericWorkflow.branch.title")}
    >
      <h3 className="inspector-section__title">
        <ProductIcon icon="node.branch" size="small" />
        {t("graph.inspector.numericWorkflow.branch.title")}
      </h3>

      <div className="numeric-workflow-card">
        <div className="numeric-workflow-expression">
          <span>
            {t("graph.inspector.numericWorkflow.branch.conditionLabel")}:
          </span>
          <SourceDisplay
            source={model.conditionSource}
            fallbackLabel={t("graph.inspector.numericWorkflow.branch.required")}
            connectedLabelKey="graph.inspector.numericWorkflow.branch.connected"
          />
        </div>

        <div className="numeric-workflow-paths">
          <div className="numeric-workflow-path numeric-workflow-path--true">
            <ProductIcon icon="runtime.succeeded" size="small" />
            <span>{t("graph.inspector.numericWorkflow.branch.pathTrue")}</span>
            <span className="numeric-workflow-arrow">→</span>
            <code className="font-code">{whenTrueLabel}</code>
          </div>
          <div className="numeric-workflow-path numeric-workflow-path--false">
            <ProductIcon icon="runtime.idle" size="small" />
            <span>{t("graph.inspector.numericWorkflow.branch.pathFalse")}</span>
            <span className="numeric-workflow-arrow">→</span>
            <code className="font-code">{whenFalseLabel}</code>
          </div>
        </div>
      </div>
    </section>
  );
}
