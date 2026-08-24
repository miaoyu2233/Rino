import { Component, type ErrorInfo, type ReactNode } from "react";

import { ApplicationErrorScreen } from "./ApplicationErrorScreen";
import {
  normalizeApplicationFailure,
  type ApplicationFailureDetails,
} from "./application-failure";
import { reportProblem } from "./diagnostic-store";

export interface ApplicationErrorBoundaryProps {
  children: ReactNode;
}

interface ApplicationErrorBoundaryState {
  failure?: ApplicationFailureDetails;
}

/** The last resort when a failure escapes every feature boundary.
 *
 * It sits above the localization and theme providers, so its fallback cannot assume that
 * either is available and renders its own minimal, self-contained recovery screen.
 */
export class ApplicationErrorBoundary extends Component<
  ApplicationErrorBoundaryProps,
  ApplicationErrorBoundaryState
> {
  constructor(props: ApplicationErrorBoundaryProps) {
    super(props);
    this.state = {};
  }

  static getDerivedStateFromError(
    error: unknown,
  ): ApplicationErrorBoundaryState {
    return { failure: normalizeApplicationFailure(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.setState({
      failure: normalizeApplicationFailure(error, info.componentStack),
    });
    reportProblem({
      severity: "error",
      source: "application",
      titleKey: "diagnostics.applicationError.title",
      descriptionKey: "diagnostics.applicationError.description",
      code: "APPLICATION_RENDER_FAILED",
    });
  }

  override render(): ReactNode {
    if (this.state.failure !== undefined) {
      return <ApplicationErrorScreen failure={this.state.failure} />;
    }

    return this.props.children;
  }
}
