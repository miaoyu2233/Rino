import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { mergeClassNames } from "./class-names";

export const ScrollArea = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(function ScrollArea({ children, className, ...rootProps }, ref) {
  return (
    <ScrollAreaPrimitive.Root
      {...rootProps}
      ref={ref}
      className={mergeClassNames("ui-scroll-area", className)}
    >
      <ScrollAreaPrimitive.Viewport className="ui-scroll-area__viewport">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        className="ui-scroll-area__scrollbar"
        orientation="vertical"
      >
        <ScrollAreaPrimitive.Thumb className="ui-scroll-area__thumb" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Scrollbar
        className="ui-scroll-area__scrollbar"
        orientation="horizontal"
      >
        <ScrollAreaPrimitive.Thumb className="ui-scroll-area__thumb" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner className="ui-scroll-area__corner" />
    </ScrollAreaPrimitive.Root>
  );
});
