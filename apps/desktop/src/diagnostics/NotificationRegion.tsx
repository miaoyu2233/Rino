import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ProductIcon } from "../design-system/icons/ProductIcon";
import type { ProductIconKey } from "../design-system/icons/product-icons";
import { motionTransitions } from "../design-system/motion";
import { IconAction } from "../app-shell/IconAction";
import {
  NOTIFICATION_LIFETIME_MS,
  type DiagnosticSeverity,
  type TransientNotification,
} from "./diagnostic-model";
import { useDiagnosticStore } from "./diagnostic-store";
import { translateDiagnostic } from "./translate-diagnostic";

const SEVERITY_ICONS: Record<DiagnosticSeverity, ProductIconKey> = {
  error: "runtime.failed",
  warning: "runtime.warning",
  info: "runtime.idle",
};

function NotificationCard({
  notification,
  onDismiss,
}: {
  notification: TransientNotification;
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onDismiss(notification.id);
    }, NOTIFICATION_LIFETIME_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notification.id, onDismiss]);

  return (
    <motion.li
      className={`notification notification--${notification.severity}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={motionTransitions.standard}
    >
      <span className="notification__icon" aria-hidden="true">
        <ProductIcon
          icon={SEVERITY_ICONS[notification.severity]}
          size="small"
        />
      </span>
      <span className="notification__message">
        {translateDiagnostic(t, notification.titleKey, notification.parameters)}
      </span>
      <IconAction
        icon="action.close"
        label={t("diagnostics.actions.dismiss")}
        onClick={() => {
          onDismiss(notification.id);
        }}
      />
    </motion.li>
  );
}

/** Transient outcomes only.
 *
 * Anything that needs the user to act, or that they may need to consult later, belongs in
 * the Problems surface instead, because this region disappears on its own.
 */
export function NotificationRegion() {
  const { t } = useTranslation();
  const notifications = useDiagnosticStore((state) => state.notifications);
  const dismissNotification = useDiagnosticStore(
    (state) => state.dismissNotification,
  );

  return (
    <ul
      className="notification-region"
      aria-label={t("diagnostics.notifications.regionLabel")}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {notifications.map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            onDismiss={dismissNotification}
          />
        ))}
      </AnimatePresence>
    </ul>
  );
}
