import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/Button";
import { ProductIcon } from "../design-system/icons/ProductIcon";
import { useRuntime } from "../ipc/useRuntime";
import { useRuntimeStore } from "../ipc/runtime-store";

const PROTOCOL_INCOMPATIBLE_CODE = "PROTOCOL_INCOMPATIBLE";

/** An actionable explanation when the runtime cannot serve the interface.
 *
 * A version mismatch and a startup failure need different guidance: the first cannot be
 * fixed by retrying, so it offers no retry action, while the second can.
 */
export function RuntimeFailureNotice() {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const status = useRuntimeStore((store) => store.status);
  const availability = useRuntimeStore((store) => store.availability);
  const [restarting, setRestarting] = useState(false);

  if (availability === "unavailable") {
    return (
      <section className="runtime-notice" role="alert">
        <span className="runtime-notice__icon" aria-hidden="true">
          <ProductIcon icon="runtime.disabled" size="large" />
        </span>
        <strong>{t("runtime.notices.hostUnavailable.title")}</strong>
        <p>{t("runtime.notices.hostUnavailable.description")}</p>
      </section>
    );
  }

  if (status?.state !== "failed") {
    return null;
  }

  const incompatible = status.lastError?.code === PROTOCOL_INCOMPATIBLE_CODE;

  return (
    <section className="runtime-notice" role="alert">
      <span className="runtime-notice__icon" aria-hidden="true">
        <ProductIcon icon="runtime.failed" size="large" />
      </span>
      <strong>
        {t(
          incompatible
            ? "runtime.notices.incompatible.title"
            : "runtime.notices.startFailed.title",
        )}
      </strong>
      <p>
        {t(
          incompatible
            ? "runtime.notices.incompatible.description"
            : "runtime.notices.startFailed.description",
        )}
      </p>
      {status.lastError === undefined ? null : (
        <code className="runtime-notice__code">{status.lastError.code}</code>
      )}
      {incompatible ? null : (
        <Button
          variant="primary"
          disabled={restarting}
          onClick={() => {
            setRestarting(true);
            void runtime
              .restart()
              .catch(() => undefined)
              .finally(() => {
                setRestarting(false);
              });
          }}
        >
          {t("runtime.actions.restart")}
        </Button>
      )}
    </section>
  );
}
