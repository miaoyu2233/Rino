import {
  resolveProductIcon,
  type ProductIconKey,
} from "../../design-system/icons/product-icons";

import type { PaletteEntry } from "./palette-model";

const paletteIconsByKey: Readonly<Record<string, ProductIconKey>> = {
  "automation.captureScreen": "node.capture",
  "automation.clickPoint": "node.clickPoint",
  "automation.clickRectCenter": "node.click",
  "automation.launchAndroidApp": "node.launchAndroidApp",
  "automation.pressAndroidKey": "node.pressAndroidKey",
  "automation.swipe": "node.swipe",
  "automation.touchAction": "node.touchAction",
  "core.collection.imageList": "node.collection",
  "core.collection.pointList": "node.collection",
  "core.collection.regionList": "node.regions",
  "core.diagnostic.log": "node.log",
  "core.flow.boundedRetry": "node.boundedRetry",
  "core.flow.endPath": "runtime.disabled",
  "core.flow.parallel": "node.parallel",
  "core.flow.runCounter": "node.counter",
  "core.flow.sequence": "node.sequence",
  "core.flow.sequenceOrder": "node.sequenceOrder",
  "core.flow.start": "run.start",
  "core.flow.stop": "run.stop",
  "core.geometry.point": "node.point",
  "core.geometry.rectangle": "node.rectangle",
  "core.image.projectAsset": "recognition.template",
  "core.logic.branch": "node.branch",
  "core.logic.caseOverlayBool": "action.check",
  "core.logic.caseOverlayImageRef": "node.images",
  "core.logic.caseOverlayNumber": "node.number",
  "core.logic.numberCompare": "node.compare",
  "core.logic.numberSelect": "node.numberSelect",
  "core.logic.taskChoice": "node.taskChoice",
  "core.math.arithmetic": "node.arithmetic",
  "core.math.expression": "node.expression",
  "core.time.delay": "node.delay",
  "core.value.numberLiteral": "node.number",
  "core.value.stringLiteral": "node.text",
  "template.imageRecognition": "recognition.template",
  "template.recognizeNumberAndBranch": "node.numberSelect",
  "template.textRecognition": "recognition.ocr",
  "text.parseNumber": "node.parseNumber",
  "text.readNumber": "node.number",
  "text.readText": "node.readValue",
  "text.readValue": "node.readValue",
  "vision.colorMatch": "recognition.color",
  "vision.featureMatch": "recognition.feature",
  "vision.ocr": "node.ocr",
  "vision.templateMatch": "recognition.template",
};

/** Chooses a compact semantic icon for a node-library entry without changing its
 * persisted registry icon or graph rendering contract. */
export function paletteIconForEntry(entry: PaletteEntry): ProductIconKey {
  if (entry.key.startsWith("core.variable.get")) {
    return "node.variableGet";
  }
  if (entry.key.startsWith("core.variable.set")) {
    return "node.variableSet";
  }
  return (
    paletteIconsByKey[entry.key] ??
    resolveProductIcon(entry.iconKey, "category.flow")
  );
}
