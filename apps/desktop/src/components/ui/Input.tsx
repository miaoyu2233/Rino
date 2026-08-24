import { forwardRef, type InputHTMLAttributes } from "react";

import { mergeClassNames } from "./class-names";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...inputProps }, ref) {
  return (
    <input
      {...inputProps}
      ref={ref}
      className={mergeClassNames("ui-input", className)}
    />
  );
});
