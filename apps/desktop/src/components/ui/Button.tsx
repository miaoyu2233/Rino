import { forwardRef, type ButtonHTMLAttributes } from "react";

import { mergeClassNames } from "./class-names";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "compact" | "standard" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      type = "button",
      variant = "secondary",
      size = "standard",
      ...buttonProps
    },
    ref,
  ) {
    return (
      <button
        {...buttonProps}
        ref={ref}
        type={type}
        className={mergeClassNames(
          "ui-button",
          `ui-button--${variant}`,
          `ui-button--${size}`,
          className,
        )}
      />
    );
  },
);
