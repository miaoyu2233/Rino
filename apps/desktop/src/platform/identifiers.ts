/** Creates an identifier for a document, graph, node, edge, or asset.
 *
 * Identifiers are random version 4 UUIDs so a fragment pasted between projects, or a
 * graph merged from another author, cannot collide with existing content.
 */
export function createIdentifier(): string {
  return crypto.randomUUID();
}
