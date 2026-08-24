import type { TypeDescriptorV1 } from "@rino/contracts";

import { portColorTokens } from "../../design-system/tokens";

export type PortColorRole = keyof typeof portColorTokens;

/** The port outline. Shape carries the same distinction as color so a user who cannot
 * separate the hues still reads the port kind, as the style guide requires. */
export type PortShape =
  "execution" | "value" | "collection" | "optionalValue" | "optionalCollection";

export interface PortAppearance {
  colorRole: PortColorRole;
  shape: PortShape;
}

function primitiveColorRole(kind: string): PortColorRole {
  switch (kind) {
    case "exec":
      return "execution";
    case "bool":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "imageRef":
      return "image";
    case "point":
    case "rect":
      return "spatial";
    case "ocrCandidate":
    case "ocrResult":
      return "recognition";
    default:
      return "unknown";
  }
}

/** Derives the visual treatment of a port from its type.
 *
 * Collections and optionals keep the colour of the value they carry so a user follows one
 * data type across the graph, and express their wrapper through shape instead. A
 * collection whose element has no dedicated hue falls back to the collection colour, which
 * still says more than the neutral unknown grey.
 */
export function portAppearance(type: TypeDescriptorV1): PortAppearance {
  if (type.kind === "optional") {
    const inner = portAppearance(type.value);
    return {
      colorRole: inner.colorRole,
      shape:
        inner.shape === "collection" ? "optionalCollection" : "optionalValue",
    };
  }
  if (type.kind === "collection") {
    const element = portAppearance(type.element).colorRole;
    return {
      colorRole:
        element === "unknown" || element === "recognition"
          ? "collection"
          : element,
      shape: "collection",
    };
  }
  return {
    colorRole: primitiveColorRole(type.kind),
    shape: type.kind === "exec" ? "execution" : "value",
  };
}

/** Reports whether a colour stands for a family of types rather than one type.
 *
 * Such a port also shows its rendered type beside the label, so the style guide's rule
 * that colour is never the only indicator holds even where no hue identifies the type.
 */
export function requiresTypeLabel(colorRole: PortColorRole): boolean {
  return (
    colorRole === "unknown" ||
    colorRole === "collection" ||
    colorRole === "recognition"
  );
}

/** The CSS custom property carrying the port colour for the given type. */
export function portColorVariable(type: TypeDescriptorV1): string {
  return portColorTokens[portAppearance(type).colorRole];
}
