import type {
  GraphV1,
  RinoNodeRegistrySnapshotV1,
  NodeV1,
} from "@rino/contracts";

import {
  isTaskChoiceNode,
  taskChoiceCases,
  taskChoiceHasUnmatchedSelection,
  taskChoiceSelection,
  type TaskChoiceCase,
} from "../../graph/task-choice";

export interface TaskSettingView {
  nodeId: string;
  titleKey: string;
  displayAlias: string | undefined;
  settingKey: string;
  selectedCaseId: string | undefined;
  cases: readonly TaskChoiceCase[];
  stateValid: boolean;
  unmatched: boolean;
}

function nodeDefinition(
  node: NodeV1,
  registry: RinoNodeRegistrySnapshotV1 | undefined,
) {
  return registry?.definitions.find(
    (definition) => definition.typeKey === node.typeKey,
  );
}

function propertyValue(
  node: NodeV1,
  registry: RinoNodeRegistrySnapshotV1 | undefined,
  key: string,
): unknown {
  if (Object.hasOwn(node.properties, key)) {
    return node.properties[key];
  }
  return nodeDefinition(node, registry)?.propertyDefaults?.[key];
}

function exposed(
  node: NodeV1,
  registry: RinoNodeRegistrySnapshotV1 | undefined,
): boolean {
  return propertyValue(node, registry, "exposeInTaskSettings") === true;
}

function settingKey(
  node: NodeV1,
  registry: RinoNodeRegistrySnapshotV1 | undefined,
): string {
  const value = propertyValue(node, registry, "settingKey");
  return typeof value === "string" && value.length > 0 ? value : node.nodeId;
}

function selectedCaseId(
  node: NodeV1,
  registry: RinoNodeRegistrySnapshotV1 | undefined,
): string | undefined {
  const explicit = taskChoiceSelection(node);
  if (explicit !== undefined) {
    return explicit;
  }
  const fallback = propertyValue(node, registry, "selectedCaseId");
  return typeof fallback === "string" && fallback.length > 0
    ? fallback
    : undefined;
}

/** Returns only exposed task-choice nodes, preserving graph order for stable settings UI. */
export function readTaskSettings(
  graph: GraphV1 | undefined,
  registry: RinoNodeRegistrySnapshotV1 | undefined,
): readonly TaskSettingView[] {
  if (graph === undefined) {
    return [];
  }
  return graph.nodes.flatMap((node) => {
    if (!isTaskChoiceNode(node) || !exposed(node, registry)) {
      return [];
    }
    const cases = taskChoiceCases(node);
    return [
      {
        nodeId: node.nodeId,
        titleKey:
          nodeDefinition(node, registry)?.titleKey ??
          "node.core.logic.taskChoice.title",
        displayAlias: node.displayAlias,
        settingKey: settingKey(node, registry),
        selectedCaseId: selectedCaseId(node, registry),
        cases: cases ?? [],
        stateValid: cases !== undefined,
        unmatched:
          cases === undefined ? false : taskChoiceHasUnmatchedSelection(node),
      },
    ];
  });
}

/** A primitive signature keeps the task switcher from subscribing to every node field. */
export function taskSettingsSignature(graph: GraphV1 | undefined): string {
  if (graph === undefined) {
    return "";
  }
  return JSON.stringify(
    graph.nodes
      .filter((node) => node.typeKey === "core.logic.taskChoice")
      .map((node) => ({
        nodeId: node.nodeId,
        displayAlias: node.displayAlias,
        properties: node.properties,
        dynamicPortState: node.dynamicPortState,
      })),
  );
}
