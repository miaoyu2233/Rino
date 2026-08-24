const GHOST_CLASS = "palette-drag-ghost";

/** Uses a clone of the dragged item as the drag image.
 *
 * The browser rasterizes the live element at the display's pixel density, so the ghost
 * stays crisp on a high-DPI screen, and it cannot drift visually from the item the user
 * grabbed. The clone is placed outside the viewport and removed once the browser has
 * taken its snapshot.
 */
export function applyDragGhost(
  transfer: DataTransfer,
  source: HTMLElement,
  pointerOffsetX = 16,
  pointerOffsetY = 16,
): void {
  if (typeof transfer.setDragImage !== "function") {
    return;
  }
  const ghost = source.cloneNode(true);
  if (!(ghost instanceof HTMLElement)) {
    return;
  }
  ghost.classList.add(GHOST_CLASS);
  ghost.style.width = `${String(source.offsetWidth)}px`;
  document.body.append(ghost);
  transfer.setDragImage(ghost, pointerOffsetX, pointerOffsetY);
  window.setTimeout(() => {
    ghost.remove();
  }, 0);
}
