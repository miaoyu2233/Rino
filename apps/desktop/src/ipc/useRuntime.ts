import { useContext } from "react";

import { RuntimeContext, type RuntimeContextValue } from "./runtime-context";

export function useRuntime(): RuntimeContextValue {
  const context = useContext(RuntimeContext);

  if (context === null) {
    throw new Error("useRuntime must be used within RuntimeProvider.");
  }

  return context;
}
