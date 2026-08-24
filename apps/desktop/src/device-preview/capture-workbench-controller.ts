import type {
  CaptureArtifactDescriptorV1,
  CapturePrepareRequestPayloadV1,
  PreviewArtifactDescriptorV1,
  RinoProjectDocumentV1,
} from "@rino/contracts";

import {
  buildAddImageAssetCommand,
  type CapturedImageRecord,
} from "../graph/project/asset-commands";
import {
  createAvailableCaptureDisplayName,
  validateAssetVisibleName,
  type AssetDisplayNameConflict,
  type AssetDisplayNameValidation,
} from "../graph/project/asset-names";
import type { ProjectOutcome } from "../graph/project/project-actions";
import type { StoredImageObject } from "../graph/project/project-transport";
import type { CommandOutcome } from "../graph/store/document-store";
import type { GraphCommand } from "../graph/commands/graph-commands";
import { RuntimeCommandError } from "../ipc/runtime-client";
import type { SourceRectangle } from "./geometry";
import {
  CaptureSessionPreparationError,
  prepareCaptureSession,
  type CaptureProjectPort,
  type CaptureRuntimePort,
  type PreparedCaptureSession,
} from "./capture-session";

export type CaptureNameValidation =
  AssetDisplayNameValidation | ({ ok: false } & AssetDisplayNameConflict);

export type CaptureWorkbenchFailure =
  | "noOpenProject"
  | "projectChanged"
  | "executionLocked"
  | "stalePreview"
  | "namePreparationFailed"
  | "runtimePrepareFailed"
  | "captureReadFailed"
  | "previewCreationFailed"
  | "prepareFailed"
  | "storedMetadataMismatch"
  | "documentRejected"
  | "saveFailed";

export type CaptureCommitStep = "storing" | "filing" | "saving";

interface ConfirmingCaptureView {
  descriptor: CaptureArtifactDescriptorV1;
  displayName: string;
  nameValidation: CaptureNameValidation;
  objectUrl: string;
  sourceRegion?: SourceRectangle;
}

export type CaptureWorkbenchState =
  | { phase: "idle" }
  | { phase: "preparing" }
  | ({ phase: "confirming" } & ConfirmingCaptureView)
  | ({
      phase: "committing";
      step: CaptureCommitStep;
    } & Partial<ConfirmingCaptureView>)
  | {
      phase: "filingFailed";
      displayName: string;
      nameValidation: CaptureNameValidation;
      reason: Exclude<CaptureWorkbenchFailure, "saveFailed">;
    }
  | {
      phase: "saveFailed";
      assetId: string;
      displayName: string;
      reason: "saveFailed";
    }
  | { phase: "completed"; assetId: string; displayName: string }
  | { phase: "discarding" }
  | {
      phase: "failed";
      reason: CaptureWorkbenchFailure;
      diagnosticCode?: string;
    };

export interface CaptureWorkbenchDocumentPort {
  readDocument: () => RinoProjectDocumentV1 | undefined;
  isExecutionLocked: () => boolean;
  runCommand: (label: string, command: GraphCommand) => CommandOutcome;
  saveProject: () => Promise<ProjectOutcome>;
}

export interface CaptureObjectUrlPort {
  create: (bytes: Uint8Array, mediaType: "image/png") => string;
  revoke: (objectUrl: string) => void;
}

export interface CaptureWorkbenchDependencies {
  runtime: CaptureRuntimePort;
  project: CaptureProjectPort;
  document: CaptureWorkbenchDocumentPort;
  objectUrls: CaptureObjectUrlPort;
  createIdentifier: () => string;
  readInstallationCode: () => string;
  readNextAssetNameOrdinal: (visibleName: string) => number;
  recordAssetNameOrdinal: (visibleName: string, ordinal: number) => void;
  now: () => Date;
}

interface PreparedCaptureDraft {
  session: PreparedCaptureSession;
  objectUrl: string;
  displayName: string;
  createdAt: Date;
  assetId: string;
  projectDocumentId: string;
  sourceRegion?: SourceRectangle;
}

