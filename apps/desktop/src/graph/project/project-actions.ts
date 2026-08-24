import { reportProblem } from "../../diagnostics/diagnostic-store";
import { useDocumentStore } from "../store/document-store";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../store/project-lifecycle";
import { createEmptyProject } from "../project-factory";
import {
  parseProject,
  serializeProject,
  serializedProjectsMatch,
  type ProjectFormatFailure,
  type SerializedProject,
} from "./project-format";
import { useProjectStore } from "./project-store";
import {
  ProjectCommandError,
  toProjectCommandError,
  type ProjectErrorCode,
  type ProjectFileSet,
  type ProjectLocation,
  type ProjectTransport,
  type StoredImageObject,
} from "./project-transport";

/** The captions the native dialogs need, translated by the caller. */
export interface ProjectDialogText {
  chooseLocationTitle: string;
  openTitle: string;
  manifestFileTypeLabel: string;
}

/** What the caller needs to know about a project action.
 *
 * Failures are already reported to the user by the action itself; the outcome exists so
 * the interface can decide what to do next, such as whether a pending close may proceed.
 */
export type ProjectOutcome =
  | { status: "completed" }
  | { status: "cancelled" }
  | { status: "unavailable" }
  | { status: "failed" };

let transport: ProjectTransport | undefined;

/** Installs the desktop transport, or removes it when the shell is absent. */
export function setProjectTransport(next: ProjectTransport | undefined): void {
  transport = next;
}

function requireTransport(): ProjectTransport | undefined {
  if (!transport) {
    reportProblem({
      severity: "warning",
      source: "project",
      titleKey: "project.problem.unavailableTitle",
      descriptionKey: "project.problem.unavailableDescription",
    });
  }
  return transport;
}

function reportCommandFailure(code: ProjectErrorCode): void {
  reportProblem({
    severity: "error",
    source: "project",
    titleKey: "project.problem.commandFailedTitle",
    descriptionKey: `project.error.${code}`,
    code,
  });
}

function reportFormatFailure(failure: ProjectFormatFailure): void {
  const parameters =
    "fileName" in failure
      ? { fileName: failure.fileName }
      : "foundVersion" in failure
        ? { foundVersion: failure.foundVersion }
        : "displayName" in failure
          ? { displayName: failure.displayName }
          : {};
  reportProblem({
    severity: "error",
    source: "project",
    titleKey: "project.problem.formatRejectedTitle",
    descriptionKey: `project.format.${failure.reason}`,
    parameters,
    code: failure.reason,
  });
}

function currentDocument() {
  return useDocumentStore.getState().history?.document;
}

export async function storeProjectCapture(
  captureToken: string,
): Promise<StoredImageObject> {
  const service = requireTransport();
  if (!service) {
    throw new ProjectCommandError(
      "DESKTOP_COMMAND_FAILED",
      "The desktop project service is unavailable.",
    );
  }
  try {
    return await service.storeCapture(captureToken);
  } catch (cause: unknown) {
    const failure = toProjectCommandError(cause);
    reportCommandFailure(failure.code);
    throw failure;
  }
}

/** Reads one integrity-checked project image without exposing its local path. */
export async function readProjectImageAsset(
  contentHash: string,
  expectedByteLength: number,
): Promise<Uint8Array> {
  const service = requireTransport();
  if (!service) {
    throw new ProjectCommandError(
      "DESKTOP_COMMAND_FAILED",
      "The desktop project service is unavailable.",
    );
  }
  try {
    return await service.readImageAsset(contentHash, expectedByteLength);
  } catch (cause: unknown) {
    const failure = toProjectCommandError(cause);
    reportCommandFailure(failure.code);
    throw failure;
  }
}

async function cleanupOrphansAfterSave(
  service: ProjectTransport,
): Promise<void> {
  await Promise.allSettled([
    Promise.resolve().then(() => service.cleanupOrphanAssets()),
    Promise.resolve().then(() => service.cleanupOrphanGraphs()),
  ]);
}

/** Produces the exact text a save would write, reporting a rejection to the user. */
function serializeOpenProject(): SerializedProject | undefined {
  const document = currentDocument();
  if (!document) {
    return undefined;
  }
  const outcome = serializeProject(
    document,
    useProjectStore.getState().graphFileNames,
  );
  if (!outcome.ok) {
    reportFormatFailure(outcome.failure);
    return undefined;
  }
  return outcome.value;
}

