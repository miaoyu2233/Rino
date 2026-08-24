import {
  MAX_PERSISTENT_VARIABLES_PER_DOCUMENT,
  isUuid,
  type PersistentVariableValueKind,
} from "../preferences/persistent-variable-data";

export interface PersistentVariableRunBinding {
  variableId: string;
  valueKind: PersistentVariableValueKind;
}

export interface PersistentVariableRunRegistration {
  runId: string;
  documentId: string;
  graphId: string;
  generation: number;
  variables: readonly PersistentVariableRunBinding[];
}

export type PersistentVariableRunConsumeResult =
  | { status: "ignored" }
  | {
      status: "invalid";
      reason: "graphIdMismatch" | "generationMismatch";
    }
  | {
      status: "accepted";
      registration: PersistentVariableRunRegistration;
    };

class PersistentVariableRunContext {
  private active: PersistentVariableRunRegistration | undefined;

  register(registration: PersistentVariableRunRegistration): boolean {
    if (
      !isUuid(registration.runId) ||
      !isUuid(registration.documentId) ||
      !isUuid(registration.graphId) ||
      !Number.isSafeInteger(registration.generation) ||
      registration.generation < 1 ||
      registration.variables.length > MAX_PERSISTENT_VARIABLES_PER_DOCUMENT
    ) {
      return false;
    }
    const identifiers = new Set<string>();
    for (const variable of registration.variables) {
      if (
        !isUuid(variable.variableId) ||
        identifiers.has(variable.variableId)
      ) {
        return false;
      }
      identifiers.add(variable.variableId);
      const valueKind: string = variable.valueKind;
      if (
        valueKind !== "bool" &&
        valueKind !== "number" &&
        valueKind !== "string" &&
        valueKind !== "point" &&
        valueKind !== "rect"
      ) {
        return false;
      }
    }
    if (this.active !== undefined) {
      return false;
    }
    this.active = {
      ...registration,
      variables: registration.variables.map((variable) => ({ ...variable })),
    };
    return true;
  }

  consume(
    runId: string | undefined,
    graphId: string | undefined,
    generation: number | undefined,
  ): PersistentVariableRunConsumeResult {
    const active = this.active;
    if (active === undefined || runId === undefined || runId !== active.runId) {
      return { status: "ignored" };
    }
    this.active = undefined;
    if (graphId !== active.graphId) {
      return { status: "invalid", reason: "graphIdMismatch" };
    }
    if (generation !== active.generation) {
      return { status: "invalid", reason: "generationMismatch" };
    }
    return { status: "accepted", registration: active };
  }

  reset(): void {
    this.active = undefined;
  }

  current(): PersistentVariableRunRegistration | undefined {
    return this.active;
  }
}

const persistentVariableRunContext = new PersistentVariableRunContext();

export function registerPersistentVariableRun(
  registration: PersistentVariableRunRegistration,
): boolean {
  return persistentVariableRunContext.register(registration);
}

export function consumePersistentVariableRun(
  runId: string | undefined,
  graphId: string | undefined,
  generation: number | undefined,
): PersistentVariableRunConsumeResult {
  return persistentVariableRunContext.consume(runId, graphId, generation);
}

export function resetPersistentVariableRunContext(): void {
  persistentVariableRunContext.reset();
}

export function currentPersistentVariableRun():
  PersistentVariableRunRegistration | undefined {
  return persistentVariableRunContext.current();
}
