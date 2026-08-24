import type { ReactNode } from "react";

import { Tooltip } from "../../components/ui/Tooltip";

interface DescribedLabelProps {
  label: ReactNode;
  description: string | undefined;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}

/** A compact label that keeps the short product wording visible and reveals supplementary
 * help on hover or keyboard focus. The label remains a non-actionable focus target: it
 * never steals the input control's click or selection behavior. */
export function DescribedLabel({
  label,
  description,
  className,
  side = "right",
}: DescribedLabelProps) {
  if (description === undefined || description.trim().length === 0) {
    return <span className={className}>{label}</span>;
  }

  return (
    <Tooltip
      side={side}
      content={
        <span className="rino-described-label__content">{description}</span>
      }
    >
      <span className={className} tabIndex={0} data-described-label="true">
        {label}
      </span>
    </Tooltip>
  );
}
