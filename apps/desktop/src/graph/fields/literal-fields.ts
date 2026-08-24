import type { NodeV1 } from "@rino/contracts";

import type { EditableValue } from "../commands/graph-commands";
import type { IndexedNodeDefinition } from "../node-registry-index";
import { describeType } from "../type-compatibility";
import { literalEditorFor, type FieldEditor } from "./field-editor";

/** One data input as the inspector edits it.
 *
 * A data input can receive its value from a connection or from an inline literal, never
 * from both, so the field carries the connection state and the editor together and the
 * interface can explain which one is in force.
 */
export interface LiteralField {
  portId: string;
  labelKey: string;
  descriptionKey: string | undefined;
  /** The rendered port type, shown in the field's help. */
  typeLabel: string;
  required: boolean;
  /** An edge already supplies this input, so the literal is not used. */
  connected: boolean;
  /** The definition does not offer an inline literal for this port. */
  acceptsLiteral: boolean;
  value: EditableValue | undefined;
  editor: FieldEditor;
}

/** Builds the editable data inputs of one node, in the definition's port order. */
export function buildLiteralFields(
  indexed: IndexedNodeDefinition,
  node: NodeV1,
  connectedPortIds: ReadonlySet<string>,
): LiteralField[] {
  const fields: LiteralField[] = [];
  for (const port of indexed.definition.ports) {
    if (port.direction !== "input" || port.portKind !== "data") {
      continue;
    }
    fields.push({
      portId: port.portId,
      labelKey: port.labelKey,
      descriptionKey: port.descriptionKey,
      typeLabel: describeType(port.type),
      required: port.required === true,
      connected: connectedPortIds.has(port.portId),
      acceptsLiteral: port.acceptsLiteral === true,
      // An inline value is removed by emptying its field. A required input refuses that,
      // because the resulting graph would be one the user cannot run.
      value: Object.hasOwn(node.inputValues, port.portId)
        ? node.inputValues[port.portId]
        : undefined,
      editor: literalEditorFor(port.type),
    });
  }
  return fields;
}

/** The input ports of one node that an edge already supplies. */
export function connectedInputPortIds(
  edges: readonly { targetNodeId: string; targetPortId: string }[],
  nodeId: string,
): Set<string> {
  const connected = new Set<string>();
  for (const edge of edges) {
    if (edge.targetNodeId === nodeId) {
      connected.add(edge.targetPortId);
    }
  }
  return connected;
}
