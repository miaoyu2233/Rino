/** Drag payload formats exchanged between the node palette and the canvas.
 *
 * Custom media types rather than plain text, so a drag from another application cannot be
 * mistaken for a node insertion, and so the canvas can tell a node from a template before
 * the drop happens.
 */
export const NODE_TYPE_DRAG_FORMAT = "application/x-rino-node-type";
export const TEMPLATE_DRAG_FORMAT = "application/x-rino-workflow-template";
export const IMAGE_ASSET_DRAG_FORMAT = "application/x-rino-image-asset";
export const FUNCTION_DRAG_FORMAT = "application/x-rino-function";
export const VARIABLE_DRAG_FORMAT = "application/x-rino-variable";

export type CanvasDragKind =
  "node" | "template" | "asset" | "function" | "variable";

export type CanvasDragPayload =
  | { kind: "node" | "template" | "asset"; key: string }
  | { kind: "function"; functionGraphId: string; key?: never }
  | { kind: "variable"; variableId: string; key?: never };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

let activePaletteDrag: CanvasDragPayload | undefined;

function transferDragKind(
  transfer: Pick<DataTransfer, "types">,
): CanvasDragKind | undefined {
  const types = [...transfer.types];
  if (types.includes(NODE_TYPE_DRAG_FORMAT)) {
    return "node";
  }
  if (types.includes(TEMPLATE_DRAG_FORMAT)) {
    return "template";
  }
  if (types.includes(IMAGE_ASSET_DRAG_FORMAT)) {
    return "asset";
  }
  if (types.includes(FUNCTION_DRAG_FORMAT)) {
    return "function";
  }
  if (types.includes(VARIABLE_DRAG_FORMAT)) {
    return "variable";
  }
  return undefined;
}

function dragFormat(kind: CanvasDragKind): string {
  switch (kind) {
    case "node":
      return NODE_TYPE_DRAG_FORMAT;
    case "template":
      return TEMPLATE_DRAG_FORMAT;
    case "asset":
      return IMAGE_ASSET_DRAG_FORMAT;
    case "function":
      return FUNCTION_DRAG_FORMAT;
    case "variable":
      return VARIABLE_DRAG_FORMAT;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isValidIdentifier(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseStructuredPayload(
  raw: string,
  kind: "function" | "variable",
): CanvasDragPayload | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(value) || value["kind"] !== kind) {
    return undefined;
  }
  if (kind === "function") {
    if (
      !hasExactKeys(value, ["kind", "functionGraphId"]) ||
      !isValidIdentifier(value["functionGraphId"])
    ) {
      return undefined;
    }
    return { kind, functionGraphId: value["functionGraphId"] };
  }
  if (
    !hasExactKeys(value, ["kind", "variableId"]) ||
    !isValidIdentifier(value["variableId"])
  ) {
    return undefined;
  }
  return { kind, variableId: value["variableId"] };
}

/** Reads a drag payload without consuming it, for the drag-over preview. */
export function readDragKinds(
  transfer: Pick<DataTransfer, "types">,
): CanvasDragKind | undefined {
  return transferDragKind(transfer) ?? activePaletteDrag?.kind;
}

export function readDragPayload(
  transfer: Pick<DataTransfer, "types" | "getData">,
): CanvasDragPayload | undefined {
  const transferKind = transferDragKind(transfer);
  const kind = transferKind ?? activePaletteDrag?.kind;
  if (kind === undefined) {
    return undefined;
  }

  if (transferKind === undefined) {
    return activePaletteDrag?.kind === kind ? activePaletteDrag : undefined;
  }

  const raw = transfer.getData(dragFormat(kind));
  if (kind === "function" || kind === "variable") {
    return parseStructuredPayload(raw, kind);
  }
  if (raw.length > 0) {
    return { kind, key: raw };
  }
  return activePaletteDrag?.kind === kind ? activePaletteDrag : undefined;
}

export function writeDragPayload(
  transfer: Pick<DataTransfer, "setData">,
  payload: CanvasDragPayload,
): void {
  if (
    (payload.kind === "function" &&
      !isValidIdentifier(payload.functionGraphId)) ||
    (payload.kind === "variable" && !isValidIdentifier(payload.variableId))
  ) {
    activePaletteDrag = undefined;
    return;
  }

  activePaletteDrag = { ...payload };
  transfer.setData(
    dragFormat(payload.kind),
    payload.kind === "function" || payload.kind === "variable"
      ? JSON.stringify(payload)
      : payload.key,
  );
}

/** Ends the same-window palette drag. This keeps the fallback scoped to a drag that Rino
 * itself started, so a drop from another application can never become a node insertion. */
export function clearDragPayload(): void {
  activePaletteDrag = undefined;
}
