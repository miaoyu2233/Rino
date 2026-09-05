const MaximumMessageLength = 2_000;
const MaximumStackLength = 24_000;

export interface ApplicationFailureDetails {
  name: string;
  message?: string;
  stack?: string;
  componentStack?: string;
}

function boundedText(value: string, maximumLength: number): string | undefined {
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  return normalized.slice(0, maximumLength);
}

/** Converts an untrusted thrown value into bounded in-memory diagnostic text. */
export function normalizeApplicationFailure(
  failure: unknown,
  componentStack?: string | null,
): ApplicationFailureDetails {
  if (failure instanceof Error) {
    const message = boundedText(failure.message, MaximumMessageLength);
    const stack = boundedText(failure.stack ?? "", MaximumStackLength);
    const reactStack = boundedText(componentStack ?? "", MaximumStackLength);
    return {
      name: boundedText(failure.name, 120) ?? "Error",
      ...(message === undefined ? {} : { message }),
      ...(stack === undefined ? {} : { stack }),
      ...(reactStack === undefined ? {} : { componentStack: reactStack }),
    };
  }

  const message =
    typeof failure === "string"
      ? boundedText(failure, MaximumMessageLength)
      : undefined;
  return {
    name: "Error",
    ...(message === undefined ? {} : { message }),
  };
}

/** Captures failures React boundaries cannot see, without persisting or transmitting them. */
export function installGlobalApplicationFailureHandlers(
  showFailure: ApplicationFailureHandler,
): () => void {
  const handleError = (event: ErrorEvent): void => {
    const isResizeObserverNotification =
      (event.error === null || event.error === undefined) &&
      (event.message ===
        "ResizeObserver loop completed with undelivered notifications." ||
        event.message === "ResizeObserver loop limit exceeded");
    if (isResizeObserverNotification) {
      event.preventDefault();
      return;
    }
    showFailure(normalizeApplicationFailure(event.error ?? event.message));
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    showFailure(normalizeApplicationFailure(event.reason));
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);
  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  };
}

export type ApplicationFailureHandler = (
  failure: ApplicationFailureDetails,
) => void;

/** Forwards only the first fatal failure so competing global paths share one fallback. */
export function createApplicationFailureGate(
  showFailure: ApplicationFailureHandler,
): ApplicationFailureHandler {
  let failureShown = false;

  return (failure) => {
    if (failureShown) return;
    failureShown = true;
    showFailure(failure);
  };
}
