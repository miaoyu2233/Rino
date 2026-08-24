import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagnosticStore } from "../../diagnostics/diagnostic-store";
import {
  createInMemoryProjectService,
  type InMemoryProjectService,
} from "../../test/project-transport-double";
import { readHistoryStatus, useDocumentStore } from "../store/document-store";
import { closeProjectDocument } from "../store/project-lifecycle";
import { buildCreateTaskCommand } from "../commands/task-commands";
import {
  acceptRecovery,
  closeProject,
  createProject,
  openProject,
  saveProject,
  saveProjectAs,
  setProjectTransport,
  storeProjectCapture,
  writeAutosave,
  type ProjectDialogText,
} from "./project-actions";
import { useProjectStore } from "./project-store";

const DIALOG_TEXT: ProjectDialogText = {
  chooseLocationTitle: "选择位置",
  openTitle: "打开项目",
  manifestFileTypeLabel: "Rino 项目清单",
};

const CREATED_AT = "2026-07-27T09:00:00Z";

let service: InMemoryProjectService;
let nextTaskIdentifier = 0;

/** The shape the desktop shell rejects with, wrapped so it carries a stack trace. */
function shellRejection(code: string, detail: string): Error {
  return Object.assign(new Error(code), { code, detail });
}

function activeDocument() {
  const document = useDocumentStore.getState().history?.document;
  if (!document) {
    throw new Error("A project must be open.");
  }
  return document;
}

function dirty(): boolean {
  return readHistoryStatus(useDocumentStore.getState().history).dirty;
}

async function createFixtureProject(): Promise<void> {
  const outcome = await createProject({
    dialogText: DIALOG_TEXT,
    entryGraphName: "主图",
    now: () => CREATED_AT,
  });
  expect(outcome).toEqual({ status: "completed" });
}

/** Applies a real, undoable edit so the document becomes genuinely dirty. */
function addNode(): void {
  const document = activeDocument();
  const graph = document.graphs[0];
  if (!graph) {
    throw new Error("The project must hold an entry graph.");
  }
  const outcome = useDocumentStore.getState().runCommand("test.addNode", {
    kind: "addNode",
    graphId: graph.graphId,
    node: {
      nodeId: "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f",
      typeKey: "core.flow.start",
      typeVersion: 1,
      position: { x: 0, y: 0 },
      properties: {},
      inputValues: {},
    },
  });
  if (!outcome.ok) {
    throw new Error(`The node should have been added: ${outcome.reason}`);
  }
}

function addTask(name: string): void {
  const document = activeDocument();
  nextTaskIdentifier += 1;
  const outcome = buildCreateTaskCommand(
    document,
    name,
    () =>
      `4d5e6f70-8192-4a3b-9c0d-${String(nextTaskIdentifier).padStart(12, "0")}`,
  );
  if (!outcome.ok) {
    throw new Error(`The task should have been built: ${outcome.reason}`);
  }
  const applied = useDocumentStore
    .getState()
    .runCommand("test.addTask", outcome.value.command);
  if (!applied.ok) {
    throw new Error(`The task should have been added: ${applied.reason}`);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-27T10:00:00Z"));
  closeProjectDocument();
  useProjectStore.getState().forgetProject();
  useDiagnosticStore.setState({ problems: [], notifications: [] });
  service = createInMemoryProjectService();
  nextTaskIdentifier = 0;
  setProjectTransport(service);
});

afterEach(() => {
  vi.useRealTimers();
  setProjectTransport(undefined);
});

describe("creating a project", () => {
  it("writes the directory and opens a clean document named after it", async () => {
    await createFixtureProject();

    expect(service.writeCount).toBe(1);
    expect(activeDocument().metadata.name).toBe("示例项目");
    expect(activeDocument().metadata.updatedAt).toBe(CREATED_AT);
    expect(dirty()).toBe(false);
    expect(useProjectStore.getState().location?.directoryName).toBe("示例项目");
  });

  it("writes nothing when the user cancels the dialog", async () => {
    service.nextLocation = null;

    const outcome = await createProject({
      dialogText: DIALOG_TEXT,
      entryGraphName: "主图",
      now: () => CREATED_AT,
    });

    expect(outcome).toEqual({ status: "cancelled" });
    expect(service.writeCount).toBe(0);
    expect(useDocumentStore.getState().history).toBeUndefined();
  });

  it("reports a refused location as a project problem", async () => {
    service.chooseLocation = () =>
      Promise.reject(shellRejection("LOCATION_NOT_EMPTY", "chooseLocation"));

    const outcome = await createProject({
      dialogText: DIALOG_TEXT,
      entryGraphName: "主图",
      now: () => CREATED_AT,
    });

    expect(outcome).toEqual({ status: "failed" });
    expect(useDiagnosticStore.getState().problems[0]).toMatchObject({
      source: "project",
      code: "LOCATION_NOT_EMPTY",
    });
  });

  it("reports that the service is unavailable rather than failing later", async () => {
    setProjectTransport(undefined);

    const outcome = await createProject({
      dialogText: DIALOG_TEXT,
      entryGraphName: "主图",
      now: () => CREATED_AT,
    });

    expect(outcome).toEqual({ status: "unavailable" });
    expect(useDiagnosticStore.getState().problems[0]).toMatchObject({
      source: "project",
      titleKey: "project.problem.unavailableTitle",
    });
  });
});

