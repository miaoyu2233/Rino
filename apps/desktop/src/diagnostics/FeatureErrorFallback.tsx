import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/Button";
import { ProductIcon } from "../design-system/icons/ProductIcon";

export interface FeatureErrorFallbackProps {
  feature: string;
  onRetry: () => void;
}

/** The inline replacement shown where a failed region used to render. */
export function FeatureErrorFallback({
  feature,
  onRetry,
}: FeatureErrorFallbackProps) {
  const { t } = useTranslation();

  return (
    <div className="feature-error" role="alert">
      <span className="feature-error__icon" aria-hidden="true">
        <ProductIcon icon="runtime.failed" size="large" />
      </span>
      <strong className="feature-error__title">
        {t("diagnostics.featureError.title", { feature })}
      </strong>
      <p className="feature-error__description">
        {t("diagnostics.featureError.description")}
      </p>
      <Button variant="secondary" onClick={onRetry}>
        {t("diagnostics.actions.retry")}
      </Button>
    </div>
  );
}
