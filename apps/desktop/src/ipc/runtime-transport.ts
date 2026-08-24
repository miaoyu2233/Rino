import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  RUNTIME_DIAGNOSTIC_EVENT_NAME,
  RUNTIME_EVENT_NAME,
  type RuntimeDiagnostic,
  type RuntimeEvent,
  type RuntimeRequest,
  type RuntimeStatus,
} from "./runtime-contract";

/** The desktop capabilities the runtime client depends on.
 *
 * The client is written against this interface rather than the desktop framework, so the
 * local transport can be replaced later without changing runtime behavior, and so tests
 * exercise the real client against a substitutable boundary.
 */
export interface RuntimeTransport {
  status: () => Promise<RuntimeStatus>;
  start: () => Promise<RuntimeStatus>;
  restart: () => Promise<RuntimeStatus>;
  shutdown: () => Promise<RuntimeStatus>;
  request: (request: RuntimeRequest, payload: unknown) => Promise<unknown>;
  readPreview: (previewToken: string) => Promise<Uint8Array>;
  readCapture: (captureToken: string) => Promise<Uint8Array>;
  subscribeToEvents: (
    handler: (event: RuntimeEvent) => void,
  ) => Promise<() => void>;
  subscribeToDiagnostics: (
    handler: (diagnostic: RuntimeDiagnostic) => void,
  ) => Promise<() => void>;
}

/** Reports whether the desktop shell is available to host the runtime. */
export function isDesktopRuntimeAvailable(): boolean {
  return isTauri();
}

/** The transport backed by the desktop shell's typed commands and events. */
export function createDesktopRuntimeTransport(): RuntimeTransport {
  return {
    status: () => invoke<RuntimeStatus>("runtime_status"),
    start: () => invoke<RuntimeStatus>("runtime_start"),
    restart: () => invoke<RuntimeStatus>("runtime_restart"),
    shutdown: () => invoke<RuntimeStatus>("runtime_shutdown"),
    request: (request, payload) =>
      invoke<unknown>("runtime_request", { request, payload }),
    readPreview: async (previewToken) => {
      const bytes = await invoke<ArrayBuffer>("runtime_preview_read", {
        previewToken,
      });
      return new Uint8Array(bytes);
    },
    readCapture: async (captureToken) => {
      const bytes = await invoke<ArrayBuffer>("runtime_capture_read", {
        captureToken,
      });
      return new Uint8Array(bytes);
    },
    subscribeToEvents: async (handler) =>
      listen<RuntimeEvent>(RUNTIME_EVENT_NAME, (message) => {
        handler(message.payload);
      }),
    subscribeToDiagnostics: async (handler) =>
      listen<RuntimeDiagnostic>(RUNTIME_DIAGNOSTIC_EVENT_NAME, (message) => {
        handler(message.payload);
      }),
  };
}