describe("saving a project", () => {
  it("rewrites nothing and leaves updatedAt alone when nothing changed", async () => {
    await createFixtureProject();

    const outcome = await saveProject();

    expect(outcome).toEqual({ status: "completed" });
    expect(service.writeCount).toBe(1);
    expect(activeDocument().metadata.updatedAt).toBe(CREATED_AT);
  });

  it("stamps updatedAt and clears the dirty state when content changed", async () => {
    await createFixtureProject();
    addNode();
    expect(dirty()).toBe(true);

    vi.setSystemTime(new Date("2026-07-27T11:30:00Z"));
    const cleanupOrphanAssets = vi.fn(() => Promise.resolve(0));
    const cleanupOrphanGraphs = vi.fn(() => Promise.resolve(0));
    service.cleanupOrphanAssets = cleanupOrphanAssets;
    service.cleanupOrphanGraphs = cleanupOrphanGraphs;
    const outcome = await saveProject();

    expect(outcome).toEqual({ status: "completed" });
    expect(service.writeCount).toBe(2);
    expect(activeDocument().metadata.updatedAt).toBe(
      "2026-07-27T11:30:00.000Z",
    );
    expect(dirty()).toBe(false);
    expect(service.committed?.graphs[0]?.contents).toContain("core.flow.start");
    expect(cleanupOrphanAssets).toHaveBeenCalledOnce();
    expect(cleanupOrphanGraphs).toHaveBeenCalledOnce();
  });

  it("keeps the document dirty when the write fails", async () => {
    await createFixtureProject();
    addNode();
    service.save = () =>
      Promise.reject(shellRejection("WRITE_FAILED", "commitReplace"));

    const cleanupOrphanAssets = vi.fn(() => Promise.resolve(0));
    const cleanupOrphanGraphs = vi.fn(() => Promise.resolve(0));
    service.cleanupOrphanAssets = cleanupOrphanAssets;
    service.cleanupOrphanGraphs = cleanupOrphanGraphs;
    const outcome = await saveProject();

    expect(outcome).toEqual({ status: "failed" });
    expect(dirty()).toBe(true);
    expect(useDiagnosticStore.getState().problems[0]).toMatchObject({
      code: "WRITE_FAILED",
    });
    expect(cleanupOrphanAssets).not.toHaveBeenCalled();
    expect(cleanupOrphanGraphs).not.toHaveBeenCalled();
  });

  it("follows the project to the directory a save-as chose", async () => {
    await createFixtureProject();
    addNode();
    service.nextLocation = {
      directoryName: "副本",
      displayPath: "C:/projects/副本",
    };

    const outcome = await saveProjectAs(DIALOG_TEXT);

    expect(outcome).toEqual({ status: "completed" });
    expect(useProjectStore.getState().location?.directoryName).toBe("副本");
    expect(dirty()).toBe(false);
  });

  it("saves and reopens multiple task graph files", async () => {
    await createFixtureProject();
    addTask("刷金币");
    addTask("刷钻石");

    await expect(saveProject()).resolves.toEqual({ status: "completed" });
    const committed = service.committed;
    expect(committed?.graphs).toHaveLength(3);
    expect(committed?.graphs.map((file) => file.fileName)).toEqual([
      "main.rino.graph.json",
      "graph-2.rino.graph.json",
      "graph-3.rino.graph.json",
    ]);

    await closeProject();
    await expect(openProject(DIALOG_TEXT)).resolves.toEqual({
      status: "completed",
    });
    expect(activeDocument().graphs.map((graph) => graph.name)).toEqual([
      "主图",
      "刷金币",
      "刷钻石",
    ]);
  });

  it("does not fail a committed save when orphan cleanup fails", async () => {
    await createFixtureProject();
    addNode();
    service.cleanupOrphanAssets = () =>
      Promise.reject(new Error("asset cleanup unavailable"));
    service.cleanupOrphanGraphs = () => {
      throw new Error("graph cleanup unavailable");
    };

    await expect(saveProject()).resolves.toEqual({ status: "completed" });
    expect(dirty()).toBe(false);
  });
});

