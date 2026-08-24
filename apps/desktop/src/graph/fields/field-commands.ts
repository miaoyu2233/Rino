import type { LocalizationKey } from "../../diagnostics/diagnostic-model";
import type { EditableValue, GraphCommand } from "../commands/graph-commands";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";

/** Runs one field edit against the graph the user is editing.
 *
 * Every field edit arrives here, whichever surface it came from, so a value changed in
 * the inspector and the same value changed on the node produce one identical command and
 * one identical undo entry. The stores are read at commit time rather than captured when
 * a control rendered, so an edit can never be applied to a graph an earlier command has
 * already replaced.
 */
function runFieldCommand(
  label: LocalizationKey,
  build: (graphId: string) => GraphCommand,
): boolean {
  const graphId = useEditorSessionStore.getState().activeGraphId;
  if (graphId === undefined) {
    return false;
  }
  return useDocumentStore.getState().runCommand(label, build(graphId)).ok;
}

/** Writes a node property, or removes it when the value is absent. */
export function commitNodeProperty(
  nodeId: string,
  propertyKey: string,
  value: EditableValue | undefined,
  label: LocalizationKey = "graph.history.setProperty",
): boolean {
  return runFieldCommand(label, (graphId) =>
    value === undefined
      ? { kind: "setNodeProperty", graphId, nodeId, propertyKey }
      : { kind: "setNodeProperty", graphId, nodeId, propertyKey, value },
  );
}

/** Writes an inline literal for a data input, or removes it when the value is absent. */
export function commitInputLiteral(
  nodeId: string,
  portId: string,
  value: EditableValue | undefined,
): boolean {
  return runFieldCommand(
    value === undefined
      ? "graph.history.clearInputValue"
      : "graph.history.setInputValue",
    (graphId) =>
      value === undefined
        ? { kind: "setInputValue", graphId, nodeId, portId }
        : { kind: "setInputValue", graphId, nodeId, portId, value },
  );
}

/** Writes the authoring alias, or removes it when the text is empty.
 *
 * The alias is presentation metadata: it never changes the node's type key, ports, or
 * execution identity, so renaming is always safe to undo as an ordinary edit.
 */
export function commitDisplayAlias(nodeId: string, alias: string): boolean {
  const trimmed = alias.trim();
  return runFieldCommand("graph.history.setAlias", (graphId) =>
    trimmed.length === 0
      ? { kind: "setDisplayAlias", graphId, nodeId }
      : { kind: "setDisplayAlias", graphId, nodeId, displayAlias: trimmed },
  );
}
