import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/** jsdom does not implement ResizeObserver; layout-dependent components only need it
 * to exist, so every method is intentionally inert. */
class ResizeObserverTestDouble implements ResizeObserver {
  disconnect(): void {
    return;
  }

  observe(): void {
    return;
  }

  unobserve(): void {
    return;
  }
}

globalThis.ResizeObserver = ResizeObserverTestDouble;

/** jsdom has no layout engine and therefore no scrollIntoView. Components call it to keep
 * a keyboard-highlighted row visible; there is nothing to scroll here. */
Element.prototype.scrollIntoView = function scrollIntoView(): void {
  return;
};

Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
  return false;
};

Element.prototype.setPointerCapture = function setPointerCapture(): void {
  return;
};

Element.prototype.releasePointerCapture =
  function releasePointerCapture(): void {
    return;
  };

afterEach(() => {
  cleanup();
});
