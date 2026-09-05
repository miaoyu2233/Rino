import { create } from "zustand";

import type { SerializedProject } from "./project-format";
import type { ProjectFileSet, ProjectLocation } from "./project-transport";

/** What the project service is currently doing.
 *
 * The interface disables the actions that would collide with work in progress rather than
 * queueing them, so a repeated click cannot start a second write into the same directory.
 */
export type ProjectActivity = "idle" | "creating" | "opening" | "saving";

interface ProjectStoreState {
  /** Absent until a project is created or opened. */
  location: ProjectLocation | undefined;
  /** The file each graph is stored under, so a graph keeps its file across saves. */
  graphFileNames: ReadonlyMap<string, string>;
  /** The exact text last committed, so an unchanged project is never rewritten. */
  lastWritten: SerializedProject | undefined;
  /** Whether the opened project still needs an explicit save to migrate its format. */
  pendingMigration: boolean;
  activity: ProjectActivity;
  /** Unsaved work found in the recovery slot, awaiting the user's decision. */
  recovery: ProjectFileSet | undefined;
  setActivity: (activity: ProjectActivity) => void;
  recordCommit: (
    location: ProjectLocation,
    committed: SerializedProject,
    pendingMigration?: boolean,
  ) => void;
  offerRecovery: (recovery: ProjectFileSet | undefined) => void;
  forgetProject: () => void;
}

const NO_GRAPH_FILE_NAMES: ReadonlyMap<string, string> = new Map();

export const useProjectStore = create<ProjectStoreState>((set) => ({
  location: undefined,
  graphFileNames: NO_GRAPH_FILE_NAMES,
  lastWritten: undefined,
  pendingMigration: false,
  activity: "idle",
  recovery: undefined,
  setActivity: (activity) => {
    set({ activity });
  },
  recordCommit: (location, committed, pendingMigration = false) => {
    set({
      location,
      graphFileNames: committed.graphFileNames,
      lastWritten: committed,
      pendingMigration,
    });
  },
  offerRecovery: (recovery) => {
    set({ recovery });
  },
  forgetProject: () => {
    set({
      location: undefined,
      graphFileNames: NO_GRAPH_FILE_NAMES,
      lastWritten: undefined,
      pendingMigration: false,
      recovery: undefined,
      activity: "idle",
    });
  },
}));

/** Reads the open project's location without subscribing to anything else. */
export function useProjectLocation(): ProjectLocation | undefined {
  return useProjectStore((store) => store.location);
}
