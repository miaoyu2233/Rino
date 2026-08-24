/** The names the on-disk project format owns.
 *
 * Decision Gate D-007 settled the authoring format as a project directory rather than a
 * single file. These constants are the one place the extensions are written down, so the
 * later `.rino-package` export reuses them instead of restating them.
 */

/** The manifest at a project root. Selecting this file selects the project. */
export const PROJECT_MANIFEST_FILE_NAME = "project.rino.json";

/** The directory holding one file per graph. */
export const GRAPHS_DIRECTORY_NAME = "graphs";

/** The directory holding project-owned binary assets. */
export const ASSETS_DIRECTORY_NAME = "assets";

/** The content-addressed object directory for image assets, relative to the root. */
export const IMAGE_ASSET_DIRECTORY = `${ASSETS_DIRECTORY_NAME}/images`;

/** The suffix every graph file carries. */
export const GRAPH_FILE_SUFFIX = ".rino.graph.json";

/** The graph file the entry graph is stored in. */
export const ENTRY_GRAPH_FILE_NAME = `main${GRAPH_FILE_SUFFIX}`;

/** The extension reserved for the future deterministic distribution archive. */
export const PROJECT_PACKAGE_EXTENSION = ".rino-package";

/** The graph file names the editor is allowed to allocate and to read.
 *
 * The editor allocates these names itself and never derives one from user text, so a
 * manifest arriving from disk cannot direct a read or a write at a path outside the
 * graphs directory, at a reserved device name, or at a name that differs only by case.
 */
const GRAPH_FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}\.rino\.graph\.json$/u;

export function isAllocatableGraphFileName(candidate: string): boolean {
  return GRAPH_FILE_NAME_PATTERN.test(candidate);
}

/** Returns the object path of one image asset, relative to the project root.
 *
 * Storage is content-addressed, so two asset records with identical bytes share one
 * object and renaming a record never moves a file.
 */
export function imageAssetObjectPath(contentHash: string): string {
  return `${IMAGE_ASSET_DIRECTORY}/${contentHash}.png`;
}

/** Allocates a stable graph file name that no other graph in the project holds.
 *
 * The entry graph takes `main`, which matches the layout documented in the master plan;
 * every other graph takes the first free `graph-<n>`. Names are assigned once and stored
 * in the manifest, so renaming a graph never renames its file.
 */
export function allocateGraphFileName(
  isEntryGraph: boolean,
  takenFileNames: ReadonlySet<string>,
): string {
  if (isEntryGraph && !takenFileNames.has(ENTRY_GRAPH_FILE_NAME)) {
    return ENTRY_GRAPH_FILE_NAME;
  }
  for (let ordinal = 2; ordinal <= 1000; ordinal += 1) {
    const candidate = `graph-${String(ordinal)}${GRAPH_FILE_SUFFIX}`;
    if (!takenFileNames.has(candidate)) {
      return candidate;
    }
  }
  // The project schema caps a project at 64 graphs, so the search above cannot be
  // exhausted by any document the editor will accept.
  throw new Error("No graph file name is available in this project.");
}
