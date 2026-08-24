import { setProjectTransport } from "./project-actions";
import {
  createDesktopProjectTransport,
  isDesktopProjectServiceAvailable,
} from "./project-transport";

/** Installs the desktop transport when the shell is present.
 *
 * Without a desktop shell there is no way to reach the filesystem, so no transport is
 * installed at all and every project action reports that it is unavailable instead of
 * failing later with a framework error.
 */
export function initializeProjectService(): void {
  setProjectTransport(
    isDesktopProjectServiceAvailable()
      ? createDesktopProjectTransport()
      : undefined,
  );
}
