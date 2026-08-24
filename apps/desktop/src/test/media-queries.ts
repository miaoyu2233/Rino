/** Installs a media-query answer the tests control.
 *
 * The test environment implements no media query at all, and both the theme and the
 * motion system ask for one. Without a stub the dark theme and reduced-motion behaviour
 * cannot be exercised, because the production code correctly treats a missing
 * `matchMedia` as "no preference expressed".
 *
 * The double answers `true` for exactly the queries named and `false` for everything
 * else, and never notifies a listener: a test states the display it is describing before
 * rendering rather than changing it underneath a mounted tree.
 */
export function installMatchingMediaQueries(matching: readonly string[]): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matching.includes(query),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

export const DARK_THEME_QUERY = "(prefers-color-scheme: dark)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
