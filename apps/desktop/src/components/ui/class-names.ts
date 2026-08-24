export function mergeClassNames(
  ...classNames: (string | false | null | undefined)[]
): string {
  return classNames.filter(Boolean).join(" ");
}
