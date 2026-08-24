import { Component, Fragment, type ReactNode } from "react";

import { reportProblem } from "./diagnostic-store";
import { FeatureErrorFallback } from "./FeatureErrorFallback";

export interface FeatureErrorBoundaryProps {
  /** Stable identifier used for the localized region name and the diagnostic code. */
  feature: string;
  children: ReactNode;
}

interface FeatureErrorBoundaryState {
  failed: boolean;
  resetKey: number;
}

/** Contains a rendering failure inside one region of the shell.
 *
 * A failure in the palette must not take down the canvas or the run controls, so each
 * region is wrapped separately and reports a persistent diagnostic the user can act on.
 * React has no hook equivalent for error boundaries, so this remains a class component.
 */
export class FeatureErrorBoundary extends Component<
  FeatureErrorBoundaryProps,
  FeatureErrorBoundaryState
> {
  constructor(props: FeatureErrorBoundaryProps) {
    super(props);
    this.state = { failed: false, resetKey: 0 };
  }

  static getDerivedStateFromError(): Partial<FeatureErrorBoundaryState> {
    return { failed: true };
  }

  override componentDidCatch(): void {
    // The error message can contain component and property values, so only the stable
    // feature identity is recorded. The original error stays in the development console.
    reportProblem({
      severity: "error",
      source: "feature",
      titleKey: "diagnostics.featureError.title",
      descriptionKey: "diagnostics.featureError.description",
      parameters: { feature: this.props.feature },
      code: `FEATURE_RENDER_FAILED_${this.props.feature.toUpperCase()}`,
    });
  }

  private readonly retry = (): void => {
    this.setState((state) => ({ failed: false, resetKey: state.resetKey + 1 }));
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <FeatureErrorFallback
          feature={this.props.feature}
          onRetry={this.retry}
        />
      );
    }

    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}
