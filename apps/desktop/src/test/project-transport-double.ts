import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { setProjectTransport } from "../graph/project/project-actions";
import { useProjectStore } from "../graph/project/project-store";
import type {
  ProjectFileSet,
  ProjectLocation,
  ProjectTransport,
} from "../graph/project/project-transport";

export interface InMemoryProjectService extends ProjectTransport {
  /** The files the last committed write produced. */
  committed: ProjectFileSet | undefined;
  /** The recovery slot's contents. */
  autosaved: ProjectFileSet | undefined;
  /** What the next dialog answers, or null to simulate a cancelled dialog. */
  nextLocation: ProjectLocation | null;
  /** Files a subsequent open returns, when a test wants to control what is on disk. */
  storedFiles: ProjectFileSet | undefined;
  /** Recovery offered by the next open. */
  storedRecovery: ProjectFileSet | undefined;
  /** How many times a full write reached the shell. */
  writeCount: number;
}

const DEFAULT_LOCATION: ProjectLocation = {
  directoryName: "示例项目",
  displayPath: "C:/projects/示例项目",
};

/** A project transport that keeps a project directory in memory.
 *
 * Tests drive the real actions, the real serializer, and the real parser through this
 * double, so what they prove about persistence is what the production path does.
 */
export function createInMemoryProjectService(): InMemoryProjectService {
  const service: InMemoryProjectService = {
    committed: undefined,
    autosaved: undefined,
    nextLocation: DEFAULT_LOCATION,
    storedFiles: undefined,
    storedRecovery: undefined,
    writeCount: 0,
    chooseLocation: () => Promise.resolve(service.nextLocation),
    open: () =>
      Promise.resolve(
        service.storedFiles === undefined
          ? null
          : {
              location: service.nextLocation ?? DEFAULT_LOCATION,
              files: service.storedFiles,
              recovery: service.storedRecovery ?? null,
            },
      ),
    create: (files) => {
      service.committed = files;
      service.storedFiles = files;
      service.writeCount += 1;
      return Promise.resolve(service.nextLocation ?? DEFAULT_LOCATION);
    },
    save: (files) => {
      service.committed = files;
      service.storedFiles = files;
      service.writeCount += 1;
      return Promise.resolve(service.nextLocation ?? DEFAULT_LOCATION);
    },
    saveAs: (files) => {
      service.committed = files;
      service.storedFiles = files;
      service.writeCount += 1;
      return Promise.resolve(service.nextLocation ?? DEFAULT_LOCATION);
    },
    storeCapture: () =>
      Promise.resolve({
        contentHash: "0a".repeat(32),
        byteLength: 24,
        width: 1,
        height: 1,
        coordinateSpaceId: "capture-space",
        sourceKind: "deviceCapture",
      }),
    readImageAsset: () => Promise.resolve(new Uint8Array([137, 80, 78, 71])),
    cleanupOrphanAssets: () => Promise.resolve(0),
    cleanupOrphanGraphs: () => Promise.resolve(0),
    close: () => Promise.resolve(),
    writeAutosave: (files) => {
      service.autosaved = files;
      return Promise.resolve();
    },
    discardRecovery: () => {
      service.autosaved = undefined;
      return Promise.resolve();
    },
  };
  return service;
}

/** Installs a fresh in-memory project service and resets the project store. */
export function installInMemoryProjectService(): InMemoryProjectService {
  const service = createInMemoryProjectService();
  setProjectTransport(service);
  useProjectStore.getState().forgetProject();
  return service;
}

/** Creates a project through the empty state, the way a user reaches it first.
 *
 * The canvas region is queried explicitly because the top bar offers the same action,
 * and waiting for the graph surface is what makes the asynchronous write observable.
 */
export async function createProjectFromEmptyState(): Promise<void> {
  const workspace = within(screen.getByLabelText("图编辑画布"));
  await userEvent.click(workspace.getByRole("button", { name: "新建项目" }));
  await screen.findByLabelText("节点图");
}
