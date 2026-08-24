import type { ReactNode } from "react";

import type { ProductIconKey } from "../design-system/icons/product-icons";
import { ProductIcon } from "../design-system/icons/ProductIcon";

export interface EmptyStateProps {
  description: string;
  icon: ProductIconKey;
  title: string;
  /** Optional recovery or next-step control, so an empty surface can offer a way out
   * instead of only describing the emptiness. */
  action?: ReactNode;
}

export function EmptyState({
  action,
  description,
  icon,
  title,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        <ProductIcon icon={icon} size="large" />
      </span>
      <strong className="empty-state__title">{title}</strong>
      <p className="empty-state__description">{description}</p>
      {action === undefined ? null : (
        <div className="empty-state__action">{action}</div>
      )}
    </div>
  );
}