function adoptOpenedProject(opened: {
  location: ProjectLocation;
  files: ProjectFileSet;
  recovery: ProjectFileSet | null;
}): ProjectOutcome {
  const parsed = parseProject(opened.files);
  if (!parsed.ok) {
    reportFormatFailure(parsed.failure);
    return { status: "failed" };
  }
  const baseline = serializeProject(
    parsed.value.document,
    parsed.value.graphFileNames,
  );
  if (!baseline.ok) {
    reportFormatFailure(baseline.failure);
    return { status: "failed" };
  }
  openProjectDocument(parsed.value.document);
  useProjectStore.getState().recordCommit(opened.location, baseline.value);
  useProjectStore.getState().offerRecovery(opened.recovery ?? undefined);
  return { status: "completed" };
}

async function runCommand<T>(
  activity: "creating" | "opening" | "saving",
  operation: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const store = useProjectStore.getState();
  store.setActivity(activity);
  try {
    return { ok: true, value: await operation() };
  } catch (cause) {
    reportCommandFailure(toProjectCommandError(cause).code);
    return { ok: false };
  } finally {
    useProjectStore.getState().setActivity("idle");
  }
}

export interface CreateProjectOptions {
  dialogText: ProjectDialogText;
  entryGraphName: string;
  /** Injected so a created document is reproducible in tests. */
  now: () => string;
}

/** Creates a project in a directory the user chooses.
 *
 * The project takes the chosen directory's own name, which is why the location is asked
 * for before the document exists rather than after.
 */
export async function createProject(
  options: CreateProjectOptions,
): Promise<ProjectOutcome> {
  const service = requireTransport();
  if (!service) {
    return { status: "unavailable" };
  }

  const chosen = await runCommand("creating", () =>
    service.chooseLocation({
      title: options.dialogText.chooseLocationTitle,
      fileTypeLabel: null,
    }),
  );
  if (!chosen.ok) {
    return { status: "failed" };
  }
  if (chosen.value === null) {
    return { status: "cancelled" };
  }

  const createdAt = options.now();
  const document = createEmptyProject({
    name: chosen.value.directoryName,
    entryGraphName: options.entryGraphName,
    createdAt,
  });
  const serialized = serializeProject(document, new Map());
  if (!serialized.ok) {
    reportFormatFailure(serialized.failure);
    return { status: "failed" };
  }

  const created = await runCommand("creating", () =>
    service.create({
      manifest: serialized.value.manifest,
      graphs: serialized.value.graphs,
    }),
  );
  if (!created.ok) {
    return { status: "failed" };
  }

  openProjectDocument(document);
  useProjectStore.getState().recordCommit(created.value, serialized.value);
  useDocumentStore.getState().markDocumentSaved(createdAt);
  return { status: "completed" };
}

/** Opens a project the user selects, and offers any unsaved work found for it. */
export async function openProject(
  dialogText: ProjectDialogText,
): Promise<ProjectOutcome> {
  const service = requireTransport();
  if (!service) {
    return { status: "unavailable" };
  }

  const opened = await runCommand("opening", () =>
    service.open({
      title: dialogText.openTitle,
      fileTypeLabel: dialogText.manifestFileTypeLabel,
    }),
  );
  if (!opened.ok) {
    return { status: "failed" };
  }
  if (opened.value === null) {
    return { status: "cancelled" };
  }

  const adopted = adoptOpenedProject(opened.value);
  if (adopted.status === "failed") {
    // The shell already adopted the directory as the open project. Releasing it here is
    // what keeps a later save from writing into a project this build could not read.
    await service.close().catch(() => undefined);
  }
  return adopted;
}

/** Writes the open project, skipping the write when nothing changed. */
export async function saveProject(): Promise<ProjectOutcome> {
  const service = requireTransport();
  if (!service) {
    return { status: "unavailable" };
  }
  const store = useProjectStore.getState();
  if (!store.location) {
    return { status: "failed" };
  }

  const pending = serializeOpenProject();
  if (!pending) {
    return { status: "failed" };
  }
  if (
    store.lastWritten &&
    serializedProjectsMatch(store.lastWritten, pending)
  ) {
    // Nothing semantic changed, so neither the files nor `updatedAt` move.
    useDocumentStore.getState().markDocumentSaved();
    return { status: "completed" };
  }

  const committedAt = new Date().toISOString();
  const document = currentDocument();
  if (!document) {
    return { status: "failed" };
  }
  const stamped = serializeProject(
    { ...document, metadata: { ...document.metadata, updatedAt: committedAt } },
    pending.graphFileNames,
  );
  if (!stamped.ok) {
    reportFormatFailure(stamped.failure);
    return { status: "failed" };
  }

  const saved = await runCommand("saving", () =>
    service.save({
      manifest: stamped.value.manifest,
      graphs: stamped.value.graphs,
    }),
  );
  if (!saved.ok) {
    return { status: "failed" };
  }

  useProjectStore.getState().recordCommit(saved.value, stamped.value);
  useDocumentStore.getState().markDocumentSaved(committedAt);
  await service.discardRecovery().catch(() => undefined);
  useProjectStore.getState().offerRecovery(undefined);
  await cleanupOrphansAfterSave(service);
  return { status: "completed" };
}

