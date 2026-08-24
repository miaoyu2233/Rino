export type ApplicationLayoutMode = "wide" | "compact" | "narrow";

export function resolveApplicationLayoutMode(
  viewportWidth: number,
): ApplicationLayoutMode {
  if (viewportWidth < 850) {
    return "narrow";
  }
  if (viewportWidth < 1160) {
    return "compact";
  }
  return "wide";
}