describe("storing a prepared capture", () => {
  it("uses the project transport and returns safe image metadata", async () => {
    const storeCapture = vi.fn(service.storeCapture);
    service.storeCapture = storeCapture;

    await expect(storeProjectCapture("capture-token")).resolves.toMatchObject({
      contentHash: "0a".repeat(32),
      coordinateSpaceId: "capture-space",
    });
    expect(storeCapture).toHaveBeenCalledWith("capture-token");
  });

  it("reports a structured storage failure and preserves the rejection", async () => {
    service.storeCapture = () =>
      Promise.reject(shellRejection("CAPTURE_UNAVAILABLE", "expired"));

    await expect(storeProjectCapture("capture-token")).rejects.toMatchObject({
      code: "CAPTURE_UNAVAILABLE",
    });
    expect(useDiagnosticStore.getState().problems[0]).toMatchObject({
      code: "CAPTURE_UNAVAILABLE",
    });
  });
});

describe("opening a project", () => {
  it("reopens the document a save produced", async () => {
    await createFixtureProject();
    addNode();
    await saveProject();
    const saved = activeDocument();
    await closeProject();

    const outcome = await openProject(DIALOG_TEXT);

    expect(outcome).toEqual({ status: "completed" });
    expect(activeDocument()).toStrictEqual(saved);
    expect(dirty()).toBe(false);
  });

  it("does not adopt a directory whose files it could not read", async () => {
    await createFixtureProject();
    await closeProject();
    service.storedFiles = { manifest: "{ not json", graphs: [] };
    const released = vi.fn(() => Promise.resolve());
    service.close = released;

    const outcome = await openProject(DIALOG_TEXT);

    expect(outcome).toEqual({ status: "failed" });
    expect(released).toHaveBeenCalledTimes(1);
    expect(useDocumentStore.getState().history).toBeUndefined();
    expect(useDiagnosticStore.getState().problems[0]).toMatchObject({
      code: "notJson",
    });
  });

  it("refuses a project written by a newer build without touching it", async () => {
    await createFixtureProject();
    await closeProject();
    const stored = service.storedFiles;
    if (!stored) {
      throw new Error("The fixture must have written a project.");
    }
    const manifest: unknown = JSON.parse(stored.manifest);
    service.storedFiles = {
      manifest: JSON.stringify({ ...(manifest as object), schemaVersion: 3 }),
      graphs: stored.graphs,
    };
    const writesBefore = service.writeCount;

    const outcome = await openProject(DIALOG_TEXT);

    expect(outcome).toEqual({ status: "failed" });
    expect(service.writeCount).toBe(writesBefore);
    expect(useDiagnosticStore.getState().problems[0]).toMatchObject({
      code: "unsupportedVersion",
    });
  });
});

describe("recovering unsaved work", () => {
  it("writes unsaved work to the recovery slot without touching the project", async () => {
    await createFixtureProject();
    addNode();
    const writesBefore = service.writeCount;

    const outcome = await writeAutosave();

    expect(outcome).toEqual({ status: "completed" });
    expect(service.writeCount).toBe(writesBefore);
    expect(service.autosaved?.graphs[0]?.contents).toContain("core.flow.start");
  });

  it("offers the recovery slot on open and restores it as unsaved work", async () => {
    await createFixtureProject();
    addNode();
    await writeAutosave();
    const recovered = activeDocument();
    await closeProject();
    service.storedRecovery = service.autosaved;

    await openProject(DIALOG_TEXT);
    const offered = useProjectStore.getState().recovery;
    expect(offered).toBeDefined();
    // The version on disk is the one without the edit.
    expect(activeDocument().graphs[0]?.nodes).toHaveLength(0);

    if (!offered) {
      throw new Error("Recovery should have been offered.");
    }
    const outcome = acceptRecovery(offered);

    expect(outcome).toEqual({ status: "completed" });
    expect(activeDocument()).toStrictEqual(recovered);
    expect(dirty()).toBe(true);
    expect(useProjectStore.getState().recovery).toBeUndefined();
  });

  it("clears the recovery slot once the work is saved", async () => {
    await createFixtureProject();
    addNode();
    await writeAutosave();

    await saveProject();

    expect(service.autosaved).toBeUndefined();
  });
});

describe("closing a project", () => {
  it("forgets the document and the location", async () => {
    await createFixtureProject();

    await closeProject();

    expect(useDocumentStore.getState().history).toBeUndefined();
    expect(useProjectStore.getState().location).toBeUndefined();
  });
});
