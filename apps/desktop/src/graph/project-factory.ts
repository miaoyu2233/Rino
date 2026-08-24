import type { RinoProjectDocumentV1 } from "@rino/contracts";

import { createIdentifier } from "../platform/identifiers";

export interface NewProjectOptions {
  name: string;
  entryGraphName: string;
  /** The creation timestamp, injected so a document is reproducible in tests. */
  createdAt: string;
  createIdentifier?: () => string;
}

/** Builds an empty project document with one entry graph.
 *
 * The document is complete and valid on creation: a project never exists in a partial
 * state that a later step has to repair.
 */
export function createEmptyProject(
  options: NewProjectOptions,
): RinoProjectDocumentV1 {
  const nextIdentifier = options.createIdentifier ?? createIdentifier;
  const graphId = nextIdentifier();

  return {
    schemaVersion: 1,
    documentId: nextIdentifier(),
    metadata: {
      name: options.name,
      createdAt: options.createdAt,
      updatedAt: options.createdAt,
    },
    entryGraphId: graphId,
    graphs: [
      {
        graphId,
        name: options.entryGraphName,
        kind: "entry",
        nodes: [],
        edges: [],
      },
    ],
    variables: [],
    assets: [],
    requiredCapabilities: [],
  };
}
