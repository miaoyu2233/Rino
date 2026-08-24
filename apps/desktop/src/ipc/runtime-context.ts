import { createContext } from "react";

import type {
  RuntimeRequest,
  RuntimeRequestPayload,
  RuntimeRequestResult,
  RuntimeStatus,
} from "./runtime-contract";

/** The runtime lifecycle actions available to the interface. */
export interface RuntimeContextValue {
  start: () => Promise<RuntimeStatus>;
  restart: () => Promise<RuntimeStatus>;
  shutdown: () => Promise<RuntimeStatus>;
  readPreview: (previewToken: string) => Promise<Uint8Array>;
  readCapture: (captureToken: string) => Promise<Uint8Array>;
  request: <Request extends RuntimeRequest>(
    request: Request,
    payload: RuntimeRequestPayload<Request>,
  ) => Promise<RuntimeRequestResult<Request>>;
}

export const RuntimeContext = createContext<RuntimeContextValue | null>(null);
