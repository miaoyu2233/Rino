import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import { mergeClassNames } from "./class-names";

export function ContextMenu(
  props: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Root>,
) {
  return <ContextMenuPrimitive.Root {...props} />;
}

export function ContextMenuTrigger(
  props: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Trigger>,
) {
  return <ContextMenuPrimitive.Trigger {...props} />;
}

export const ContextMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(function ContextMenuSeparator({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Separator
      {...props}
      ref={ref}
      className={mergeClassNames("ui-menu__separator", className)}
    />
  );
});

export const ContextMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(function ContextMenuContent({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        {...props}
        ref={ref}
        className={mergeClassNames("ui-menu", className)}
        collisionPadding={12}
      />
    </ContextMenuPrimitive.Portal>
  );
});

export const ContextMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(function ContextMenuItem({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Item
      {...props}
      ref={ref}
      className={mergeClassNames("ui-menu__item", className)}
    />
  );
});

export const ContextMenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(function ContextMenuLabel({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Label
      {...props}
      ref={ref}
      className={mergeClassNames("ui-menu__label", className)}
    />
  );
});

export interface ContextSubMenuProps {
  label: ReactNode;
  children: ReactNode;
  disabled?: boolean;
}

/** One level of a hierarchical menu.
 *
 * Kept as a composed pair so a caller writes the label and its items together and cannot
 * accidentally render a sub-trigger without its content.
 */
export function ContextSubMenu({
  label,
  children,
  disabled = false,
}: ContextSubMenuProps) {
  return (
    <ContextMenuPrimitive.Sub>
      <ContextMenuPrimitive.SubTrigger
        className="ui-menu__item ui-menu__item--submenu"
        disabled={disabled}
      >
        {label}
      </ContextMenuPrimitive.SubTrigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.SubContent
          className="ui-menu"
          collisionPadding={12}
          sideOffset={2}
        >
          {children}
        </ContextMenuPrimitive.SubContent>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Sub>
  );
}
