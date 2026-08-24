import type {
  NodeCategoryV1,
  PortDefinitionV1,
  RinoNodeRegistrySnapshotV1,
  TypeDescriptorV1,
} from "@rino/contracts";

import { nodeCategoryColorTokens } from "../../design-system/tokens";
import { isAssignable } from "../type-compatibility";
import { variableNodeRoleForTypeKey } from "../variables/variable-authoring";

export type PaletteEntryKind = "node" | "template";

/** Workflow templates are grouped beside the node categories rather than inside one,
 * because a template is authoring assistance rather than a kind of node. */
export type PaletteCategory = NodeCategoryV1 | "common" | "templates";

export interface PaletteEntry {
  kind: PaletteEntryKind;
  /** Node type key or template key. Unique across both kinds by construction. */
  key: string;
  titleKey: string;
  descriptionKey: string;
  iconKey: string;
  category: PaletteCategory;
  keywordKeys: readonly string[];
  /** For a template, the union of the capabilities its nodes need. */
  requiredCapabilities: readonly string[];
  /** Empty for a template. Used by the connection-drop picker to decide whether an entry
   * can receive or produce the type the user dragged from. */
  ports: readonly PortDefinitionV1[];
  /** Template endpoints resolve to ports on the ordinary nodes created during expansion.
   * They are optional so test-only and extension entries can remain node-shaped. */
  templatePorts?: readonly PaletteTemplatePort[];
}

export interface PaletteTemplatePort {
  proxyPortId: string;
  placeholderId: string;
  portId: string;
  port: PortDefinitionV1;
}

/** Fixed display order. It follows the registry contract's category order so the palette
 * does not reshuffle when a snapshot lists definitions differently. */
export const paletteCategoryOrder: readonly PaletteCategory[] = [
  "common",
  ...(Object.keys(nodeCategoryColorTokens) as NodeCategoryV1[]),
  "templates",
];

/** The authoring surfaces users reach for in the normal recognize-decide-act loop.
 * The same priority is shared by the library and connection-drop picker so learned
 * positions remain consistent between both entry points. */
export const commonPaletteEntryKeys = [
  "template.imageRecognition",
  "template.textRecognition",
  "template.recognizeNumberAndBranch",
  "core.flow.sequence",
  "core.flow.sequenceOrder",
  "core.flow.parallel",
  "core.math.arithmetic",
  "text.readValue",
  "automation.launchAndroidApp",
  "automation.pressAndroidKey",
  "automation.swipe",
  "core.logic.branch",
  "core.time.delay",
  "core.flow.boundedRetry",
  "core.diagnostic.log",
] as const;

const commonPaletteEntryRanks = new Map<string, number>(
  commonPaletteEntryKeys.map((key, rank) => [key, rank]),
);

