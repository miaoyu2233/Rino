import { useTranslation } from "react-i18next";

import { Tooltip } from "../components/ui/Tooltip";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import type { ProductIconKey } from "../design-system/icons/product-icons";
import type { RuntimeState } from "../ipc/runtime-contract";
import { useRuntimeStore } from "../ipc/runtime-store";

const STATE_ICONS: Record<RuntimeState, ProductIconKey> = {
  stopped: "runtime.disabled",
  starting: "runtime.running",
  handshaking: "runtime.running",
  ready: "runtime.succeeded",
  degraded: "runtime.warning",
  restarting: "runtime.running",
  stopping: "runtime.running",
  failed: "runtime.failed",
};

/** The runtime lifecycle state, always visible in the top bar.
 *
 * The label is never hidden at narrow widths, and the icon is decorative, so the state
 * remains available to assistive technology rather than depending on the icon alone.
 */
export function RuntimeStatusIndicator() {
  const { t } = useTranslation();
  const availability = useRuntimeStore((store) => store.availability);
  const state = useRuntimeStore((store) => store.status?.state);
  const runtimeVersion = useRuntimeStore(
    (store) => store.status?.runtimeVersion,
  );

  if (availability === "unavailable") {
    return (
      <span
        className="runtime-status runtime-status--unavailable"
        role="status"
      >
        <ProductIcon icon="runtime.disabled" size="small" aria-hidden />
        <span>{t("runtime.states.unavailable")}</span>
      </span>
    );
  }

  if (state === undefined) {
    return (
      <span className="runtime-status" role="status">
        <ProductIcon icon="runtime.idle" size="small" aria-hidden />
        <span>{t("runtime.states.connecting")}</span>
      </span>
    );
  }

  const indicator = (
    <span
      className={`runtime-status runtime-status--${state}`}
      role="status"
      {...(runtimeVersion === undefined ? {} : { tabIndex: 0 })}
    >
      <ProductIcon icon={STATE_ICONS[state]} size="small" aria-hidden />
      <span>{t(`runtime.states.${state}`)}</span>
    </span>
  );

  if (runtimeVersion === undefined) {
    return indicator;
  }

  return <Tooltip content={runtimeVersion}>{indicator}</Tooltip>;
}
