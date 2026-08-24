/** Freezes the shared object prototype after trusted static modules finish loading. */
export function hardenObjectPrototype(
  prototype: object = Object.prototype,
): void {
  Object.freeze(prototype);
}
