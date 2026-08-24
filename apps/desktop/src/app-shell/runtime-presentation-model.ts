import type {
  GraphV1,
  NodeDefinitionV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";
import type { i18n as I18next, TFunction } from "i18next";

import { resolveBilingualTitle } from "../localization/bilingual-title";

export interface ResolvedNodeName {
  title: string;
  secondaryTitle: string | undefined;
  displayAlias: string | undefined;
  typeKey: string | undefined;
  shortNodeId: string;
  isAvailable: boolean;
}

export type NodeNameIndex = ReadonlyMap<string, ResolvedNodeName>;

function resolveUnknownNodeName(
  nodeId: string,
  translate: TFunction,
): ResolvedNodeName {
  const shortNodeId = nodeId.slice(0, 8);
  return {
    title: translate("runtime.execution.unknownNode", { id: shortNodeId }),
    secondaryTitle: undefined,
    displayAlias: undefined,
    typeKey: undefined,
    shortNodeId,
    isAvailable: false,
  };
}

function resolveAvailableNodeName(
  node: GraphV1["nodes"][number],
  typeDefinition: NodeDefinitionV1 | undefined,
  translate: TFunction,
  i18next: I18next,
  language: string,
): ResolvedNodeName {
  const shortNodeId = node.nodeId.slice(0, 8);
  const trimmedDisplayAlias = node.displayAlias?.trim();
  const displayAlias =
    trimmedDisplayAlias !== undefined && trimmedDisplayAlias.length > 0
      ? trimmedDisplayAlias
      : undefined;

  if (typeDefinition !== undefined) {
    const bilingual = resolveBilingualTitle(
      translate,
      i18next,
      language,
      typeDefinition.titleKey,
      node.typeKey,
    );

    return {
      title: displayAlias ?? bilingual.title,
      secondaryTitle:
        displayAlias !== undefined
          ? bilingual.title
          : (bilingual.secondaryTitle ?? node.typeKey),
      displayAlias,
      typeKey: node.typeKey,
      shortNodeId,
      isAvailable: true,
    };
  }

  const fallbackTitle = translate("graph.node.unresolvedTitle", {
    typeKey: node.typeKey,
  });

  return {
    title: displayAlias ?? fallbackTitle,
    secondaryTitle: displayAlias !== undefined ? fallbackTitle : node.typeKey,
    displayAlias,
    typeKey: node.typeKey,
    shortNodeId,
    isAvailable: true,
  };
}

export function resolveNodeName(
  graph: GraphV1 | undefined,
  nodeId: string,
  registry: RinoNodeRegistrySnapshotV1 | undefined,
  translate: TFunction,
  i18next: I18next,
  language: string,
): ResolvedNodeName {
  const node = graph?.nodes.find((item) => item.nodeId === nodeId);

  if (node === undefined) {
    return resolveUnknownNodeName(nodeId, translate);
  }

  const typeDefinition = registry?.definitions.find(
    (d) => d.typeKey === node.typeKey,
  );
  return resolveAvailableNodeName(
    node,
    typeDefinition,
    translate,
    i18next,
    language,
  );
}

export function buildNodeNameIndex(
  graph: GraphV1 | undefined,
  registry: RinoNodeRegistrySnapshotV1 | undefined,
  translate: TFunction,
  i18next: I18next,
  language: string,
): NodeNameIndex {
  const index = new Map<string, ResolvedNodeName>();
  if (graph === undefined) {
    return index;
  }

  const definitionsByKey = new Map<string, NodeDefinitionV1>(
    registry?.definitions.map((def) => [def.typeKey, def]),
  );

  for (const node of graph.nodes) {
    index.set(
      node.nodeId,
      resolveAvailableNodeName(
        node,
        definitionsByKey.get(node.typeKey),
        translate,
        i18next,
        language,
      ),
    );
  }

  return index;
}

export function getResolvedNodeName(
  index: NodeNameIndex,
  nodeId: string,
  translate: TFunction,
): ResolvedNodeName {
  const resolved = index.get(nodeId);
  if (resolved !== undefined) {
    return resolved;
  }
  return resolveUnknownNodeName(nodeId, translate);
}
