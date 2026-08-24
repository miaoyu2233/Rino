import type { NodeV1 } from "@rino/contracts";

export const TASK_CHOICE_TYPE_KEY = "core.logic.taskChoice";
export const CASE_OVERLAY_TYPE_KEYS = [
  "core.logic.caseOverlayBool",
  "core.logic.caseOverlayNumber",
  "core.logic.caseOverlayImageRef",
] as const;
export const MAXIMUM_TASK_CHOICE_CASES = 16;
export const TASK_CHOICE_UNMATCHED_PORT_ID = "unmatched";

const CASE_ID_PATTERN = /^[a-z][a-zA-Z0-9]{0,63}$/;
const CASE_PORT_PATTERN = /^case([1-9]|1[0-6])$/;
const MAXIMUM_TASK_CHOICE_LABEL_LENGTH = 80;

export interface TaskChoiceCase {
  caseId: string;
  portId: string;
  label: string;
}

export interface TaskChoiceDynamicPortState {
  taskChoiceCases: readonly TaskChoiceCase[];
}

type CaseCatalogTypeKey =
  typeof TASK_CHOICE_TYPE_KEY | (typeof CASE_OVERLAY_TYPE_KEYS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCase(value: unknown): TaskChoiceCase | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const caseId = value["caseId"];
  const portId = value["portId"];
  const rawLabel = value["label"];
  if (
    typeof caseId !== "string" ||
    !CASE_ID_PATTERN.test(caseId) ||
    typeof portId !== "string" ||
    !CASE_PORT_PATTERN.test(portId) ||
    typeof rawLabel !== "string"
  ) {
    return undefined;
  }
  const label = rawLabel.trim();
  if (
    label.length === 0 ||
    Array.from(label).length > MAXIMUM_TASK_CHOICE_LABEL_LENGTH
  ) {
    return undefined;
  }
  return { caseId, portId, label };
}

function isCaseCatalogNodeType(typeKey: string): typeKey is CaseCatalogTypeKey {
  return (
    typeKey === TASK_CHOICE_TYPE_KEY ||
    (CASE_OVERLAY_TYPE_KEYS as readonly string[]).includes(typeKey)
  );
}

/** Reads the bounded, persisted case catalog at the untrusted graph boundary. */
export function caseCatalogCases(
  node: NodeV1,
): readonly TaskChoiceCase[] | undefined {
  if (!isCaseCatalogNodeType(node.typeKey)) {
    return undefined;
  }
  const rawCases = node.dynamicPortState?.["taskChoiceCases"];
  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    return undefined;
  }

  const cases: TaskChoiceCase[] = [];
  const caseIds = new Set<string>();
  const portIds = new Set<string>();
  for (const rawCase of rawCases.slice(0, MAXIMUM_TASK_CHOICE_CASES + 1)) {
    const parsed = readCase(rawCase);
    if (
      parsed === undefined ||
      caseIds.has(parsed.caseId) ||
      portIds.has(parsed.portId)
    ) {
      return undefined;
    }
    caseIds.add(parsed.caseId);
    portIds.add(parsed.portId);
    cases.push(parsed);
  }
  return rawCases.length > MAXIMUM_TASK_CHOICE_CASES ? undefined : cases;
}

/** Keeps the task settings API scoped to task-choice nodes. */
export function taskChoiceCases(
  node: NodeV1,
): readonly TaskChoiceCase[] | undefined {
  return node.typeKey === TASK_CHOICE_TYPE_KEY
    ? caseCatalogCases(node)
    : undefined;
}

export function isTaskChoiceNode(node: NodeV1): boolean {
  return node.typeKey === TASK_CHOICE_TYPE_KEY;
}

export function initialTaskChoiceDynamicPortState(): NodeV1["dynamicPortState"] {
  return {
    taskChoiceCases: [
      { caseId: "case1", portId: "case1", label: "Case 1" },
      { caseId: "case2", portId: "case2", label: "Case 2" },
    ],
  };
}

export function taskChoiceCaseForPort(
  node: NodeV1,
  portId: string,
): TaskChoiceCase | undefined {
  return taskChoiceCases(node)?.find(
    (candidate) => candidate.portId === portId,
  );
}

export function caseCatalogCaseForPort(
  node: NodeV1,
  portId: string,
): TaskChoiceCase | undefined {
  return caseCatalogCases(node)?.find(
    (candidate) => candidate.portId === portId,
  );
}

export function taskChoiceCaseForId(
  node: NodeV1,
  caseId: string,
): TaskChoiceCase | undefined {
  return taskChoiceCases(node)?.find(
    (candidate) => candidate.caseId === caseId,
  );
}

export function caseCatalogCaseForId(
  node: NodeV1,
  caseId: string,
): TaskChoiceCase | undefined {
  return caseCatalogCases(node)?.find(
    (candidate) => candidate.caseId === caseId,
  );
}

export function isVisibleCaseCatalogPort(
  node: NodeV1,
  portId: string,
): boolean {
  if (!isCaseCatalogNodeType(node.typeKey)) {
    return true;
  }
  if (node.typeKey === TASK_CHOICE_TYPE_KEY) {
    if (
      portId === "run" ||
      portId === "selectedCaseId" ||
      portId === TASK_CHOICE_UNMATCHED_PORT_ID
    ) {
      return true;
    }
  } else if (!CASE_PORT_PATTERN.test(portId)) {
    return true;
  }
  const cases = caseCatalogCases(node);
  // Keep every declared case port visible when state is malformed. This makes a
  // corrupt connection inspectable instead of silently hiding authored data.
  return cases === undefined
    ? CASE_PORT_PATTERN.test(portId)
    : cases.some((candidate) => candidate.portId === portId);
}

export function isVisibleTaskChoicePort(node: NodeV1, portId: string): boolean {
  return isTaskChoiceNode(node) ? isVisibleCaseCatalogPort(node, portId) : true;
}

export function taskChoicePortLabel(
  node: NodeV1,
  portId: string,
): string | undefined {
  return node.typeKey === TASK_CHOICE_TYPE_KEY
    ? caseCatalogCaseForPort(node, portId)?.label
    : undefined;
}

export function caseCatalogPortLabel(
  node: NodeV1,
  portId: string,
): string | undefined {
  return caseCatalogCaseForPort(node, portId)?.label;
}

export function taskChoiceSelection(node: NodeV1): string | undefined {
  if (!isTaskChoiceNode(node)) {
    return undefined;
  }
  const value = node.properties["selectedCaseId"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function taskChoiceHasUnmatchedSelection(node: NodeV1): boolean {
  const selected = taskChoiceSelection(node);
  return (
    selected !== undefined &&
    taskChoiceCases(node) !== undefined &&
    taskChoiceCaseForId(node, selected) === undefined
  );
}
