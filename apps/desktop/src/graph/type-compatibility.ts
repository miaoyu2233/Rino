import type { TypeDescriptorV1 } from "@rino/contracts";

/** Renders a type for a diagnostic message, using the same form users see on ports. */
export function describeType(type: TypeDescriptorV1): string {
  switch (type.kind) {
    case "collection":
      return `collection<${describeType(type.element)}>`;
    case "optional":
      return `optional<${describeType(type.value)}>`;
    default:
      return type.kind;
  }
}

export function isExecutionType(type: TypeDescriptorV1): boolean {
  return type.kind === "exec";
}

function isSameType(left: TypeDescriptorV1, right: TypeDescriptorV1): boolean {
  if (left.kind === "collection" && right.kind === "collection") {
    return isSameType(left.element, right.element);
  }
  if (left.kind === "optional" && right.kind === "optional") {
    return isSameType(left.value, right.value);
  }
  return left.kind === right.kind;
}

/** Reports whether a value produced by `source` may flow into `target`.
 *
 * The rules are deliberately narrow: there is no implicit any type and no implicit
 * numeric or textual conversion, so a graph that looks connected cannot fail at run time
 * on a silent coercion. Only two widenings are allowed, both of which lose no information:
 * a value may enter an optional input, and a collection is covariant in its element so a
 * collection of a type flows wherever a collection of an accepted type is expected.
 */
export function isAssignable(
  source: TypeDescriptorV1,
  target: TypeDescriptorV1,
): boolean {
  // Execution is a control token, never a value, so it only ever meets its own kind.
  if (isExecutionType(source) || isExecutionType(target)) {
    return isExecutionType(source) && isExecutionType(target);
  }

  if (target.kind === "optional") {
    const unwrappedSource = source.kind === "optional" ? source.value : source;
    return isAssignable(unwrappedSource, target.value);
  }

  // An optional source cannot satisfy a required input: the absent case has to be
  // handled explicitly rather than reaching a node that assumes a value.
  if (source.kind === "optional") {
    return false;
  }

  if (source.kind === "collection" && target.kind === "collection") {
    return isAssignable(source.element, target.element);
  }

  return isSameType(source, target);
}
