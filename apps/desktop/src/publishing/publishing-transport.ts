import { invoke, isTauri } from "@tauri-apps/api/core";

export type PublishingContent = "resource" | "application";

export interface PackageOptions {
  packageId: string;
  version: string;
  summary: string;
  publisherId: string;
  publisherDisplayName: string;
  licenseIdentifier: string;
  githubOwner: string;
  githubRepository: string;
  releasedAt: string;
  content: PublishingContent;
  updateWfp: boolean;
}

export interface PublishingDialogCaptions {
  title: string;
  fileTypeLabel: string;
}

export interface GithubStatus {
  available: boolean;
  authenticated: boolean;
}

export interface PackageOutput {
  assetName: string;
  byteLength: number;
  sha256: string;
  keyId: string;
  publicKeyBase64: string;
}

export interface PublishOutput extends PackageOutput {
  repositoryUrl: string;
  releaseUrl: string;
  createdRepository: boolean;
}

export type PublishingErrorCode =
  | "NO_OPEN_PROJECT"
  | "DIALOG_UNAVAILABLE"
  | "INVALID_INPUT"
  | "INVALID_PROJECT"
  | "ASSET_UNAVAILABLE"
  | "CREDENTIAL_UNAVAILABLE"
  | "PACKAGE_WRITE_FAILED"
  | "APPLICATION_WRITE_FAILED"
  | "WFP_TEMPLATE_UNAVAILABLE"
  | "WFP_TEMPLATE_INVALID"
  | "WFP_TEMPLATE_SYNC_FAILED"
  | "CACHE_CLEANUP_FAILED"
  | "GITHUB_CLI_UNAVAILABLE"
  | "GITHUB_AUTHENTICATION_REQUIRED"
  | "GITHUB_AUTHENTICATION_FAILED"
  | "GITHUB_LOGOUT_FAILED"
  | "PACKAGE_VERSION_EXISTS"
  | "GITHUB_COMMAND_FAILED"
  | "DESKTOP_COMMAND_FAILED";

export class PublishingCommandError extends Error {
  readonly code: PublishingErrorCode;

  constructor(code: PublishingErrorCode) {
    super(code);
    this.name = "PublishingCommandError";
    this.code = code;
  }
}

const ERROR_CODES = new Set<PublishingErrorCode>([
  "NO_OPEN_PROJECT",
  "DIALOG_UNAVAILABLE",
  "INVALID_INPUT",
  "INVALID_PROJECT",
  "ASSET_UNAVAILABLE",
  "CREDENTIAL_UNAVAILABLE",
  "PACKAGE_WRITE_FAILED",
  "APPLICATION_WRITE_FAILED",
  "WFP_TEMPLATE_UNAVAILABLE",
  "WFP_TEMPLATE_INVALID",
  "WFP_TEMPLATE_SYNC_FAILED",
  "CACHE_CLEANUP_FAILED",
  "GITHUB_CLI_UNAVAILABLE",
  "GITHUB_AUTHENTICATION_REQUIRED",
  "GITHUB_AUTHENTICATION_FAILED",
  "GITHUB_LOGOUT_FAILED",
  "PACKAGE_VERSION_EXISTS",
  "GITHUB_COMMAND_FAILED",
]);

function normalizeError(cause: unknown): PublishingCommandError {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string" &&
    ERROR_CODES.has(cause.code as PublishingErrorCode)
  ) {
    return new PublishingCommandError(cause.code as PublishingErrorCode);
  }
  return new PublishingCommandError("DESKTOP_COMMAND_FAILED");
}

async function invokePublishing<T>(
  command: string,
  argumentsValue?: Record<string, unknown>,
): Promise<T> {
  try {
    return argumentsValue === undefined
      ? await invoke<T>(command)
      : await invoke<T>(command, argumentsValue);
  } catch (cause) {
    throw normalizeError(cause);
  }
}

export function isPublishingAvailable(): boolean {
  return isTauri();
}

export function readGithubStatus(): Promise<GithubStatus> {
  return invokePublishing<GithubStatus>("publishing_status");
}

export function loginGithub(): Promise<GithubStatus> {
  return invokePublishing<GithubStatus>("publishing_login");
}

export function logoutGithub(): Promise<GithubStatus> {
  return invokePublishing<GithubStatus>("publishing_logout");
}

export function exportPackage(
  captions: PublishingDialogCaptions,
  options: PackageOptions,
): Promise<PackageOutput | null> {
  return invokePublishing<PackageOutput | null>("publishing_export", {
    captions,
    options,
  });
}

export function publishPackage(
  options: PackageOptions,
): Promise<PublishOutput> {
  return invokePublishing<PublishOutput>("publishing_publish", { options });
}
