import { create } from "zustand";

import {
  MAXIMUM_RETAINED_PROBLEMS,
  MAXIMUM_VISIBLE_NOTIFICATIONS,
  type ApplicationDiagnostic,
  type DiagnosticParameters,
  type DiagnosticSeverity,
  type DiagnosticSource,
  type LocalizationKey,
  type TransientNotification,
} from "./diagnostic-model";

export interface ReportProblemInput {
  severity: DiagnosticSeverity;
  source: DiagnosticSource;
  titleKey: LocalizationKey;
  descriptionKey: LocalizationKey;
  parameters?: DiagnosticParameters;
  code?: string;
}

export interface NotifyInput {
  severity: DiagnosticSeverity;
  titleKey: LocalizationKey;
  parameters?: DiagnosticParameters;
}

interface DiagnosticState {
  problems: ApplicationDiagnostic[];
  notifications: TransientNotification[];
  reportProblem: (input: ReportProblemInput) => string;
  dismissProblem: (id: string) => void;
  clearProblems: (source?: DiagnosticSource) => void;
  notify: (input: NotifyInput) => string;
  dismissNotification: (id: string) => void;
}

let identifierSequence = 0;

/** Identifiers are local and monotonic; they never leave the desktop process. */
function nextIdentifier(prefix: string): string {
  identifierSequence += 1;
  return `${prefix}-${String(identifierSequence)}`;
}

/** Reads a clock that is safe in tests and in the packaged application alike. */
function currentTimestamp(): number {
  return Date.now();
}

export const useDiagnosticStore = create<DiagnosticState>((set) => ({
  problems: [],
  notifications: [],
  reportProblem: (input) => {
    const id = nextIdentifier("problem");
    set((state) => ({
      problems: [
        {
          id,
          severity: input.severity,
          source: input.source,
          titleKey: input.titleKey,
          descriptionKey: input.descriptionKey,
          ...(input.parameters ? { parameters: input.parameters } : {}),
          ...(input.code ? { code: input.code } : {}),
          createdAt: currentTimestamp(),
        },
        ...state.problems,
      ].slice(0, MAXIMUM_RETAINED_PROBLEMS),
    }));
    return id;
  },
  dismissProblem: (id) => {
    set((state) => ({
      problems: state.problems.filter((problem) => problem.id !== id),
    }));
  },
  clearProblems: (source) => {
    set((state) => ({
      problems: source
        ? state.problems.filter((problem) => problem.source !== source)
        : [],
    }));
  },
  notify: (input) => {
    const id = nextIdentifier("notification");
    set((state) => ({
      notifications: [
        ...state.notifications,
        {
          id,
          severity: input.severity,
          titleKey: input.titleKey,
          ...(input.parameters ? { parameters: input.parameters } : {}),
        },
      ].slice(-MAXIMUM_VISIBLE_NOTIFICATIONS),
    }));
    return id;
  },
  dismissNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter(
        (notification) => notification.id !== id,
      ),
    }));
  },
}));

/** Reports a problem from outside React, such as an error boundary or a service. */
export function reportProblem(input: ReportProblemInput): string {
  return useDiagnosticStore.getState().reportProblem(input);
}

/** Raises a transient notification from outside React. */
export function notify(input: NotifyInput): string {
  return useDiagnosticStore.getState().notify(input);
}
