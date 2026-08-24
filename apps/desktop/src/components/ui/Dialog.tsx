import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";

import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { motionTransitions } from "../../design-system/motion";
import { mergeClassNames } from "./class-names";

export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />;
}

export function DialogTrigger(
  props: ComponentProps<typeof DialogPrimitive.Trigger>,
) {
  return <DialogPrimitive.Trigger {...props} />;
}

export interface DialogContentProps extends Omit<
  ComponentProps<typeof DialogPrimitive.Content>,
  "title"
> {
  children: ReactNode;
  closeLabel: string;
  description?: string;
  title: string;
}

export function DialogContent({
  children,
  className,
  closeLabel,
  description,
  title,
  ...contentProps
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay asChild>
        <motion.div
          className="ui-dialog__overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={motionTransitions.standard}
        />
      </DialogPrimitive.Overlay>
      <DialogPrimitive.Content asChild {...contentProps}>
        <motion.section
          className={mergeClassNames("ui-dialog", className)}
          initial={{ opacity: 0, scale: 0.975, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={motionTransitions.panel}
        >
          <div className="ui-dialog__header">
            <div className="ui-dialog__heading">
              <DialogPrimitive.Title className="ui-dialog__title">
                {title}
              </DialogPrimitive.Title>
              {description === undefined ? null : (
                <DialogPrimitive.Description className="ui-dialog__description">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="ui-dialog__close"
                aria-label={closeLabel}
              >
                <ProductIcon icon="action.close" />
              </button>
            </DialogPrimitive.Close>
          </div>
          <div className="ui-dialog__body">{children}</div>
        </motion.section>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