interface PendingCaptureRecord {
  stored: StoredImageObject;
  displayName: string;
  createdAt: Date;
  assetId: string;
  projectDocumentId: string;
}

type StateListener = () => void;

export function createCapturePreparePayload(
  preview: PreviewArtifactDescriptorV1,
  region?: SourceRectangle,
): CapturePrepareRequestPayloadV1 | undefined {
  if (region === undefined) {
    return { previewToken: preview.previewToken };
  }
  const validRegion =
    region.coordinateSpaceId === preview.sourceCoordinateSpaceId &&
    region.sourceGeneration === preview.sourceGeneration &&
    Number.isInteger(region.x) &&
    Number.isInteger(region.y) &&
    Number.isInteger(region.width) &&
    Number.isInteger(region.height) &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.width > 0 &&
    region.height > 0 &&
    region.x + region.width <= preview.sourceWidth &&
    region.y + region.height <= preview.sourceHeight;

  return validRegion
    ? {
        previewToken: preview.previewToken,
        region: {
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          coordinateSpaceId: region.coordinateSpaceId,
          sourceGeneration: region.sourceGeneration,
        },
      }
    : undefined;
}

export class CaptureWorkbenchController {
  private state: CaptureWorkbenchState = { phase: "idle" };
  private readonly listeners = new Set<StateListener>();
  private prepared: PreparedCaptureDraft | undefined;
  private pendingRecord: PendingCaptureRecord | undefined;
  private savePendingProjectDocumentId: string | undefined;
  private operationGeneration = 0;
  private disposed = false;

  constructor(private readonly dependencies: CaptureWorkbenchDependencies) {}

  getSnapshot = (): CaptureWorkbenchState => this.state;