/** Writes the open project into a new directory and continues editing it there. */
export async function saveProjectAs(
  dialogText: ProjectDialogText,
): Promise<ProjectOutcome> {
  const service = requireTransport();
  if (!service) {
    return { status: "unavailable" };
  }
  const document = currentDocument();
  if (!document) {
    return { status: "failed" };
  }

  const chosen = await runCommand("saving", () =>
    service.chooseLocation({
      title: dialogText.chooseLocationTitle,
      fileTypeLabel: null,
    }),
  );
  if (!chosen.ok) {
    return { status: "failed" };
  }
  if (chosen.value === null) {
    return { status: "cancelled" };
  }

  const committedAt = new Date().toISOString();
  const serialized = serializeProject(
    { ...document, metadata: { ...document.metadata, updatedAt: committedAt } },
    useProjectStore.getState().graphFileNames,
  );
  if (!serialized.ok) {
    reportFormatFailure(serialized.failure);
    return { status: "failed" };
  }

  const saved = await runCommand("saving", () =>
    service.saveAs({
      manifest: serialized.value.manifest,
      graphs: serialized.value.graphs,
    }),
  );
  if (!saved.ok) {
    return { status: "failed" };
  }

  useProjectStore.getState().recordCommit(saved.value, serialized.value);
  useDocumentStore.getState().markDocumentSaved(committedAt);
  useProjectStore.getState().offerRecovery(undefined);
  await cleanupOrphansAfterSave(service);
  return { status: "completed" };
}

/** Closes the open project without saving it. Callers ask about unsaved work first. */
export async function closeProject(): Promise<ProjectOutcome> {
  closeProjectDocument();
  useProjectStore.getState().forgetProject();
  if (transport) {
    await transport.close().catch(() => undefined);
  }
  return { status: "completed" };
}

/** Replaces the opened document with the unsaved work found in the recovery slot.
 *
 * The restored document is marked unsaved, because it is exactly the work that never
 * reached the project directory.
 */
export function acceptRecovery(recovery: ProjectFileSet): ProjectOutcome {
  const parsed = parseProject(recovery);
  if (!parsed.ok) {
    reportFormatFailure(parsed.failure);
    useProjectStore.getState().offerRecovery(undefined);
    return { status: "failed" };
  }
  openProjectDocument(parsed.value.document);
  useDocumentStore.getState().markDocumentUnsaved();
  useProjectStore.getState().offerRecovery(undefined);
  return { status: "completed" };
}

/** Discards the recovery slot, keeping the version on disk. */
export async function discardRecovery(): Promise<ProjectOutcome> {
  useProjectStore.getState().offerRecovery(undefined);
  if (transport) {
    await transport.discardRecovery().catch(() => undefined);
  }
  return { status: "completed" };
}

/** Writes the open project's current state to the recovery slot.
 *
 * Autosave never touches the project directory: a directory the user publishes must
 * contain what they saved, not what they were in the middle of.
 */
export async function writeAutosave(): Promise<ProjectOutcome> {
  if (!transport || !useProjectStore.getState().location) {
    return { status: "unavailable" };
  }
  const document = currentDocument();
  if (!document) {
    return { status: "unavailable" };
  }
  const serialized = serializeProject(
    document,
    useProjectStore.getState().graphFileNames,
  );
  if (!serialized.ok) {
    // A document that cannot be serialized is already reported by the save path; an
    // autosave stays silent rather than interrupting the user a second time.
    return { status: "failed" };
  }
  try {
    await transport.writeAutosave({
      manifest: serialized.value.manifest,
      graphs: serialized.value.graphs,
    });
    return { status: "completed" };
  } catch {
    return { status: "failed" };
  }
}
