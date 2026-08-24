import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";
import {
  memo,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { resolveProductIcon } from "../../design-system/icons/product-icons";
import { portColorTokens } from "../../design-system/tokens";
import { notify } from "../../diagnostics/diagnostic-store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../components/ui/ContextMenu";
import { Select } from "../../components/ui/Select";
import { resolveBilingualTitle } from "../../localization/bilingual-title";
import { translateDataKey } from "../../localization/data-keys";
import { useNodeExecutionView } from "../../ipc/runtime-execution-store";
import {
  commitDisplayAlias,
  commitInputLiteral,
  commitNodeProperty,
} from "../fields/field-commands";
import {
  promoteInputToNode,
  focusCoordinateNode,
  focusImageRecognitionRegion,
  focusTextRecognitionParameter,
  revealWorkflowGroupParameter,
  setImageRecognitionRegion,
  setImageRecognitionRegionEnabled,
  setImageRecognitionMethod,
  setImageRecognitionTemplateAsset,
  setImageRecognitionThreshold,
  setRecognitionClickMethod,
  setTextRecognitionClickPoint,
  setTextRecognitionClickMethod,
  setTextRecognitionConfidence,
  setRecognitionDelay,
  setRecognitionDelayMode,
  setTextRecognitionRegion,
  setTextRecognitionRegionEnabled,
  setWorkflowGroupCollapsed,
  MAXIMUM_TEXT_RECOGNITION_DELAY_MILLISECONDS,
  type ImageRecognitionMethod,
  type RecognitionDelayMode,
  type TextRecognitionClickMethod,
} from "../commands/workflow-group-commands";
import {
  addSequenceStep,
  moveSequenceStep,
} from "../commands/sequence-node-commands";
import {
  addDynamicPort,
  removeDynamicPort,
} from "../commands/dynamic-node-commands";
import {
  bindVariable,
  createAndBindVariable,
  updateVariableDefinition,
} from "../variables/variable-commands";
import { useActiveDocument, useDocumentStore } from "../store/document-store";
import { FieldControl } from "../fields/FieldControl";
import {
  formatFieldValue,
  MAXIMUM_DISPLAY_ALIAS_LENGTH,
} from "../fields/field-editor";
import { visibleAssetDisplayName } from "../project/asset-names";
import { useCompatibleConnectionTarget } from "./connection-drag-store";
import { shouldFloatDisplayAlias } from "./alias-display";
import type {
  CanvasNodeData,
  CanvasPortView,
  RinoFlowNode,
} from "./graph-view-model";
import { DescribedLabel } from "./DescribedLabel";
import { displayPortType, portDescriptionKey } from "./port-presentation";
import { RepeatHintNodeView } from "./RepeatHintView";
import { estimateNodeHeight } from "./node-layout-size";

type PortHandleStyle = CSSProperties & { "--port-color": string };

const FULL_NODE_DETAIL_MINIMUM_ZOOM = 0.5;

function overviewHandleStyle(port: CanvasPortView): PortHandleStyle {
  return {
    "--port-color": `var(${portColorTokens[port.colorRole]})`,
  };
}

interface OverviewNodeHandlesProps {
  inputs: readonly CanvasPortView[];
  outputs: readonly CanvasPortView[];
}

function OverviewNodeHandles({ inputs, outputs }: OverviewNodeHandlesProps) {
  return (
    <>
      {inputs
        .filter((port) => port.connected)
        .map((port) => (
          <Handle
            key={`input-${port.portId}`}
            type="target"
            position={Position.Left}
            id={port.portId}
            className="rino-node__overview-handle"
            style={overviewHandleStyle(port)}
            isConnectable={false}
            aria-hidden="true"
            tabIndex={-1}
          />
        ))}
      {outputs
        .filter((port) => port.connected)
        .map((port) => (
          <Handle
            key={`output-${port.portId}`}
            type="source"
            position={Position.Right}
            id={port.portId}
            className="rino-node__overview-handle"
            style={overviewHandleStyle(port)}
            isConnectable={false}
            aria-hidden="true"
            tabIndex={-1}
          />
        ))}
    </>
  );
}

interface NodePortRowProps {
  port: CanvasPortView;
  side: "input" | "output";
  nodeTitle: string;
  actions?: ReactNode;
}

function NodePortRow({ port, side, nodeTitle, actions }: NodePortRowProps) {
  const { t } = useTranslation();
  // Subscribed per port rather than per node, so beginning a connection drag re-renders
  // only the ports that light up.
  const compatible = useCompatibleConnectionTarget(
    port.domainNodeId,
    port.domainPortId,
  );
  const label =
    port.labelOverride ?? translateDataKey(t, port.labelKey, port.portId);
  const typeLabel = displayPortType(t, port.typeLabel, "compact");
  const detailedTypeLabel = displayPortType(t, port.typeLabel, "full");
  const descriptionKey = portDescriptionKey(port.labelKey, port.portId);
  const description =
    descriptionKey === undefined
      ? undefined
      : translateDataKey(t, descriptionKey, "");
  const handleLabel = t(
    side === "input" ? "graph.port.inputLabel" : "graph.port.outputLabel",
    { node: nodeTitle, port: label, type: detailedTypeLabel },
  );
  const handleStyle: PortHandleStyle = {
    "--port-color": `var(${portColorTokens[port.colorRole]})`,
  };

  const row = (
    <div
      className="rino-port"
      data-port-id={port.portId}
      data-domain-node-id={port.domainNodeId}
      data-domain-port-id={port.domainPortId}
      data-side={side}
      data-kind={port.portKind}
      data-shape={port.shape}
      data-connection={compatible ? "compatible" : undefined}
    >
      <Handle
        type={side === "input" ? "target" : "source"}
        position={side === "input" ? Position.Left : Position.Right}
        id={port.portId}
        className="rino-port__handle"
        style={handleStyle}
        aria-label={handleLabel}
        aria-description={`${description ?? ""}${description === undefined ? "" : "。"}${t("graph.port.connectionGestureHint")}`}
        title={`${handleLabel}。${description === undefined ? "" : `${description}。`}${t("graph.port.connectionGestureHint")}`}
      />
      <DescribedLabel
        className="rino-port__label"
        label={label}
        description={description}
        side={side === "output" ? "left" : "right"}
      />
      {port.showTypeLabel && typeLabel !== label ? (
        <span className="rino-port__type font-code" title={detailedTypeLabel}>
          {typeLabel}
        </span>
      ) : null}
      {port.required && !port.connected ? (
        <span
          className="rino-port__required"
          aria-label={t("graph.port.required")}
          title={t("graph.port.required")}
        >
          *
        </span>
      ) : null}
      {side === "input" && port.portKind === "data" && port.connected ? (
        <span
          className="rino-port__connection-note"
          title={t("graph.inspector.drivenByConnection")}
        >
          {t("graph.port.connected")}
        </span>
      ) : null}
      {side === "input" && port.acceptsLiteral && !port.connected ? (
        port.literalEditor.kind === "unsupported" ? (
          port.literalValue === undefined ? null : (
            <span className="rino-port__literal font-code">
              {formatFieldValue(port.literalValue)}
            </span>
          )
        ) : (
          // The same control and the same command as the inspector, so a value edited here
          // and a value edited there cannot diverge or produce different undo entries.
          <FieldControl
            variant="inline"
            editor={port.literalEditor}
            value={port.literalValue}
            required={port.required}
            label={t("graph.node.inlineFieldLabel", {
              node: nodeTitle,
              port: label,
            })}
            onCommit={(value) =>
              commitInputLiteral(port.domainNodeId, port.domainPortId, value)
            }
          />
        )
      ) : null}
      {actions}
    </div>
  );
  if (side !== "input" || port.connected || port.promotionKind === undefined) {
    return row;
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() =>
            promoteInputToNode(
              port.domainNodeId,
              port.domainPortId,
              port.promotionKind ?? "number",
            )
          }
        >
          <ProductIcon icon="node.coordinate" size="small" />
          {t("workflowGroup.actions.promoteInput")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const MemoizedNodePortRow = memo(NodePortRow);

function sequenceStepNumber(stepId: string, fallback: number): number {
  const match = /^step([1-9]\d*)$/u.exec(stepId);
  return match === null ? fallback : Number(match[1]);
}

function SequenceOrderButtons({
  graphId,
  nodeId,
  stepId,
  stableStepNumber,
  position,
  stepCount,
}: {
  graphId: string;
  nodeId: string;
  stepId: string;
  stableStepNumber: number;
  position: number;
  stepCount: number;
}) {
  const { t } = useTranslation();
  const move = (direction: "up" | "down") => {
    moveSequenceStep(graphId, nodeId, stepId, direction);
  };
  return (
    <span className="rino-node__sequence-order-actions nodrag nopan">
      <button
        type="button"
        aria-label={t("graph.node.sequence.moveUp", {
          step: stableStepNumber,
          position,
        })}
        title={t("graph.node.sequence.moveUp", {
          step: stableStepNumber,
          position,
        })}
        disabled={position <= 1}
        onClick={(event) => {
          event.stopPropagation();
          move("up");
        }}
      >
        <ProductIcon icon="action.chevronUp" size="small" />
      </button>
      <button
        type="button"
        aria-label={t("graph.node.sequence.moveDown", {
          step: stableStepNumber,
          position,
        })}
        title={t("graph.node.sequence.moveDown", {
          step: stableStepNumber,
          position,
        })}
        disabled={position >= stepCount}
        onClick={(event) => {
          event.stopPropagation();
          move("down");
        }}
      >
        <ProductIcon icon="action.chevronDown" size="small" />
      </button>
    </span>
  );
}

function SequenceStepRowActions({
  data,
  port,
}: {
  data: CanvasNodeData;
  port: CanvasPortView;
}) {
  if (
    data.typeKey !== "core.flow.sequence" ||
    !/^step\d+$/u.test(port.portId)
  ) {
    return null;
  }
  const order = data.sequenceControl?.order ?? [];
  const fallbackStepNumber = Number(port.portId.slice("step".length));
  const index = order.indexOf(port.portId);
  const position = index < 0 ? fallbackStepNumber : index + 1;
  const stepCount =
    order.length > 0 ? order.length : (data.sequenceControl?.stepCount ?? 0);
  return (
    <SequenceOrderButtons
      graphId={data.graphId}
      nodeId={data.nodeId}
      stepId={port.portId}
      stableStepNumber={fallbackStepNumber}
      position={position}
      stepCount={stepCount}
    />
  );
}

function SequenceOrderBody({ data }: { data: CanvasNodeData }) {
  const { t } = useTranslation();
  if (
    data.typeKey !== "core.flow.sequenceOrder" &&
    !(
      data.typeKey === "core.flow.sequence" &&
      data.sequenceControl?.legacy === true
    )
  ) {
    return null;
  }
  const order = data.sequenceControl?.order ?? [];
  return (
    <section
      className="rino-node__sequence-order-body nodrag nopan"
      aria-label={t("graph.node.sequence.orderEditor")}
    >
      {order.map((stepId, index) => (
        <div className="rino-node__sequence-order-row" key={stepId}>
          <span>
            {t("graph.node.sequence.step", {
              count: sequenceStepNumber(stepId, index + 1),
            })}
          </span>
          <SequenceOrderButtons
            graphId={data.graphId}
            nodeId={data.nodeId}
            stepId={stepId}
            stableStepNumber={sequenceStepNumber(stepId, index + 1)}
            position={index + 1}
            stepCount={order.length}
          />
        </div>
      ))}
    </section>
  );
}

function WorkflowGroupBody({ data }: { data: CanvasNodeData }) {
  const { t } = useTranslation();
  const group = data.workflowGroup;
  if (group === undefined) {
    return null;
  }
  const recognizerType = group.steps.find(
    (step) => step.role === "recognizer",
  )?.typeKey;
  const clickType = group.steps.find((step) => step.role === "click")?.typeKey;
  const imageMethod: ImageRecognitionMethod =
    recognizerType === "vision.featureMatch"
      ? "feature"
      : recognizerType === "vision.colorMatch"
        ? "color"
        : "template";
  const clickMethod: TextRecognitionClickMethod =
    clickType === "automation.clickPoint"
      ? "point"
      : clickType === "core.flow.sequence"
        ? "none"
        : "rectCenter";
  const imageParameters = group.imageRecognitionParameters;
  const textParameters = group.textRecognitionParameters;
  return (
    <section className="rino-workflow-group__steps">
      {group.kind === "imageRecognition" ? (
        <label className="rino-workflow-group__selector nodrag nopan">
          <DescribedLabel
            label={t("workflowGroup.imageRecognition.method")}
            description={t("workflowGroup.imageRecognition.methodDescription")}
          />
          <Select
            className="rino-workflow-group__select"
            value={imageMethod}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            options={[
              {
                value: "template",
                label: t("workflowGroup.imageRecognition.methods.template"),
                description: t(
                  "workflowGroup.imageRecognition.methodOptionDescription.template",
                ),
              },
              {
                value: "feature",
                label: t("workflowGroup.imageRecognition.methods.feature"),
                description: t(
                  "workflowGroup.imageRecognition.methodOptionDescription.feature",
                ),
              },
              {
                value: "color",
                label: t("workflowGroup.imageRecognition.methods.color"),
                description: t(
                  "workflowGroup.imageRecognition.methodOptionDescription.color",
                ),
              },
            ]}
            onValueChange={(nextMethod) =>
              setImageRecognitionMethod(
                group.groupId,
                nextMethod as ImageRecognitionMethod,
              )
            }
          />
        </label>
      ) : null}
      {clickType === undefined ? null : (
        <label className="rino-workflow-group__selector nodrag nopan">
          <DescribedLabel
            label={t("workflowGroup.recognition.clickEnabled")}
            description={t("workflowGroup.recognition.clickEnabledDescription")}
          />
          <input
            type="checkbox"
            role="switch"
            checked={clickMethod !== "none"}
            onChange={(event) =>
              setRecognitionClickMethod(
                group.groupId,
                event.target.checked ? "rectCenter" : "none",
              )
            }
          />
        </label>
      )}
      {group.kind !== "textRecognition" || clickMethod === "none" ? null : (
        <label className="rino-workflow-group__selector nodrag nopan">
          <DescribedLabel
            label={t("workflowGroup.textRecognition.clickMethod")}
            description={t(
              "workflowGroup.textRecognition.clickMethodDescription",
            )}
          />
          <Select
            className="rino-workflow-group__select"
            value={clickMethod}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            options={[
              {
                value: "rectCenter",
                label: t(
                  "workflowGroup.textRecognition.clickMethods.rectCenter",
                ),
                description: t(
                  "workflowGroup.textRecognition.clickMethodOptionDescription.rectCenter",
                ),
              },
              {
                value: "point",
                label: t("workflowGroup.textRecognition.clickMethods.point"),
                description: t(
                  "workflowGroup.textRecognition.clickMethodOptionDescription.point",
                ),
              },
            ]}
            onValueChange={(nextMethod) =>
              setTextRecognitionClickMethod(
                group.groupId,
                nextMethod as TextRecognitionClickMethod,
              )
            }
          />
        </label>
      )}
      {group.kind !== "imageRecognition" ||
      imageParameters === undefined ? null : (
        <ImageRecognitionParameterFields
          groupId={group.groupId}
          method={imageMethod}
          parameters={imageParameters}
        />
      )}
      {group.kind !== "textRecognition" ||
      textParameters === undefined ? null : (
        <TextRecognitionParameterFields
          groupId={group.groupId}
          clickMethod={clickMethod}
          parameters={textParameters}
        />
      )}
    </section>
  );
}

type TouchActionType = "click" | "longPress" | "swipe" | "multiSwipe";

const TOUCH_ACTION_TYPES: readonly TouchActionType[] = [
  "click",
  "longPress",
  "swipe",
  "multiSwipe",
];

function TouchActionBody({ data }: { data: CanvasNodeData }) {
  const { t } = useTranslation();
  const node = useDocumentStore((store) =>
    store.history?.document.graphs
      .find((graph) => graph.graphId === data.graphId)
      ?.nodes.find((candidate) => candidate.nodeId === data.nodeId),
  );
  if (node === undefined) {
    return null;
  }
  const propertyValue = node.properties["actionType"];
  const actionType: TouchActionType = TOUCH_ACTION_TYPES.includes(
    propertyValue as TouchActionType,
  )
    ? (propertyValue as TouchActionType)
    : "click";
  return (
    <section className="rino-touch-action nodrag nopan">
      <label>
        <DescribedLabel
          label={t("node.automation.touchAction.property.actionType.label")}
          description={t(
            "node.automation.touchAction.property.actionType.description",
          )}
        />
        <Select
          aria-label={t(
            "node.automation.touchAction.property.actionType.label",
          )}
          value={actionType}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          options={TOUCH_ACTION_TYPES.map((value) => ({
            value,
            label: t(
              `node.automation.touchAction.property.actionType.option.${value}`,
            ),
            description: t(
              `node.automation.touchAction.property.actionType.optionDescription.${value}`,
            ),
          }))}
          onValueChange={(value) => {
            if (TOUCH_ACTION_TYPES.includes(value as TouchActionType)) {
              commitNodeProperty(data.nodeId, "actionType", value);
            }
          }}
        />
      </label>
      <small>{t(`node.automation.touchAction.hint.${actionType}`)}</small>
    </section>
  );
}

function NodePropertyBody({ data }: { data: CanvasNodeData }) {
  const { t } = useTranslation();
  if (data.logControl !== undefined) return null;
  const clickPointMode =
    data.typeKey === "automation.clickPoint"
      ? data.propertyFields?.find((field) => field.propertyKey === "inputMode")
          ?.value
      : undefined;
  const readValueMode =
    data.typeKey === "text.readValue"
      ? data.propertyFields?.find((field) => field.propertyKey === "valueMode")
          ?.value === "text"
        ? "text"
        : "number"
      : undefined;
  const readValueSelectionMode =
    data.typeKey === "text.readValue"
      ? data.propertyFields?.find(
          (field) => field.propertyKey === "selectionMode",
        )?.value === "all"
        ? "all"
        : "position"
      : undefined;
  const filteredEditable = (data.propertyFields ?? []).filter(
    (field) =>
      field.editor.kind !== "unsupported" &&
      field.propertyKey !== "segmentKinds" &&
      !(
        data.typeKey === "automation.clickPoint" &&
        field.propertyKey === "intervalMilliseconds" &&
        clickPointMode !== "sequentialPoints"
      ) &&
      !(
        data.typeKey === "automation.touchAction" &&
        field.propertyKey === "actionType"
      ) &&
      (["valueMode", "selectionMode", "readingOrder"].includes(
        field.propertyKey,
      ) ||
        data.typeKey !== "text.readValue" ||
        (readValueMode === "number" &&
          [
            "numberType",
            "decimalSeparator",
            "groupingSeparator",
            "normalizeFullWidth",
            "allowSign",
            "minimum",
            "maximum",
          ].includes(field.propertyKey)) ||
        (readValueSelectionMode === "position" &&
          ["lineIndex", "itemIndex"].includes(field.propertyKey))),
  );
  const editable =
    data.typeKey !== "text.readValue"
      ? filteredEditable
      : [
          ...filteredEditable.filter((field) =>
            ["valueMode", "selectionMode", "readingOrder"].includes(
              field.propertyKey,
            ),
          ),
          ...filteredEditable.filter(
            (field) =>
              !["valueMode", "selectionMode", "readingOrder"].includes(
                field.propertyKey,
              ),
          ),
        ];
  if (editable.length === 0) return null;
  const commonCount = data.typeKey === "text.readValue" ? 3 : 2;
  const renderField = (field: (typeof editable)[number]) => (
    <label className="rino-node-property" key={field.propertyKey}>
      <DescribedLabel
        label={translateDataKey(t, field.labelKey)}
        description={
          field.descriptionKey === undefined
            ? undefined
            : translateDataKey(t, field.descriptionKey, "")
        }
      />
      <FieldControl
        variant="inline"
        editor={field.editor}
        value={field.value}
        required={field.required}
        label={translateDataKey(t, field.labelKey)}
        onCommit={(value) =>
          commitNodeProperty(data.nodeId, field.propertyKey, value)
        }
      />
    </label>
  );
  return (
    <section className="rino-node-properties nodrag nopan">
      {editable.slice(0, commonCount).map(renderField)}
      {editable.length <= commonCount ? null : (
        <details>
          <summary>{t("graph.node.moreParameters")}</summary>
          {editable.slice(commonCount).map(renderField)}
        </details>
      )}
    </section>
  );
}

function VariableControlBody({ data }: { data: CanvasNodeData }) {
  const { t } = useTranslation();
  const control = data.variableControl;
  if (control === undefined) {
    return null;
  }
  const selectedName = control.selectedVariableName;
  const selectedId = control.selectedVariableId;
  const commitVariableChange = (accepted: boolean): void => {
    if (!accepted) {
      notify({
        severity: "error",
        titleKey: "graph.variable.updateFailed",
      });
    }
  };
  return (
    <section className="rino-node-properties rino-node-variable-control nodrag nopan">
      <label className="rino-node-property">
        <DescribedLabel
          label={t("graph.variable.selectLabel")}
          description={undefined}
        />
        <Select
          className="field-control__select nodrag"
          aria-label={t("graph.variable.selectLabel")}
          value={selectedId ?? ""}
          placeholder={
            control.variableMissing
              ? t("graph.variable.missing")
              : t("graph.variable.noOptions")
          }
          options={control.options.map((option) => ({
            value: option.variableId,
            label: option.name,
          }))}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onValueChange={(value) => {
            commitVariableChange(bindVariable(data.nodeId, value));
          }}
        />
      </label>
      {selectedName === undefined ? null : (
        <label className="rino-node-property">
          <DescribedLabel
            label={t("graph.variable.nameLabel")}
            description={undefined}
          />
          <FieldControl
            variant="inline"
            editor={{
              kind: "text",
              minimumLength: 1,
              maximumLength: 80,
            }}
            value={selectedName}
            required
            label={t("graph.variable.nameLabel")}
            onCommit={(value) => {
              const accepted =
                typeof value === "string" &&
                selectedId !== undefined &&
                updateVariableDefinition(selectedId, { name: value });
              commitVariableChange(accepted);
              return accepted;
            }}
          />
        </label>
      )}
      {control.canPersist && selectedId !== undefined ? (
        <label className="rino-node-property rino-node-variable-control__persist">
          <input
            type="checkbox"
            className="field-control__checkbox nodrag"
            aria-label={t("graph.variable.persistentLabel")}
            checked={control.selectedPersistent === true}
            onChange={(event) => {
              commitVariableChange(
                updateVariableDefinition(selectedId, {
                  persistent: event.target.checked,
                }),
              );
            }}
          />
          <span>{t("graph.variable.persistentLabel")}</span>
        </label>
      ) : null}
      <button
        type="button"
        className="rino-node__add-step nodrag nopan"
        aria-label={t("graph.variable.create")}
        title={t("graph.variable.create")}
        onClick={(event) => {
          event.stopPropagation();
          if (!createAndBindVariable(data.nodeId, control.valueKind)) {
            notify({
              severity: "error",
              titleKey: "graph.variable.createFailed",
            });
          }
        }}
      >
        <ProductIcon icon="action.add" size="small" />
      </button>
    </section>
  );
}

function LogControlBody({ data }: { data: CanvasNodeData }) {
  const { t } = useTranslation();
  const control = data.logControl;
  if (control === undefined) return null;
  return (
    <section className="rino-log-control nodrag nopan">
      <div className="rino-log-control__segments">
        {control.segmentKinds.map((kind, index) => (
          <div key={index} className="rino-log-control__segment">
            <Select
              value={kind}
              options={[
                {
                  value: "text",
                  label: t("graph.node.log.segmentText"),
                  description: t("graph.node.log.segmentTextDescription"),
                },
                {
                  value: "number",
                  label: t("graph.node.log.segmentNumber"),
                  description: t("graph.node.log.segmentNumberDescription"),
                },
              ]}
              onValueChange={(value) => {
                const next = [...control.segmentKinds];
                next[index] = value === "number" ? "number" : "text";
                commitNodeProperty(data.nodeId, "segmentKinds", next);
              }}
            />
            {control.segmentKinds.length <= 1 ? null : (
              <button
                type="button"
                aria-label={t("graph.node.log.removeSegment")}
                title={t("graph.node.log.removeSegment")}
                onClick={() =>
                  commitNodeProperty(
                    data.nodeId,
                    "segmentKinds",
                    control.segmentKinds.filter(
                      (_, candidate) => candidate !== index,
                    ),
                  )
                }
              >
                <ProductIcon icon="action.close" size="small" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={!control.canAdd}
        onClick={() =>
          commitNodeProperty(data.nodeId, "segmentKinds", [
            ...control.segmentKinds,
            "text",
          ])
        }
      >
        <ProductIcon icon="action.add" size="small" />
        {t("graph.node.log.addSegment")}
      </button>
      <label>
        <input
          type="checkbox"
          checked={control.appendNewline}
          onChange={(event) =>
            commitNodeProperty(
              data.nodeId,
              "appendNewline",
              event.target.checked,
            )
          }
        />
        <span>{t("graph.node.log.appendNewline")}</span>
      </label>
    </section>
  );
}

function CoordinatePickBody({ data }: { data: CanvasNodeData }) {
  const { t } = useTranslation();
  const clickPointMode =
    data.typeKey === "automation.clickPoint"
      ? data.propertyFields?.find((field) => field.propertyKey === "inputMode")
          ?.value
      : undefined;
  if (
    data.typeKey !== "core.geometry.point" &&
    data.typeKey !== "core.geometry.rectangle" &&
    data.typeKey !== "automation.clickPoint"
  ) {
    return null;
  }
  if (
    data.typeKey === "automation.clickPoint" &&
    clickPointMode !== "coordinates"
  ) {
    return null;
  }
  return (
    <button
      type="button"
      className="rino-node__coordinate-pick nodrag nopan"
      onClick={() => focusCoordinateNode(data.graphId, data.nodeId)}
    >
      <ProductIcon icon="node.coordinate" size="small" />
      {t("graph.node.quickPick")}
    </button>
  );
}

function RecognitionDelayFields({
  groupId,
  parameters,
}: {
  groupId: string;
  parameters: {
    delayMilliseconds: number;
    delayMode: RecognitionDelayMode;
    canDelayClick: boolean;
  };
}) {
  const { t } = useTranslation();
  return (
    <div className="rino-recognition-delay">
      {parameters.canDelayClick ? (
        <label className="rino-workflow-parameter">
          <DescribedLabel
            label={t("workflowGroup.recognition.delayMode")}
            description={t("workflowGroup.recognition.delayModeDescription")}
          />
          <Select
            value={parameters.delayMode}
            options={[
              {
                value: "beforeRecognition",
                label: t("workflowGroup.recognition.delayBeforeRecognition"),
                description: t(
                  "workflowGroup.recognition.delayBeforeRecognitionDescription",
                ),
              },
              {
                value: "beforeClick",
                label: t("workflowGroup.recognition.delayBeforeClick"),
                description: t(
                  "workflowGroup.recognition.delayBeforeClickDescription",
                ),
              },
            ]}
            onValueChange={(value) =>
              setRecognitionDelayMode(groupId, value as RecognitionDelayMode)
            }
          />
        </label>
      ) : null}
      <label className="rino-workflow-parameter">
        <DescribedLabel
          label={t("workflowGroup.recognition.delayMilliseconds")}
          description={t(
            "workflowGroup.recognition.delayMillisecondsDescription",
          )}
        />
        <input
          key={parameters.delayMilliseconds}
          type="number"
          min={0}
          max={MAXIMUM_TEXT_RECOGNITION_DELAY_MILLISECONDS}
          step={1}
          defaultValue={parameters.delayMilliseconds}
          onBlur={(event) =>
            setRecognitionDelay(groupId, Number(event.target.value))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>
    </div>
  );
}

function ParameterContextMenu({
  groupId,
  role,
  children,
}: {
  groupId: string;
  role:
    | "templateAsset"
    | "roi"
    | "clickPoint"
    | "beforeDelay"
    | "afterDelay"
    | "delay"
    | "recognizer";
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => revealWorkflowGroupParameter(groupId, role)}
        >
          <ProductIcon icon="action.expandLeft" size="small" />
          {t("workflowGroup.actions.revealParameterNode")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TextRecognitionParameterFields({
  groupId,
  clickMethod,
  parameters,
}: {
  groupId: string;
  clickMethod: TextRecognitionClickMethod;
  parameters: NonNullable<
    NonNullable<CanvasNodeData["workflowGroup"]>["textRecognitionParameters"]
  >;
}) {
  const { t } = useTranslation();
  const region = parameters.region;
  const point = parameters.clickPoint;
  const commitInteger = (
    rawValue: string,
    commit: (value: number) => boolean,
  ) => {
    const value = Number(rawValue);
    if (Number.isInteger(value)) {
      commit(value);
    }
  };

  return (
    <div className="rino-workflow-parameters nodrag nopan">
      <RecognitionDelayFields groupId={groupId} parameters={parameters} />

      <ParameterContextMenu groupId={groupId} role="recognizer">
        <label className="rino-workflow-parameter">
          <DescribedLabel
            label={t("workflowGroup.textRecognition.confidenceThreshold")}
            description={t(
              "workflowGroup.textRecognition.confidenceThresholdDescription",
            )}
          />
          <input
            key={`confidence:${parameters.confidenceThreshold.toString()}`}
            type="number"
            min={0}
            max={1}
            step={0.05}
            defaultValue={parameters.confidenceThreshold}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                setTextRecognitionConfidence(groupId, value);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
      </ParameterContextMenu>

      {region === undefined ? null : (
        <ParameterContextMenu groupId={groupId} role="roi">
          <fieldset className="rino-workflow-region">
            <legend>
              <label>
                <input
                  type="checkbox"
                  checked={region.enabled}
                  onChange={(event) => {
                    setTextRecognitionRegionEnabled(
                      groupId,
                      event.target.checked,
                    );
                  }}
                />
                <DescribedLabel
                  label={t("workflowGroup.textRecognition.region")}
                  description={t(
                    "workflowGroup.textRecognition.regionDescription",
                  )}
                />
              </label>
              <button
                type="button"
                className="nodrag nopan"
                onClick={() => focusTextRecognitionParameter(groupId, "roi")}
              >
                <ProductIcon icon="node.coordinate" size="small" />
                {t("workflowGroup.textRecognition.pickRegion")}
              </button>
            </legend>
            <details className="rino-workflow-region__details">
              <summary>{t("workflowGroup.coordinateDetails")}</summary>
              <div className="rino-workflow-region__grid">
                {(
                  [
                    "x",
                    "y",
                    "width",
                    "height",
                    "referenceWidth",
                    "referenceHeight",
                  ] as const
                ).map((field) => (
                  <label key={field}>
                    <span>
                      {t(`workflowGroup.textRecognition.regionField.${field}`)}
                    </span>
                    <input
                      key={`${field}:${region[field].toString()}`}
                      type="number"
                      min={field === "x" || field === "y" ? 0 : 1}
                      max={16_384}
                      step={1}
                      defaultValue={region[field]}
                      disabled={!region.enabled}
                      onBlur={(event) => {
                        commitInteger(event.target.value, (value) =>
                          setTextRecognitionRegion(groupId, {
                            ...region,
                            [field]: value,
                          }),
                        );
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </label>
                ))}
              </div>
            </details>
          </fieldset>
        </ParameterContextMenu>
      )}

      {clickMethod !== "point" || point === undefined ? null : (
        <ParameterContextMenu groupId={groupId} role="clickPoint">
          <fieldset className="rino-workflow-region">
            <legend>
              <DescribedLabel
                label={t("workflowGroup.textRecognition.clickPoint")}
                description={t(
                  "workflowGroup.textRecognition.clickPointDescription",
                )}
              />
              <button
                type="button"
                className="nodrag nopan"
                onClick={() =>
                  focusTextRecognitionParameter(groupId, "clickPoint")
                }
              >
                <ProductIcon icon="node.coordinate" size="small" />
                {t("workflowGroup.textRecognition.pickPoint")}
              </button>
            </legend>
            <details className="rino-workflow-region__details">
              <summary>{t("workflowGroup.coordinateDetails")}</summary>
              <div className="rino-workflow-region__grid">
                {(["x", "y", "referenceWidth", "referenceHeight"] as const).map(
                  (field) => (
                    <label key={field}>
                      <span>
                        {t(`workflowGroup.textRecognition.pointField.${field}`)}
                      </span>
                      <input
                        key={`${field}:${point[field].toString()}`}
                        type="number"
                        min={field === "x" || field === "y" ? 0 : 1}
                        max={16_384}
                        step={1}
                        defaultValue={point[field]}
                        onBlur={(event) => {
                          commitInteger(event.target.value, (value) =>
                            setTextRecognitionClickPoint(groupId, {
                              ...point,
                              [field]: value,
                            }),
                          );
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </label>
                  ),
                )}
              </div>
            </details>
          </fieldset>
        </ParameterContextMenu>
      )}
    </div>
  );
}

function prioritizeContinuationOutput(
  outputs: readonly CanvasPortView[],
): readonly CanvasPortView[] {
  const continuationIndex = outputs.findIndex((port) => port.portId === "next");
  if (continuationIndex <= 0) {
    return outputs;
  }
  const continuation = outputs[continuationIndex];
  if (continuation === undefined) {
    return outputs;
  }
  return [
    continuation,
    ...outputs.slice(0, continuationIndex),
    ...outputs.slice(continuationIndex + 1),
  ];
}

function NodePortSection({
  inputs,
  outputs,
  nodeTitle,
  kind,
  portActions,
  portRowActions,
  inputPortRowActions,
}: {
  inputs: readonly CanvasPortView[];
  outputs: readonly CanvasPortView[];
  nodeTitle: string;
  kind: "execution" | "data";
  portActions?: ReactNode;
  portRowActions?: (port: CanvasPortView) => ReactNode;
  inputPortRowActions?: (port: CanvasPortView) => ReactNode;
}) {
  if (inputs.length === 0 && outputs.length === 0 && !portActions) {
    return null;
  }
  const orderedOutputs =
    kind === "execution" ? prioritizeContinuationOutput(outputs) : outputs;
  const sideOutputs = orderedOutputs.filter(
    (port) =>
      port.shape !== "collection" && port.shape !== "optionalCollection",
  );
  const collectionOutputs = orderedOutputs.filter(
    (port) =>
      port.shape === "collection" || port.shape === "optionalCollection",
  );
  return (
    <div
      className="rino-node__ports"
      data-port-section={kind}
      data-has-inputs={inputs.length > 0 ? "true" : undefined}
    >
      {inputs.length === 0 ? null : (
        <div className="rino-node__column">
          {inputs.map((port) => (
            <MemoizedNodePortRow
              key={port.portId}
              port={port}
              side="input"
              nodeTitle={nodeTitle}
              actions={inputPortRowActions?.(port)}
            />
          ))}
        </div>
      )}
      <div className="rino-node__column rino-node__column--outputs">
        {sideOutputs.map((port) => (
          <MemoizedNodePortRow
            key={port.portId}
            port={port}
            side="output"
            nodeTitle={nodeTitle}
            actions={portRowActions?.(port)}
          />
        ))}
        {portActions ? (
          <div className="rino-node__port-actions">{portActions}</div>
        ) : null}
      </div>
      {collectionOutputs.length === 0 ? null : (
        <div className="rino-node__collection-outputs">
          {collectionOutputs.map((port) => (
            <MemoizedNodePortRow
              key={port.portId}
              port={port}
              side="output"
              nodeTitle={nodeTitle}
              actions={portRowActions?.(port)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionItemRemoveAction({
  data,
  port,
}: {
  data: CanvasNodeData;
  port: CanvasPortView;
}) {
  const { t } = useTranslation();
  const control = data.dynamicPortControl;
  if (
    control?.kind !== "collectionItem" ||
    control.count <= 1 ||
    port.portId !== `item${String(control.count)}`
  ) {
    return null;
  }
  const removeLabel = t("graph.node.dynamic.removeItem", {
    item: control.count,
  });
  return (
    <button
      type="button"
      className="rino-node__dynamic-remove nodrag nopan"
      aria-label={removeLabel}
      title={removeLabel}
      onClick={(event) => {
        event.stopPropagation();
        if (!removeDynamicPort(data.graphId, data.nodeId)) {
          notify({
            severity: "error",
            titleKey: "graph.node.dynamic.removeFailed",
          });
        }
      }}
    >
      <ProductIcon icon="action.close" size="small" />
    </button>
  );
}

function ImageRecognitionParameterFields({
  groupId,
  method,
  parameters,
}: {
  groupId: string;
  method: ImageRecognitionMethod;
  parameters: NonNullable<
    NonNullable<CanvasNodeData["workflowGroup"]>["imageRecognitionParameters"]
  >;
}) {
  const { t } = useTranslation();
  const document = useActiveDocument();
  const assets = document?.assets ?? [];
  const region = parameters.region;
  const templateRequired = method !== "color";
  const commitRegionField = (field: keyof typeof region, rawValue: string) => {
    const value = Number(rawValue);
    if (Number.isInteger(value)) {
      setImageRecognitionRegion(groupId, { ...region, [field]: value });
    }
  };

  return (
    <div className="rino-workflow-parameters nodrag nopan">
      <RecognitionDelayFields groupId={groupId} parameters={parameters} />
      <ParameterContextMenu groupId={groupId} role="templateAsset">
        <label className="rino-workflow-parameter">
          <DescribedLabel
            label={t("workflowGroup.imageRecognition.templateAsset")}
            description={t(
              "workflowGroup.imageRecognition.templateAssetDescription",
            )}
          />
          <Select
            value={parameters.templateAssetId ?? ""}
            disabled={!templateRequired}
            aria-required={templateRequired}
            placeholder={t(
              "workflowGroup.imageRecognition.templatePlaceholder",
            )}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            options={assets.map((asset) => ({
              value: asset.assetId,
              label: `${visibleAssetDisplayName(asset.displayName)} (${asset.coordinateSpace.width.toString()}×${asset.coordinateSpace.height.toString()})`,
            }))}
            onValueChange={(assetId) => {
              setImageRecognitionTemplateAsset(groupId, assetId);
            }}
          />
          {!templateRequired ? (
            <small>{t("workflowGroup.imageRecognition.templateNotUsed")}</small>
          ) : assets.length === 0 ? (
            <small>
              {t("workflowGroup.imageRecognition.noTemplateAssets")}
            </small>
          ) : null}
        </label>
      </ParameterContextMenu>

      {method === "template" ? (
        <ParameterContextMenu groupId={groupId} role="recognizer">
          <label className="rino-workflow-parameter">
            <DescribedLabel
              label={t("workflowGroup.imageRecognition.matchThreshold")}
              description={t(
                "workflowGroup.imageRecognition.matchThresholdDescription",
              )}
            />
            <input
              key={`threshold:${parameters.matchThreshold.toString()}`}
              type="number"
              min={0}
              max={1}
              step={0.05}
              defaultValue={parameters.matchThreshold}
              onBlur={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) {
                  setImageRecognitionThreshold(groupId, value);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        </ParameterContextMenu>
      ) : null}

      <ParameterContextMenu groupId={groupId} role="roi">
        <fieldset className="rino-workflow-region">
          <legend>
            <label>
              <input
                type="checkbox"
                checked={parameters.regionEnabled}
                onChange={(event) => {
                  setImageRecognitionRegionEnabled(
                    groupId,
                    event.target.checked,
                  );
                }}
              />
              <DescribedLabel
                label={t("workflowGroup.imageRecognition.region")}
                description={t(
                  "workflowGroup.imageRecognition.regionDescription",
                )}
              />
            </label>
            <button
              type="button"
              className="nodrag nopan"
              onClick={() => focusImageRecognitionRegion(groupId)}
            >
              <ProductIcon icon="node.coordinate" size="small" />
              {t("workflowGroup.imageRecognition.pickRegion")}
            </button>
          </legend>
          <details className="rino-workflow-region__details">
            <summary>{t("workflowGroup.coordinateDetails")}</summary>
            <div className="rino-workflow-region__grid">
              {(
                [
                  "x",
                  "y",
                  "width",
                  "height",
                  "referenceWidth",
                  "referenceHeight",
                ] as const
              ).map((field) => (
                <label key={field}>
                  <span>
                    {t(`workflowGroup.imageRecognition.regionField.${field}`)}
                  </span>
                  <input
                    key={`${field}:${region[field].toString()}`}
                    type="number"
                    min={field === "x" || field === "y" ? 0 : 1}
                    max={16_384}
                    step={1}
                    defaultValue={region[field]}
                    disabled={!parameters.regionEnabled}
                    onBlur={(event) => {
                      commitRegionField(field, event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </label>
              ))}
            </div>
          </details>
        </fieldset>
      </ParameterContextMenu>
    </div>
  );
}

function RinoNodeViewComponent(props: NodeProps<RinoFlowNode>) {
  if (props.data.repeatHint !== undefined) {
    return <RepeatHintNodeView {...props} />;
  }
  return <StandardRinoNodeView {...props} />;
}

function StandardRinoNodeView({
  data,
  selected,
  height,
}: NodeProps<RinoFlowNode>) {
  const { i18n, t } = useTranslation();
  const language = i18n.language;
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasDraft, setAliasDraft] = useState("");
  // The selector changes only when zoom crosses the semantic-detail threshold. Panning
  // and zoom frames within one tier therefore never re-render every node.
  const showNodeDetails = useStore(
    (store) => store.transform[2] >= FULL_NODE_DETAIL_MINIMUM_ZOOM,
  );
  const execution = useNodeExecutionView(
    data.graphId,
    data.workflowGroup === undefined ? data.nodeId : "",
  );

  // Memoized because a node header is drawn hundreds of times in a large graph and the
  // second name costs a lookup in every display language.
  const { title, secondaryTitle } = useMemo(() => {
    const resolved = data.unresolved
      ? {
          title: t("graph.node.unresolvedTitle", { typeKey: data.typeKey }),
          secondaryTitle: undefined,
        }
      : resolveBilingualTitle(t, i18n, language, data.titleKey, data.typeKey);
    return data.titleOverride === undefined
      ? resolved
      : { title: data.titleOverride, secondaryTitle: resolved.title };
  }, [
    data.titleKey,
    data.titleOverride,
    data.typeKey,
    data.unresolved,
    i18n,
    language,
    t,
  ]);
  const { executionInputs, executionOutputs, dataInputs, dataOutputs } =
    useMemo(
      () => ({
        executionInputs: data.inputs.filter(
          (port) => port.portKind === "execution",
        ),
        executionOutputs: data.outputs.filter(
          (port) => port.portKind === "execution",
        ),
        dataInputs: data.inputs.filter((port) => port.portKind === "data"),
        dataOutputs: data.outputs.filter((port) => port.portKind === "data"),
      }),
      [data.inputs, data.outputs],
    );
  const aliasTargetNodeId = data.workflowGroup?.steps[0]?.nodeId ?? data.nodeId;
  const floatingAlias = shouldFloatDisplayAlias(data.displayAlias);
  const overviewAlias =
    data.displayAlias ?? data.variableControl?.selectedVariableName;

  const beginAliasEditing = () => {
    setAliasDraft(data.displayAlias ?? "");
    setEditingAlias(true);
  };
  const finishAliasEditing = () => {
    if (commitDisplayAlias(aliasTargetNodeId, aliasDraft)) {
      setEditingAlias(false);
    }
  };

  if (!showNodeDetails) {
    const measuredHeight =
      typeof height === "number" && height > 0
        ? height
        : estimateNodeHeight(data);
    const overviewLabel =
      overviewAlias === undefined ? title : `${title}，${overviewAlias}`;

    return (
      <div
        className="rino-node"
        data-category={data.category}
        data-detail="overview"
        data-selected={selected ? "true" : undefined}
        data-disabled={data.disabled ? "true" : undefined}
        data-unresolved={data.unresolved ? "true" : undefined}
        data-runtime={execution?.state}
        data-workflow-group={data.workflowGroup?.kind}
        data-type-key={data.typeKey}
        style={{ height: `${String(measuredHeight)}px` }}
        aria-label={overviewLabel}
      >
        <OverviewNodeHandles inputs={data.inputs} outputs={data.outputs} />
        <header className="rino-node__header">
          <span className="rino-node__overview-names">
            <span className="rino-node__overview-title" title={title}>
              {title}
            </span>
            {overviewAlias === undefined ? null : (
              <span className="rino-node__overview-alias" title={overviewAlias}>
                {overviewAlias}
              </span>
            )}
          </span>
        </header>
      </div>
    );
  }

  return (
    <div
      className="rino-node"
      data-category={data.category}
      data-selected={selected ? "true" : undefined}
      data-disabled={data.disabled ? "true" : undefined}
      data-unresolved={data.unresolved ? "true" : undefined}
      data-runtime={execution?.state}
      data-workflow-group={data.workflowGroup?.kind}
      data-type-key={data.typeKey}
    >
      {!floatingAlias || data.displayAlias === undefined ? null : (
        <aside
          className="rino-node__floating-alias"
          aria-label={t("graph.node.longAliasLabel")}
        >
          {data.displayAlias}
        </aside>
      )}
      <header className="rino-node__header">
        <ProductIcon
          icon={resolveProductIcon(data.iconKey, "category.flow")}
          size="small"
          className="rino-node__icon"
        />
        {/* The node's own name in both display languages, the second line kept because
            node type keys and automation documentation are written in English. */}
        <span
          className="rino-node__names"
          role={editingAlias ? undefined : "button"}
          tabIndex={editingAlias ? -1 : 0}
          aria-label={
            editingAlias
              ? undefined
              : t("graph.node.aliasEditHint", { node: title })
          }
          title={t("graph.node.aliasEditHint", { node: title })}
          onDoubleClick={(event) => {
            event.stopPropagation();
            beginAliasEditing();
          }}
          onKeyDown={(event) => {
            if (
              !editingAlias &&
              (event.key === "Enter" || event.key === "F2")
            ) {
              event.preventDefault();
              event.stopPropagation();
              beginAliasEditing();
            }
          }}
        >
          <span className="rino-node__primary-title-line">
            <span className="rino-node__title" title={title}>
              {title}
            </span>
            {editingAlias ? (
              <input
                className="rino-node__alias-input nodrag nopan nowheel"
                aria-label={t("graph.node.aliasInputLabel", { node: title })}
                placeholder={t("graph.node.aliasPlaceholder")}
                maxLength={MAXIMUM_DISPLAY_ALIAS_LENGTH}
                value={aliasDraft}
                autoFocus
                onChange={(event) => {
                  setAliasDraft(event.target.value);
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                }}
                onBlur={finishAliasEditing}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    finishAliasEditing();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingAlias(false);
                  }
                }}
              />
            ) : data.displayAlias === undefined || floatingAlias ? null : (
              <span className="rino-node__alias" title={data.displayAlias}>
                {data.displayAlias}
              </span>
            )}
            {data.displayAlias !== undefined ? null : data.variableControl
                ?.selectedVariableName !== undefined ? (
              <span
                className="rino-node__alias"
                title={data.variableControl.selectedVariableName}
              >
                {data.variableControl.selectedVariableName}
              </span>
            ) : data.variableControl?.variableMissing === true ? (
              <span className="rino-node__alias">
                {t("graph.variable.missing")}
              </span>
            ) : null}
          </span>
          {secondaryTitle === undefined ? null : (
            <span className="rino-node__secondary-title" title={secondaryTitle}>
              {secondaryTitle}
            </span>
          )}
        </span>
        {data.breakpoint ? (
          <ProductIcon
            icon="panel.breakpoints"
            size="small"
            label={t("graph.node.breakpoint")}
            className="rino-node__marker rino-node__marker--breakpoint"
          />
        ) : null}
        {execution === undefined ? null : (
          <span
            className="rino-node__runtime-state"
            title={t(`graph.node.runtime.${execution.state}`)}
          >
            <span className="rino-node__sequence font-code">
              {execution.runSequence}
            </span>
            <ProductIcon
              icon={`runtime.${execution.state}`}
              size="small"
              label={t(`graph.node.runtime.${execution.state}`)}
              className="rino-node__marker rino-node__marker--runtime"
            />
          </span>
        )}
        {data.disabled ? (
          <ProductIcon
            icon="runtime.disabled"
            size="small"
            label={t("graph.node.disabled")}
            className="rino-node__marker rino-node__marker--disabled"
          />
        ) : null}
        {data.workflowGroupControl === undefined ||
        data.workflowGroup !== undefined ? null : (
          <button
            type="button"
            className="rino-node__group-toggle nodrag nopan"
            aria-label={t(
              data.workflowGroupControl.expanded
                ? "workflowGroup.actions.collapse"
                : "workflowGroup.actions.expand",
            )}
            title={t(
              data.workflowGroupControl.expanded
                ? "workflowGroup.actions.collapse"
                : "workflowGroup.actions.expand",
            )}
            onClick={(event) => {
              event.stopPropagation();
              setWorkflowGroupCollapsed(
                data.workflowGroupControl?.groupId ?? "",
                data.workflowGroupControl?.expanded === true,
              );
            }}
          >
            <ProductIcon
              icon={
                data.workflowGroupControl.expanded
                  ? "action.collapseLeft"
                  : "action.expandLeft"
              }
              size="small"
            />
          </button>
        )}
      </header>

      {data.unresolved ? (
        <p className="rino-node__notice">
          {t("graph.node.unresolvedDescription")}
        </p>
      ) : (
        <>
          <NodePortSection
            inputs={executionInputs}
            outputs={executionOutputs}
            nodeTitle={title}
            kind="execution"
            portRowActions={(port) => (
              <SequenceStepRowActions data={data} port={port} />
            )}
            portActions={
              data.sequenceControl?.kind ===
              "sequenceOrder" ? null : data.sequenceControl === undefined &&
                data.dynamicPortControl?.kind !== "parallelBranch" ? null : (
                <button
                  type="button"
                  className="rino-node__add-step nodrag nopan"
                  disabled={
                    data.sequenceControl?.canAdd === false ||
                    data.dynamicPortControl?.canAdd === false
                  }
                  aria-label={t(
                    data.sequenceControl === undefined
                      ? "graph.node.dynamic.addBranch"
                      : "graph.node.sequence.addStep",
                  )}
                  title={
                    data.sequenceControl?.canAdd === true ||
                    data.dynamicPortControl?.canAdd === true
                      ? t(
                          data.sequenceControl === undefined
                            ? "graph.node.dynamic.addBranch"
                            : "graph.node.sequence.addStep",
                        )
                      : t("graph.node.sequence.stepLimit", {
                          count:
                            data.sequenceControl?.stepCount ??
                            data.dynamicPortControl?.count ??
                            0,
                        })
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    const added =
                      data.sequenceControl === undefined
                        ? addDynamicPort(data.graphId, data.nodeId)
                        : addSequenceStep(data.graphId, data.nodeId);
                    if (!added) {
                      notify({
                        severity: "error",
                        titleKey:
                          data.sequenceControl === undefined
                            ? "graph.node.dynamic.addFailed"
                            : "graph.node.sequence.addStepFailed",
                      });
                    }
                  }}
                >
                  <ProductIcon icon="action.add" size="small" />
                  <span>
                    {t(
                      data.sequenceControl === undefined
                        ? "graph.node.dynamic.addBranch"
                        : "graph.node.sequence.addStep",
                    )}
                  </span>
                </button>
              )
            }
          />
          <NodePropertyBody data={data} />
          <VariableControlBody data={data} />
          <LogControlBody data={data} />
          <CoordinatePickBody data={data} />
          <SequenceOrderBody data={data} />
          {data.workflowGroup === undefined ? (
            <NodePortSection
              inputs={dataInputs}
              outputs={dataOutputs}
              nodeTitle={title}
              kind="data"
              inputPortRowActions={(port) => (
                <CollectionItemRemoveAction data={data} port={port} />
              )}
              portActions={
                data.typeKey === "core.flow.sequenceOrder" ? (
                  <button
                    type="button"
                    className="rino-node__add-step nodrag nopan"
                    disabled={!data.sequenceControl?.canAdd}
                    aria-label={t("graph.node.sequence.addStep")}
                    title={
                      data.sequenceControl?.canAdd === true
                        ? t("graph.node.sequence.addStep")
                        : t("graph.node.sequence.stepLimit", {
                            count: data.sequenceControl?.stepCount ?? 0,
                          })
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!addSequenceStep(data.graphId, data.nodeId)) {
                        notify({
                          severity: "error",
                          titleKey: "graph.node.sequence.addStepFailed",
                        });
                      }
                    }}
                  >
                    <ProductIcon icon="action.add" size="small" />
                    <span>{t("graph.node.sequence.addStep")}</span>
                  </button>
                ) : data.dynamicPortControl?.kind !== "numericInput" &&
                  data.dynamicPortControl?.kind !== "collectionItem" ? null : (
                  <button
                    type="button"
                    className="rino-node__add-step nodrag nopan"
                    disabled={!data.dynamicPortControl.canAdd}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!addDynamicPort(data.graphId, data.nodeId)) {
                        notify({
                          severity: "error",
                          titleKey: "graph.node.dynamic.addFailed",
                        });
                      }
                    }}
                  >
                    <ProductIcon icon="action.add" size="small" />
                    <span>
                      {t(
                        data.typeKey === "core.collection.imageList"
                          ? "graph.node.dynamic.addImage"
                          : data.typeKey === "core.collection.regionList"
                            ? "graph.node.dynamic.addRegion"
                            : data.typeKey === "core.collection.pointList"
                              ? "graph.node.dynamic.addPoint"
                              : "graph.node.dynamic.addInput",
                      )}
                    </span>
                  </button>
                )
              }
            />
          ) : (
            <div className="rino-node__workflow-body">
              <WorkflowGroupBody data={data} />
              <NodePortSection
                inputs={dataInputs}
                outputs={dataOutputs}
                nodeTitle={title}
                kind="data"
              />
            </div>
          )}
          {data.typeKey === "automation.touchAction" ? (
            <TouchActionBody data={data} />
          ) : null}
        </>
      )}
    </div>
  );
}

/** Memoized so a change to one node, or to the viewport, does not re-render every node on
 * the canvas. The projection keeps `data` referentially stable for unchanged nodes, which
 * is what makes this memo effective. */
export const RinoNodeView = memo(RinoNodeViewComponent);