export function prioritizePaletteEntries(
  entries: readonly PaletteEntry[],
): PaletteEntry[] {
  return entries
    .map((entry, order) => ({
      entry,
      order,
      rank: commonPaletteEntryRanks.get(entry.key) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) =>
      left.rank === right.rank
        ? left.order - right.order
        : left.rank - right.rank,
    )
    .map(({ entry }) => entry);
}

export function recommendConnectionTargets(
  entries: readonly PaletteEntry[],
  origin: ConnectionOrigin,
  sourceTypeKey?: string,
): PaletteEntry[] {
  const type =
    origin.type.kind === "optional" ? origin.type.value : origin.type;
  const recommendedKeys =
    origin.portKind === "execution"
      ? [
          "template.imageRecognition",
          "template.textRecognition",
          "template.recognizeNumberAndBranch",
          ...(sourceTypeKey === "core.time.delay" ||
          sourceTypeKey?.startsWith("automation.click")
            ? ["core.diagnostic.log", "core.logic.branch", "automation.swipe"]
            : ["core.logic.branch", "core.time.delay", "core.diagnostic.log"]),
        ]
      : type.kind === "ocrResult"
        ? ["text.readValue"]
        : type.kind === "string"
          ? ["core.diagnostic.log", "text.parseNumber"]
          : type.kind === "number"
            ? [
                "core.math.arithmetic",
                "core.logic.numberCompare",
                "core.diagnostic.log",
              ]
            : type.kind === "bool"
              ? ["core.logic.branch"]
              : type.kind === "rect"
                ? ["automation.clickRectCenter"]
                : type.kind === "point"
                  ? ["automation.clickPoint"]
                  : type.kind === "imageRef"
                    ? ["template.imageRecognition", "template.textRecognition"]
                    : [];
  const ranks = new Map(recommendedKeys.map((key, rank) => [key, rank]));
  return entries
    .map((entry, order) => ({ entry, order, rank: ranks.get(entry.key) }))
    .sort((left, right) =>
      left.rank === undefined && right.rank === undefined
        ? left.order - right.order
        : left.rank === undefined
          ? 1
          : right.rank === undefined
            ? -1
            : left.rank - right.rank,
    )
    .map(({ entry }) => entry);
}

function templatePortsFor(
  template: NonNullable<
    RinoNodeRegistrySnapshotV1["workflowTemplates"]
  >[number],
  definitionsByKey: ReadonlyMap<string, { ports: readonly PortDefinitionV1[] }>,
): PaletteTemplatePort[] {
  const nodesByPlaceholder = new Map(
    template.nodes.map((node) => [node.placeholderId, node]),
  );
  const exposedPorts = [
    ...(template.exposedPorts ?? []),
    ...(template.workflowGroup?.exposedPorts ?? []),
  ];
  const seenProxyPortIds = new Set<string>();
  return exposedPorts.flatMap((exposed) => {
    if (seenProxyPortIds.has(exposed.proxyPortId)) {
      return [];
    }
    const templateNode = nodesByPlaceholder.get(exposed.placeholderId);
    const definition =
      templateNode === undefined
        ? undefined
        : definitionsByKey.get(templateNode.typeKey);
    const port = definition?.ports.find(
      (candidate) => candidate.portId === exposed.portId,
    );
    if (port === undefined) {
      return [];
    }
    seenProxyPortIds.add(exposed.proxyPortId);
    return [
      {
        proxyPortId: exposed.proxyPortId,
        placeholderId: exposed.placeholderId,
        portId: exposed.portId,
        port,
      },
    ];
  });
}

const PALETTE_HIDDEN_NODE_TYPE_KEYS = new Set([
  "core.image.projectAsset",
  // Retained for existing graphs that map task choices to typed values, but not offered
  // for new graphs because task-specific value overlays are outside the authoring model.
  "core.logic.caseOverlayBool",
  "core.logic.caseOverlayImageRef",
  "core.logic.caseOverlayNumber",
  // Kept for opening legacy graphs, but the explicit end-path node is the standalone choice.
  "core.flow.stop",
  // Kept for opening legacy graphs and registry compatibility, but not standalone palette entries.
  "text.readText",
  "text.readNumber",
  // Integrated recognition workflows are the supported authoring surface. These reviewed
  // primitives remain registered for workflow expansion and existing project compatibility.
  "vision.ocr",
  "vision.templateMatch",
  "vision.featureMatch",
  "vision.colorMatch",
  // Kept for opening legacy graphs and recognition groups, but not a standalone palette entry.
  "automation.clickRectCenter",
  // Variable nodes and generic function calls are inserted through their authoring surfaces.
  "core.function.call",
]);

const VARIABLE_KEYWORD_KEYS = [
  "node.core.variable.keyword.variable",
  "node.core.variable.keyword.get",
  "node.core.variable.keyword.set",
] as const;

function paletteKeywordKeys(
  typeKey: string,
  keywordKeys: readonly string[] | undefined,
): readonly string[] {
  const role = variableNodeRoleForTypeKey(typeKey);
  if (role === undefined) {
    return keywordKeys ?? [];
  }
  return [
    ...(keywordKeys ?? []),
    VARIABLE_KEYWORD_KEYS[0],
    role === "getter" ? VARIABLE_KEYWORD_KEYS[1] : VARIABLE_KEYWORD_KEYS[2],
  ];
}

export function buildPaletteEntries(
  registry: RinoNodeRegistrySnapshotV1,
): PaletteEntry[] {
  const definitionsByKey = new Map(
    registry.definitions.map((definition) => [definition.typeKey, definition]),
  );

  const nodeEntries: PaletteEntry[] = registry.definitions
    .filter(
      (definition) =>
        !PALETTE_HIDDEN_NODE_TYPE_KEYS.has(definition.typeKey) &&
        variableNodeRoleForTypeKey(definition.typeKey) === undefined,
    )
    .map((definition) => ({
      kind: "node",
      key: definition.typeKey,
      titleKey: definition.titleKey,
      descriptionKey: definition.descriptionKey,
      iconKey: definition.iconKey,
      category: definition.category,
      keywordKeys: paletteKeywordKeys(
        definition.typeKey,
        definition.keywordKeys,
      ),
      requiredCapabilities: definition.requiredCapabilities ?? [],
      ports: definition.ports,
    }));

  const workflowEntries: PaletteEntry[] = [];
  const templateEntries: PaletteEntry[] = [];
  for (const template of registry.workflowTemplates ?? []) {
    const capabilities = new Set<string>();
    for (const templateNode of template.nodes) {
      for (const capability of definitionsByKey.get(templateNode.typeKey)
        ?.requiredCapabilities ?? []) {
        capabilities.add(capability);
      }
    }
    const entry: PaletteEntry = {
      kind: "template",
      key: template.templateKey,
      titleKey: template.titleKey,
      descriptionKey: template.descriptionKey,
      iconKey: template.iconKey,
      category: template.workflowGroup === undefined ? "templates" : "vision",
      keywordKeys: [],
      requiredCapabilities: [...capabilities],
      ports: [],
      templatePorts: templatePortsFor(template, definitionsByKey),
    };
    if (template.workflowGroup === undefined) {
      templateEntries.push(entry);
    } else {
      workflowEntries.push(entry);
    }
  }

  // Smart workflow entries lead their category because they are the recommended compact
  // authoring surface; the ordinary nodes they expand into remain available underneath.
  return [...workflowEntries, ...nodeEntries, ...templateEntries];
}

/** The translated text an entry can be found by.
 *
 * Titles and keywords are supplied for every display language, so a user typing English
 * finds a node while the interface is Simplified Chinese and the other way round.
 */
export interface PaletteEntryText {
  titles: readonly string[];
  keywords: readonly string[];
  descriptions: readonly string[];
}

export function normalizeSearchTerm(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

const TITLE_PREFIX_SCORE = 100;
const TITLE_CONTAINS_SCORE = 80;
const KEYWORD_SCORE = 60;
const TYPE_KEY_SCORE = 40;
const DESCRIPTION_SCORE = 20;

/** Scores one entry against a normalized query. Zero means no match.
 *
 * A title match outranks a keyword, which outranks the technical key, which outranks a
 * description mention, so the node a user is naming comes first rather than every node
 * whose help text happens to mention it.
 */
export function scoreEntry(
  entry: PaletteEntry,
  text: PaletteEntryText,
  normalizedQuery: string,
): number {
  if (normalizedQuery.length === 0) {
    return 1;
  }

  let score = 0;
  for (const title of text.titles) {
    const normalized = normalizeSearchTerm(title);
    if (normalized.startsWith(normalizedQuery)) {
      score = Math.max(score, TITLE_PREFIX_SCORE);
    } else if (normalized.includes(normalizedQuery)) {
      score = Math.max(score, TITLE_CONTAINS_SCORE);
    }
  }
  if (score >= TITLE_CONTAINS_SCORE) {
    return score;
  }

  for (const keyword of text.keywords) {
    if (normalizeSearchTerm(keyword).includes(normalizedQuery)) {
      score = Math.max(score, KEYWORD_SCORE);
    }
  }
  if (normalizeSearchTerm(entry.key).includes(normalizedQuery)) {
    score = Math.max(score, TYPE_KEY_SCORE);
  }
  for (const description of text.descriptions) {
    if (normalizeSearchTerm(description).includes(normalizedQuery)) {
      score = Math.max(score, DESCRIPTION_SCORE);
    }
  }
  return score;
}

export type PaletteTextLookup = (entry: PaletteEntry) => PaletteEntryText;

/** Filters and ranks entries. An empty query keeps every entry in registry order. */
export function searchPalette(
  entries: readonly PaletteEntry[],
  lookup: PaletteTextLookup,
  query: string,
): PaletteEntry[] {
  const normalizedQuery = normalizeSearchTerm(query);
  const scored: { entry: PaletteEntry; score: number; order: number }[] = [];

  entries.forEach((entry, order) => {
    const score = scoreEntry(entry, lookup(entry), normalizedQuery);
    if (score > 0) {
      scored.push({ entry, score, order });
    }
  });

  scored.sort((left, right) =>
    left.score === right.score
      ? left.order - right.order
      : right.score - left.score,
  );
  return scored.map((item) => item.entry);
}

export interface PaletteGroup {
  category: PaletteCategory;
  entries: PaletteEntry[];
}

/** Groups entries into their categories, preserving the order within each group and
 * dropping categories that no entry uses. */
export function groupPaletteEntries(
  entries: readonly PaletteEntry[],
): PaletteGroup[] {
  const groups = new Map<PaletteCategory, PaletteEntry[]>();
  const prioritizedEntries = prioritizePaletteEntries(entries);
  const commonEntries = prioritizedEntries.filter((entry) =>
    commonPaletteEntryRanks.has(entry.key),
  );
  if (commonEntries.length > 0) {
    groups.set("common", commonEntries);
  }
  for (const entry of prioritizedEntries) {
    const existing = groups.get(entry.category);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(entry.category, [entry]);
    }
  }

  return paletteCategoryOrder.flatMap((category) => {
    const grouped = groups.get(category);
    return grouped ? [{ category, entries: grouped }] : [];
  });
}

export type CapabilityState = "satisfied" | "unavailable" | "unknown";

/** Reports whether the active backend can run an entry.
 *
 * `unknown` is deliberately distinct from `unavailable`: before a runtime connects the
 * editor does not know what the backend provides, and claiming a node is unavailable
 * would be a guess.
 */
export function capabilityState(
  entry: PaletteEntry,
  availableCapabilities: ReadonlySet<string> | undefined,
): CapabilityState {
  if (entry.requiredCapabilities.length === 0) {
    return "satisfied";
  }
  if (!availableCapabilities) {
    return "unknown";
  }
  return entry.requiredCapabilities.every((capability) =>
    availableCapabilities.has(capability),
  )
    ? "satisfied"
    : "unavailable";
}

/** The port a connection is being dragged from. */
export interface ConnectionOrigin {
  type: TypeDescriptorV1;
  portKind: "execution" | "data";
  /** The dragged port's own direction. A candidate must offer the opposite. */
  direction: "input" | "output";
}

function acceptsOrigin(
  port: PortDefinitionV1,
  origin: ConnectionOrigin,
): boolean {
  if (port.portKind !== origin.portKind) {
    return false;
  }
  if (origin.direction === "output") {
    return port.direction === "input" && isAssignable(origin.type, port.type);
  }
  return port.direction === "output" && isAssignable(port.type, origin.type);
}

export function findConnectableTemplatePort(
  entry: PaletteEntry,
  origin: ConnectionOrigin,
): PaletteTemplatePort | undefined {
  if (entry.kind !== "template") {
    return undefined;
  }
  return entry.templatePorts?.find((candidate) =>
    acceptsOrigin(candidate.port, origin),
  );
}

/** Keeps only entries that offer a port the dragged connection could land on.
 *
 * Templates participate only when their registry metadata names an explicit external
 * endpoint. Entries without such metadata remain ordinary insertion-only templates.
 */
export function filterConnectable(
  entries: readonly PaletteEntry[],
  origin: ConnectionOrigin,
): PaletteEntry[] {
  return entries.filter((entry) =>
    entry.kind === "node"
      ? variableConnectionDirectionAllowed(entry.key, origin) &&
        entry.ports.some((port) => acceptsOrigin(port, origin))
      : (entry.templatePorts?.some((candidate) =>
          acceptsOrigin(candidate.port, origin),
        ) ?? false),
  );
}

/** The port on a candidate node that a dragged connection should attach to. */
export function findConnectablePort(
  entry: PaletteEntry,
  origin: ConnectionOrigin,
): PortDefinitionV1 | undefined {
  const templatePort = findConnectableTemplatePort(entry, origin);
  if (templatePort !== undefined) {
    return templatePort.port;
  }
  if (!variableConnectionDirectionAllowed(entry.key, origin)) {
    return undefined;
  }
  return entry.ports.find((port) => acceptsOrigin(port, origin));
}

function variableConnectionDirectionAllowed(
  typeKey: string,
  origin: ConnectionOrigin,
): boolean {
  const role = variableNodeRoleForTypeKey(typeKey);
  if (role === "getter") {
    return origin.direction === "input";
  }
  if (role === "setter") {
    return origin.direction === "output";
  }
  return true;
}
