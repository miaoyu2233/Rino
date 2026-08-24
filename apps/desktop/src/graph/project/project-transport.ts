import { invoke, isTauri } from "@tauri-apps/api/core";

import type { ProjectFileContents } from "./project-format";

/** The complete text of a project directory, as written or as read back. */
export interface ProjectFileSet {
  manifest: string;
  graphs: ProjectFileContents[];
}

/** Where a project lives, in the two forms the interface needs. */
export interface ProjectLocation {
  /** The project directory's own name, shown beside the project title. */
  directoryName: string;
  /** The full path, offered only as a tooltip and never logged or transmitted. */
  displayPath: string;
}

export interface OpenedProject {
  location: ProjectLocation;
  files: ProjectFileSet;
  /** Present when unsaved work for this project survived in the recovery slot. */
  recovery: ProjectFileSet | null;
}

export interface StoredImageObject {
  contentHash: string;
  byteLength: number;
  width: number;
  height: number;
  coordinateSpaceId: string;
  sourceKind: "deviceCapture" | "regionCapture";
}

/** The localized captions one native dialog needs.
 *
 * Dialog captions are user-facing text, so they are translated here and passed to the
 * desktop shell rather than written in the shell in one fixed language.
 */
export interface DialogCaptions {
  title: string;
  fileTypeLabel: string | null;
}

/** The stable failure codes the project surface reports. */
export type ProjectErrorCode =
  | "NO_OPEN_PROJECT"
  | "NO_CHOSEN_LOCATION"
  | "LOCATION_ALREADY_HOLDS_PROJECT"
  | "LOCATION_NOT_EMPTY"
  | "NOT_A_PROJECT_MANIFEST"
  | "UNSUPPORTED_FILE_NAME"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_FILES"
  | "READ_FAILED"
  | "WRITE_FAILED"
  | "CREATE_FAILED"
  | "INVALID_JSON"
  | "INVALID_IMAGE"
  | "CAPTURE_UNAVAILABLE"
  | "DIALOG_UNAVAILABLE"
  | "DESKTOP_COMMAND_FAILED";

/** A project command failure carrying its structured code.
 *
 * The desktop shell rejects with a plain structured value; wrapping it keeps the stack
 * trace and lets callers catch it like any other failure.
 */
export class ProjectCommandError extends Error {
  readonly code: ProjectErrorCode;
  readonly detail: string;

  constructor(code: ProjectErrorCode, detail: string) {
    super(code);
    this.name = "ProjectCommandError";
    this.code = code;
    this.detail = detail;
  }
}

const PROJECT_ERROR_CODES: ReadonlySet<string> = new Set<ProjectErrorCode>([
  "NO_OPEN_PROJECT",
  "NO_CHOSEN_LOCATION",
  "LOCATION_ALREADY_HOLDS_PROJECT",
  "LOCATION_NOT_EMPTY",
  "NOT_A_PROJECT_MANIFEST",
  "UNSUPPORTED_FILE_NAME",
  "FILE_TOO_LARGE",
  "TOO_MANY_FILES",
  "READ_FAILED",
  "WRITE_FAILED",
  "CREATE_FAILED",
  "INVALID_JSON",
  "INVALID_IMAGE",
  "CAPTURE_UNAVAILABLE",
  "DIALOG_UNAVAILABLE",
]);

/** Normalizes any rejection into the structured failure the interface understands. */
export function toProjectCommandError(cause: unknown): ProjectCommandError {
  if (cause instanceof ProjectCommandError) {
    return cause;
  }
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code: unknown = cause.code;
    const detail = "detail" in cause ? cause.detail : undefined;
    if (typeof code === "string" && PROJECT_ERROR_CODES.has(code)) {
      return new ProjectCommandError(
        code as ProjectErrorCode,
        typeof detail === "string" ? detail : "",
      );
    }
  }
  return new ProjectCommandError("DESKTOP_COMMAND_FAILED", "");
}

/** The desktop capabilities project persistence depends on.
 *
 * The actions are written against this interface rather than the desktop framework, so
 * the local transport can be replaced later without changing persistence behavior, and so
 * tests exercise the real actions against a substitutable boundary.
 */
export interface ProjectTransport {
  chooseLocation: (captions: DialogCaptions) => Promise<ProjectLocation | null>;
  open: (captions: DialogCaptions) => Promise<OpenedProject | null>;
  create: (files: ProjectFileSet) => Promise<ProjectLocation>;
  save: (files: ProjectFileSet) => Promise<ProjectLocation>;
  saveAs: (files: ProjectFileSet) => Promise<ProjectLocation>;
  storeCapture: (captureToken: string) => Promise<StoredImageObject>;
  readImageAsset: (
    contentHash: string,
    expectedByteLength: number,
  ) => Promise<Uint8Array>;
  cleanupOrphanAssets: () => Promise<number>;
  cleanupOrphanGraphs: () => Promise<number>;
  close: () => Promise<void>;
  writeAutosave: (files: ProjectFileSet) => Promise<void>;
  discardRecovery: () => Promise<void>;
}

/** Reports whether the desktop shell is available to own project files. */
export function isDesktopProjectServiceAvailable(): boolean {
  return isTauri();
}

async function invokeProject<T>(
  command: string,
  argument?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, argument);
  } catch (cause) {
    throw toProjectCommandError(cause);
  }
}

/** A command that returns nothing. The unit result is discarded by the caller. */
async function invokeProjectAction(
  command: string,
  argument?: Record<string, unknown>,
): Promise<void> {
  await invokeProject<null>(command, argument);
}

/** The transport backed by the desktop shell's typed project commands. */
export function createDesktopProjectTransport(): ProjectTransport {
  return {
    chooseLocation: (captions) =>
      invokeProject<ProjectLocation | null>("project_choose_location", {
        captions,
      }),
    open: (captions) =>
      invokeProject<OpenedProject | null>("project_open", { captions }),
    create: (files) =>
      invokeProject<ProjectLocation>("project_create", { files }),
    save: (files) => invokeProject<ProjectLocation>("project_save", { files }),
    saveAs: (files) =>
      invokeProject<ProjectLocation>("project_save_as", { files }),
    storeCapture: (captureToken) =>
      invokeProject<StoredImageObject>("project_store_capture", {
        captureToken,
      }),
    readImageAsset: async (contentHash, expectedByteLength) => {
      const bytes = await invokeProject<ArrayBuffer>(
        "project_read_image_asset",
        {
          contentHash,
          expectedByteLength,
        },
      );
      const image = new Uint8Array(bytes);
      if (
        !Number.isSafeInteger(expectedByteLength) ||
        expectedByteLength <= 0 ||
        image.byteLength !== expectedByteLength
      ) {
        throw new ProjectCommandError("INVALID_IMAGE", "assetLength");
      }
      return image;
    },
    cleanupOrphanAssets: () =>
      invokeProject<number>("project_cleanup_orphan_assets"),
    cleanupOrphanGraphs: () =>
      invokeProject<number>("project_cleanup_orphan_graphs"),
    close: () => invokeProjectAction("project_close"),
    writeAutosave: (files) =>
      invokeProjectAction("project_write_autosave", { files }),
    discardRecovery: () => invokeProjectAction("project_discard_recovery"),
  };
}