  subscribe = (listener: StateListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async prepare(
    preview: PreviewArtifactDescriptorV1,
    region?: SourceRectangle,
  ): Promise<boolean> {
    if (this.disposed || !this.canStartPreparation()) {
      return false;
    }
    const document = this.dependencies.document.readDocument();
    if (document === undefined) {
      this.setState({ phase: "failed", reason: "noOpenProject" });
      return false;
    }
    if (this.dependencies.document.isExecutionLocked()) {
      this.setState({ phase: "failed", reason: "executionLocked" });
      return false;
    }
    const payload = createCapturePreparePayload(preview, region);
    if (payload === undefined) {
      this.setState({ phase: "failed", reason: "stalePreview" });
      return false;
    }

    const generation = ++this.operationGeneration;
    this.setState({ phase: "preparing" });
    const createdAt = this.dependencies.now();
    let displayName: string;
    try {
      displayName = createAvailableCaptureDisplayName(
        createdAt,
        document.assets,
      );
    } catch {
      if (generation === this.operationGeneration) {
        this.setState({ phase: "failed", reason: "namePreparationFailed" });
      }
      return false;
    }

    let session: PreparedCaptureSession;
    try {
      session = await prepareCaptureSession(
        this.dependencies.runtime,
        this.dependencies.project,
        payload,
      );
    } catch (cause: unknown) {
      if (generation === this.operationGeneration) {
        const failure = capturePreparationFailure(cause);
        this.setState({
          phase: "failed",
          reason: failure.reason,
          ...(failure.diagnosticCode === undefined
            ? {}
            : { diagnosticCode: failure.diagnosticCode }),
        });
      }
      return false;
    }

    if (
      generation !== this.operationGeneration ||
      !this.isCurrentProject(document.documentId)
    ) {
      await session.discard().catch(() => false);
      if (generation === this.operationGeneration) {
        this.setState({ phase: "failed", reason: "projectChanged" });
      } else if (this.state.phase === "discarding") {
        this.setState({ phase: "idle" });
      }
      return false;
    }

    let objectUrl: string;
    try {
      objectUrl = this.dependencies.objectUrls.create(
        session.bytes,
        session.descriptor.mediaType,
      );
    } catch {
      await session.discard().catch(() => false);
      if (generation === this.operationGeneration) {
        this.setState({ phase: "failed", reason: "previewCreationFailed" });
      }
      return false;
    }

    this.prepared = {
      session,
      objectUrl,
      displayName,
      createdAt,
      assetId: this.dependencies.createIdentifier(),
      projectDocumentId: document.documentId,
      ...(region === undefined ? {} : { sourceRegion: { ...region } }),
    };
    this.setConfirmingState();
    return true;
  }

  setDisplayName(displayName: string): boolean {
    if (this.prepared !== undefined && this.state.phase === "confirming") {
      this.prepared.displayName = displayName;
      this.setConfirmingState();
      return true;
    }
    if (
      this.pendingRecord !== undefined &&
      this.state.phase === "filingFailed"
    ) {
      this.pendingRecord.displayName = displayName;
      this.setState({
        ...this.state,
        displayName,
        nameValidation: this.validateName(displayName),
      });
      return true;
    }
    return false;
  }

  async commit(): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    if (this.state.phase === "filingFailed" && this.pendingRecord) {
      return this.filePendingRecord();
    }
    const draft = this.prepared;
    if (this.state.phase !== "confirming" || draft === undefined) {
      return false;
    }
    if (!this.isCurrentProject(draft.projectDocumentId)) {
      this.invalidateProjectContext();
      return false;
    }
    const nameValidation = this.validateName(draft.displayName);
    if (!nameValidation.ok) {
      this.setConfirmingState();
      return false;
    }
    if (this.dependencies.document.isExecutionLocked()) {
      this.operationGeneration += 1;
      this.prepared = undefined;
      this.revokeUrl(draft.objectUrl);
      await draft.session.discard().catch(() => false);
      this.setState({ phase: "failed", reason: "executionLocked" });
      return false;
    }

    const generation = ++this.operationGeneration;
    this.setState({
      phase: "committing",
      step: "storing",
      descriptor: draft.session.descriptor,
      displayName: draft.displayName,
      nameValidation,
      objectUrl: draft.objectUrl,
      ...(draft.sourceRegion === undefined
        ? {}
        : { sourceRegion: draft.sourceRegion }),
    });
    let stored: StoredImageObject;
    try {
      stored = await draft.session.commit();
    } catch {
      if (generation === this.operationGeneration) {
        this.setConfirmingState();
      }
      return false;
    }
    if (
      generation !== this.operationGeneration ||
      !this.isCurrentProject(draft.projectDocumentId)
    ) {
      if (generation === this.operationGeneration) {
        this.invalidateProjectContext();
      }
      return false;
    }
    this.revokePreparedUrl();
    this.prepared = undefined;
    if (!this.storedImageMatchesDescriptor(stored, draft.session.descriptor)) {
      this.setState({ phase: "failed", reason: "storedMetadataMismatch" });
      return false;
    }
    this.pendingRecord = {
      stored,
      displayName: nameValidation.displayName,
      createdAt: draft.createdAt,
      assetId: draft.assetId,
      projectDocumentId: draft.projectDocumentId,
    };
    return this.filePendingRecord();
  }

  async retrySave(): Promise<boolean> {
    if (this.disposed || this.state.phase !== "saveFailed") {
      return false;
    }
    const projectDocumentId = this.savePendingProjectDocumentId;
    if (projectDocumentId === undefined) {
      return false;
    }
    if (!this.isCurrentProject(projectDocumentId)) {
      this.invalidateProjectContext();
      return false;
    }
    const { assetId, displayName } = this.state;
    const generation = ++this.operationGeneration;
    this.setState({ phase: "committing", step: "saving", displayName });
    const outcome = await this.dependencies.document.saveProject();
    if (generation !== this.operationGeneration) {
      return false;
    }
    if (!this.isCurrentProject(projectDocumentId)) {
      this.invalidateProjectContext();
      return false;
    }
    if (outcome.status !== "completed") {
      this.setState({
        phase: "saveFailed",
        assetId,
        displayName,
        reason: "saveFailed",
      });
      return false;
    }
    this.savePendingProjectDocumentId = undefined;
    this.setState({ phase: "completed", assetId, displayName });
    return true;
  }

