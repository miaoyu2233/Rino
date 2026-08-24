import type { ParseKeys } from "i18next";

/** The two channels a failure or outcome can reach the user through.
 *
 * A transient notification reports a non-blocking outcome and disappears on its own. A
 * persistent diagnostic describes something that needs the user's attention or continued
 * diagnosis, and stays in the Problems surface until it is dismissed or resolved.
 */
export type DiagnosticChannel = "notification" | "problem";

export type DiagnosticSeverity = "error" | "warning" | "info";

/** Where a diagnostic originated, so the Problems surface can group and explain it. */
export type DiagnosticSource =
  "application" | "feature" | "runtime" | "project" | "preferences";

/** Bounded, localization-ready parameters for a diagnostic message. */
export type DiagnosticParameters = Record<string, string | number>;

/** A key that exists in the localization catalogs.
 *
 * Diagnostics carry keys rather than translated text so the message follows the user's
 * language, and typing them against the catalog keeps a missing key a build failure
 * instead of a raw key rendered in the interface.
 */
export type LocalizationKey = ParseKeys;

export interface ApplicationDiagnostic {
  id: string;
  severity: DiagnosticSeverity;
  source: DiagnosticSource;
  /** Localization key for the short title. */
  titleKey: LocalizationKey;
  /** Localization key for the explanation and recovery guidance. */
  descriptionKey: LocalizationKey;
  parameters?: DiagnosticParameters;
  /** Stable technical code shown alongside the localized text for support. */
  code?: string;
  createdAt: number;
}

export interface TransientNotification {
  id: string;
  severity: DiagnosticSeverity;
  titleKey: LocalizationKey;
  parameters?: DiagnosticParameters;
}

/** The Problems list is bounded so a repeating failure cannot grow without limit. */
export const MAXIMUM_RETAINED_PROBLEMS = 200;

/** Only a few notifications are visible at once; older ones are replaced. */
export const MAXIMUM_VISIBLE_NOTIFICATIONS = 4;

export const NOTIFICATION_LIFETIME_MS = 6000;
