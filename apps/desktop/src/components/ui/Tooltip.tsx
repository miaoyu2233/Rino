import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

import { mergeClassNames } from "./class-names";

export interface TooltipProviderProps {
  children: ReactNode;
}

export function TooltipProvider({ children }: TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={500} skipDelayDuration={250}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  contentClassName?: string;
  side?: "top" | "right" | "bottom" | "left";
}

export function Tooltip({
  children,
  content,
  contentClassName,
  side = "bottom",
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className={mergeClassNames("ui-tooltip", contentClassName)}
          side={side}
          sideOffset={8}
          collisionPadding={12}
        >
          {content}
          <TooltipPrimitive.Arrow className="ui-tooltip__arrow" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
