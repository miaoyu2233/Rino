import type { MouseEventHandler, ReactNode } from "react";

import type { ProductIconKey } from "../design-system/icons/product-icons";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import { Button } from "../components/ui/Button";
import { Tooltip } from "../components/ui/Tooltip";

export interface IconActionProps {
  active?: boolean;
  disabled?: boolean;
  icon: ProductIconKey;
  label: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  shortcut?: string;
  tooltip?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
}

export function IconAction({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
  shortcut,
  tooltip = label,
  variant = "ghost",
}: IconActionProps) {
  const button = (
    <Button
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      size="icon"
      variant={active ? "secondary" : variant}
      onClick={onClick}
    >
      <ProductIcon icon={icon} />
    </Button>
  );

  const tooltipContent = shortcut ? (
    <span className="icon-action__tooltip">
      <span>{tooltip}</span>
      <kbd className="icon-action__kbd">{shortcut}</kbd>
    </span>
  ) : (
    tooltip
  );

  return (
    <Tooltip content={tooltipContent}>
      {disabled ? (
        <span
          className="icon-action__disabled-trigger"
          tabIndex={0}
          aria-label={label}
        >
          {button}
        </span>
      ) : (
        button
      )}
    </Tooltip>
  );
}
