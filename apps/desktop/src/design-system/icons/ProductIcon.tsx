import type { SVGProps } from "react";

import { productIcons, type ProductIconKey } from "./product-icons";

export type ProductIconSize = "small" | "standard" | "large";

export interface ProductIconProps extends Omit<
  SVGProps<SVGSVGElement>,
  "children"
> {
  icon: ProductIconKey;
  label?: string;
  size?: ProductIconSize;
}

export function ProductIcon({
  icon,
  label,
  size = "standard",
  className,
  ...svgProps
}: ProductIconProps) {
  const Icon = productIcons[icon];
  const classes = ["product-icon", `product-icon--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <Icon
      {...svgProps}
      className={classes}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      role={label === undefined ? undefined : "img"}
      strokeWidth={1.75}
      absoluteStrokeWidth
    />
  );
}
