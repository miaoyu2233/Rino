import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";

import { mergeClassNames } from "./class-names";

export function Tabs(props: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root {...props} />;
}

export function TabsList({
  className,
  ...listProps
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      {...listProps}
      className={mergeClassNames("ui-tabs__list", className)}
    />
  );
}

export function TabsTrigger({
  className,
  ...triggerProps
}: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      {...triggerProps}
      className={mergeClassNames("ui-tabs__trigger", className)}
    />
  );
}

export function TabsContent({
  className,
  ...contentProps
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      {...contentProps}
      className={mergeClassNames("ui-tabs__content", className)}
    />
  );
}
