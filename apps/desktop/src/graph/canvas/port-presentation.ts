import type { TFunction } from "i18next";

import { translateDataKey } from "../../localization/data-keys";

type PortTypeDisplayMode = "compact" | "full";

const BASE_TYPE_KEYS: Readonly<Record<string, string>> = {
  exec: "graph.port.type.execution",
  bool: "graph.port.type.boolean",
  number: "graph.port.type.number",
  string: "graph.port.type.string",
  imageRef: "graph.port.type.image",
  point: "graph.port.type.point",
  rect: "graph.port.type.rect",
  ocrCandidate: "graph.port.type.ocrCandidate",
  ocrResult: "graph.port.type.ocrResult",
};

function translateTypeKey(
  translate: TFunction,
  typeLabel: string,
  fallback: string,
): string {
  const key = BASE_TYPE_KEYS[typeLabel];
  return key === undefined
    ? fallback
    : translateDataKey(translate, key, fallback);
}

/** Converts the technical type string carried by the registry into product language.
 *
 * The graph contract intentionally keeps strings such as `ocrResult` and
 * `collection<rect>` for validation. They must not leak into the canvas, however: this
 * formatter is the presentation boundary and also handles nested optional/collection
 * wrappers without changing the persisted type.
 */
export function displayPortType(
  translate: TFunction,
  typeLabel: string,
  mode: PortTypeDisplayMode = "full",
): string {
  const optionalMatch = /^optional<(.+)>$/.exec(typeLabel);
  if (optionalMatch !== null) {
    const inner = displayPortType(translate, optionalMatch[1] ?? "", "full");
    return mode === "compact"
      ? translateDataKey(translate, "graph.port.type.optionalCompact", "可选")
      : translate("graph.port.type.optionalFull", { type: inner });
  }

  const collectionMatch = /^collection<(.+)>$/.exec(typeLabel);
  if (collectionMatch !== null) {
    if (mode === "compact") {
      return translateDataKey(
        translate,
        "graph.port.type.collectionCompact",
        "列表",
      );
    }
    const inner = displayPortType(translate, collectionMatch[1] ?? "", "full");
    return translate("graph.port.type.collectionFull", { type: inner });
  }

  return translateTypeKey(
    translate,
    typeLabel,
    translateDataKey(translate, "graph.port.type.unknown", "未知类型"),
  );
}

/** Descriptions are intentionally limited to ports whose meaning is not obvious from
 * the short product label. Missing descriptions return undefined, so a node never gets
 * an empty or decorative help affordance. */
export function portDescriptionKey(
  labelKey: string,
  portId: string,
): string | undefined {
  const isOcr =
    labelKey.includes("vision.ocr") || labelKey.includes("textRecognition");
  const isRecognitionResult =
    labelKey.includes("vision.ocr") ||
    labelKey.includes("text.readText") ||
    labelKey.includes("text.readNumber") ||
    labelKey.includes("workflowGroup.textRecognition") ||
    labelKey.includes("workflowGroup.imageRecognition");
  if (portId === "matched") {
    if (!labelKey.includes("vision.") && !labelKey.includes("workflowGroup.")) {
      return undefined;
    }
    return isOcr
      ? "graph.port.description.ocrMatched"
      : "graph.port.description.matchMatched";
  }
  if (portId === "result" && isRecognitionResult) {
    return "graph.port.description.recognitionResult";
  }
  if (portId === "bestText") {
    return "graph.port.description.bestText";
  }
  if (portId === "bestRect") {
    return "graph.port.description.bestRegion";
  }
  if (portId === "rects") {
    return "graph.port.description.regionCollection";
  }
  if (portId === "scores" || portId === "counts") {
    return "graph.port.description.metricCollection";
  }
  if (portId === "normalizedText") {
    return "graph.port.description.normalizedText";
  }
  if (portId === "selected") {
    return "graph.port.description.selectedCandidate";
  }
  if (portId === "missing") {
    return "graph.port.description.missingCandidate";
  }
  if (portId === "invalid") {
    return "graph.port.description.invalidNumber";
  }
  if (portId === "roi") {
    return "graph.port.description.recognitionRegion";
  }
  if (portId === "template") {
    return "graph.port.description.templateImage";
  }
  return undefined;
}