  async discard(): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    if (this.state.phase === "preparing") {
      this.operationGeneration += 1;
      this.setState({ phase: "discarding" });
      return true;
    }
    if (this.state.phase === "filingFailed" && this.pendingRecord) {
      this.pendingRecord = undefined;
      this.setState({ phase: "idle" });
      return true;
    }
    const draft = this.prepared;
    if (draft === undefined || this.state.phase !== "confirming") {
      return false;
    }
    this.operationGeneration += 1;
    this.prepared = undefined;
    this.revokeUrl(draft.objectUrl);
    this.setState({ phase: "discarding" });
    await draft.session.discard().catch(() => false);
    this.finishDiscard();
    return true;
  }

  reset(): boolean {
    if (
      this.state.phase === "completed" ||
      this.state.phase === "failed" ||
      this.state.phase === "idle"
    ) {
      const draft = this.prepared;
      this.prepared = undefined;
      this.pendingRecord = undefined;
      this.savePendingProjectDocumentId = undefined;
      if (draft !== undefined) {
        this.revokeUrl(draft.objectUrl);
        void draft.session.discard().catch(() => false);
      }
      this.setState({ phase: "idle" });
      return true;
    }
    return false;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.operationGeneration += 1;
    const draft = this.prepared;
    this.prepared = undefined;
    this.pendingRecord = undefined;
    this.savePendingProjectDocumentId = undefined;
    if (draft !== undefined) {
      this.revokeUrl(draft.objectUrl);
      void draft.session.discard().catch(() => false);
    }
    this.listeners.clear();
  }

  validateProjectContext(projectDocumentId: string | undefined): boolean {
    const boundProjectDocumentId =
      this.prepared?.projectDocumentId ??
      this.pendingRecord?.projectDocumentId ??
      this.savePendingProjectDocumentId;
    if (
      boundProjectDocumentId === undefined ||
      boundProjectDocumentId === projectDocumentId
    ) {
      return true;
    }
    this.invalidateProjectContext();
    return false;
  }

  private canStartPreparation(): boolean {
    return this.state.phase === "idle" || this.state.phase === "failed";
  }

  private setConfirmingState(): void {
    const draft = this.prepared;
    if (draft === undefined) {
      return;
    }
    this.setState({
      phase: "confirming",
      descriptor: draft.session.descriptor,
      displayName: draft.displayName,
      nameValidation: this.validateName(draft.displayName),
      objectUrl: draft.objectUrl,
      ...(draft.sourceRegion === undefined
        ? {}
        : { sourceRegion: draft.sourceRegion }),
    });
  }

  private validateName(displayName: string): CaptureNameValidation {
    return validateAssetVisibleName(displayName);
  }

  private async filePendingRecord(): Promise<boolean> {
    const pending = this.pendingRecord;
    const document = this.dependencies.document.readDocument();
    if (pending === undefined || document === undefined) {
      this.setState({ phase: "failed", reason: "noOpenProject" });
      return false;
    }
    if (document.documentId !== pending.projectDocumentId) {
      this.invalidateProjectContext();
      return false;
    }
    if (this.dependencies.document.isExecutionLocked()) {
      this.setFilingFailure("executionLocked");
      return false;
    }
    const nameValidation = this.validateName(pending.displayName);
    if (!nameValidation.ok) {
      this.setFilingFailure("documentRejected");
      return false;
    }
    pending.displayName = nameValidation.displayName;
    const record: CapturedImageRecord = {
      assetId: pending.assetId,
      desiredDisplayName: pending.displayName,
      installationCode: this.dependencies.readInstallationCode(),
      minimumOrdinal: this.dependencies.readNextAssetNameOrdinal(
        pending.displayName,
      ),
      contentHash: pending.stored.contentHash,
      byteLength: pending.stored.byteLength,
      coordinateSpace: {
        spaceId: pending.stored.coordinateSpaceId,
        width: pending.stored.width,
        height: pending.stored.height,
      },
      sourceKind: pending.stored.sourceKind,
      createdAt: pending.createdAt.toISOString(),
    };
    const built = buildAddImageAssetCommand(document, record);
    if (!built.ok) {
      this.setFilingFailure("documentRejected");
      return false;
    }
    this.setState({
      phase: "committing",
      step: "filing",
      displayName: pending.displayName,
      nameValidation,
    });
    const commandOutcome = this.dependencies.document.runCommand(
      "graph.history.addCaptureAsset",
      built.command,
    );
    if (!commandOutcome.ok) {
      this.setFilingFailure("documentRejected");
      return false;
    }
    this.dependencies.recordAssetNameOrdinal(
      pending.displayName,
      built.ordinal,
    );
    const { assetId, displayName } = pending;
    const projectDocumentId = pending.projectDocumentId;
    this.pendingRecord = undefined;
    this.savePendingProjectDocumentId = projectDocumentId;
    this.setState({ phase: "committing", step: "saving", displayName });
    const generation = ++this.operationGeneration;
    const saveOutcome = await this.dependencies.document.saveProject();
    if (generation !== this.operationGeneration) {
      return false;
    }
    if (!this.isCurrentProject(projectDocumentId)) {
      this.invalidateProjectContext();
      return false;
    }
    if (saveOutcome.status !== "completed") {
      this.setState({
        phase: "saveFailed",
        assetId,
        displayName,
        reason: "saveFailed",
      });
      return false;
    }
    this.savePendingProjectDocumentId = undefined;
    this.setState({ phase: "completed", assetId, displayName });
    return true;
  }

  private setFilingFailure(
    reason: Exclude<CaptureWorkbenchFailure, "saveFailed">,
  ): void {
    const pending = this.pendingRecord;
    if (pending === undefined) {
      this.setState({ phase: "failed", reason });
      return;
    }
    this.setState({
      phase: "filingFailed",
      displayName: pending.displayName,
      nameValidation: this.validateName(pending.displayName),
      reason,
    });
  }

  private storedImageMatchesDescriptor(
    stored: StoredImageObject,
    descriptor: CaptureArtifactDescriptorV1,
  ): boolean {
    return (
      /^[0-9a-f]{64}$/u.test(stored.contentHash) &&
      stored.byteLength === descriptor.byteLength &&
      stored.width === descriptor.width &&
      stored.height === descriptor.height &&
      stored.coordinateSpaceId === descriptor.coordinateSpaceId &&
      stored.sourceKind === descriptor.sourceKind
    );
  }

  private isCurrentProject(projectDocumentId: string): boolean {
    return (
      this.dependencies.document.readDocument()?.documentId ===
      projectDocumentId
    );
  }

  private finishDiscard(): void {
    if (this.state.phase === "discarding") {
      this.setState({ phase: "idle" });
    }
  }

  private invalidateProjectContext(): void {
    this.operationGeneration += 1;
    const draft = this.prepared;
    this.prepared = undefined;
    this.pendingRecord = undefined;
    this.savePendingProjectDocumentId = undefined;
    if (draft !== undefined) {
      this.revokeUrl(draft.objectUrl);
      void draft.session.discard().catch(() => false);
    }
    this.setState({ phase: "failed", reason: "projectChanged" });
  }

  private revokePreparedUrl(): void {
    if (this.prepared !== undefined) {
      this.revokeUrl(this.prepared.objectUrl);
    }
  }

  private revokeUrl(objectUrl: string): void {
    this.dependencies.objectUrls.revoke(objectUrl);
  }

  private setState(state: CaptureWorkbenchState): void {
    if (this.disposed) {
      return;
    }
    this.state = state;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function capturePreparationFailure(cause: unknown): {
  reason: "runtimePrepareFailed" | "captureReadFailed" | "prepareFailed";
  diagnosticCode?: string;
} {
  if (!(cause instanceof CaptureSessionPreparationError)) {
    return { reason: "prepareFailed" };
  }
  const originalCause = cause.originalCause;
  const diagnosticCode =
    originalCause instanceof RuntimeCommandError
      ? originalCause.error.code
      : undefined;
  return {
    reason:
      cause.stage === "runtimePrepare"
        ? "runtimePrepareFailed"
        : "captureReadFailed",
    ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
  };
}
