import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { removeRepeatHintFromCanvas } from "../commands/workflow-group-commands";
import type { RinoFlowNode } from "./graph-view-model";

interface RepeatHintViewProps {
  graphId: string;
  hintId: string;
  edgeId: string;
  selected: boolean;
}

export function RepeatHintView({
  graphId,
  hintId,
  edgeId,
  selected,
}: RepeatHintViewProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className="rino-repeat-hint"
      data-selected={selected ? "true" : undefined}
      data-hint-id={hintId}
      data-edge-id={edgeId}
      tabIndex={0}
      aria-label={t("graph.repeatHint.title")}
    >
      <Handle
        id="repeat"
        type="target"
        position={Position.Left}
        className="rino-repeat-hint__handle"
        isConnectable={false}
        aria-label={t("graph.repeatHint.input")}
      />
      <div className="rino-repeat-hint__copy">
        <strong>{t("graph.repeatHint.title")}</strong>
        <span>{t("graph.repeatHint.description")}</span>
      </div>
      <button
        type="button"
        className="rino-repeat-hint__remove nodrag nopan"
        aria-label={t("graph.repeatHint.remove")}
        title={t("graph.repeatHint.remove")}
        onClick={(event) => {
          event.stopPropagation();
          removeRepeatHintFromCanvas(graphId, hintId, edgeId);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      >
        <ProductIcon icon="action.close" size="small" />
      </button>
    </div>
  );
}

export function RepeatHintNodeView({
  data,
  selected,
}: NodeProps<RinoFlowNode>): ReactElement | null {
  if (data.repeatHint === undefined) {
    return null;
  }
  return (
    <RepeatHintView
      graphId={data.graphId}
      hintId={data.repeatHint.hintId}
      edgeId={data.repeatHint.edgeId}
      selected={selected}
    />
  );
}

export const MemoizedRepeatHintView = memo(RepeatHintNodeView);
