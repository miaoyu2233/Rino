import type {
  FunctionParameterV1,
  FunctionSignatureV1,
  GraphV1,
} from "@rino/contracts";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select, type SelectOption } from "../../components/ui/Select";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import type { LocalizationKey } from "../../diagnostics/diagnostic-model";
import { notify } from "../../diagnostics/diagnostic-store";
import { createIdentifier } from "../../platform/identifiers";
import type {
  FunctionAuthoringFailureReason,
  FunctionParameterDirection,
  FunctionParameterKind,
} from "./function-authoring";
import {
  buildAddFunctionParameterCommand,
  buildChangeFunctionParameterKindCommand,
  buildRemoveFunctionParameterCommand,
  buildRenameFunctionParameterCommand,
} from "./function-authoring";
import { useDocumentStore } from "../store/document-store";

const functionFailureTitleKeys: Record<
  FunctionAuthoringFailureReason,
  LocalizationKey
> = {
  graphMissing: "graph.function.signature.errors.operationFailed",
  graphLimitReached: "graph.function.signature.errors.limit",
  graphNotFunction: "graph.function.signature.errors.operationFailed",
  functionSignatureMissing: "graph.function.signature.errors.operationFailed",
  functionParameterLimitReached: "graph.function.signature.errors.limit",
  functionParameterIdInvalid: "graph.function.signature.errors.operationFailed",
  functionParameterIdDuplicate:
    "graph.function.signature.errors.operationFailed",
  functionParameterPortIdInvalid:
    "graph.function.signature.errors.operationFailed",
  functionParameterPortIdReserved:
    "graph.function.signature.errors.operationFailed",
  functionParameterPortIdDuplicate:
    "graph.function.signature.errors.operationFailed",
  functionParameterNameInvalid: "graph.function.signature.errors.name",
  functionParameterNameDuplicate: "graph.function.signature.errors.name",
  functionParameterKindInvalid: "graph.function.signature.errors.kind",
  nameInvalid: "graph.function.signature.errors.name",
  notFunction: "graph.function.signature.errors.operationFailed",
  parameterMissing: "graph.function.signature.errors.parameterMissing",
  directionInvalid: "graph.function.signature.errors.operationFailed",
  identifierInvalid: "graph.function.signature.errors.operationFailed",
  identifierDuplicate: "graph.function.signature.errors.operationFailed",
  targetGraphMissing: "graph.function.signature.errors.operationFailed",
  targetNotFunction: "graph.function.signature.errors.operationFailed",
  selfCall: "graph.function.signature.errors.operationFailed",
  recursion: "graph.function.signature.errors.operationFailed",
  depthLimit: "graph.function.signature.errors.operationFailed",
};

const parameterKinds: readonly FunctionParameterKind[] = [
  "bool",
  "number",
  "string",
  "point",
  "rect",
  "imageRef",
];
const EMPTY_FUNCTION_SIGNATURE: FunctionSignatureV1 = {
  inputs: [],
  outputs: [],
};

function normalizedName(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function reportFailure(reason: FunctionAuthoringFailureReason): void {
  notify({ severity: "error", titleKey: functionFailureTitleKeys[reason] });
}

function directionLabel(
  translate: (
    key: "graph.function.signature.input" | "graph.function.signature.output",
  ) => string,
  direction: FunctionParameterDirection,
): string {
  return translate(
    direction === "input"
      ? "graph.function.signature.input"
      : "graph.function.signature.output",
  );
}

interface ParameterRowProps {
  disabled: boolean;
  direction: FunctionParameterDirection;
  kindOptions: readonly SelectOption[];
  parameter: FunctionParameterV1;
  onChangeKind: (
    parameterId: string,
    valueKind: FunctionParameterKind,
  ) => boolean;
  onRemove: (parameterId: string) => boolean;
  onRename: (parameterId: string, name: string) => boolean;
}

function ParameterRow({
  disabled,
  direction,
  kindOptions,
  parameter,
  onChangeKind,
  onRemove,
  onRename,
}: ParameterRowProps) {
  const { t } = useTranslation();
  const [draftName, setDraftName] = useState(parameter.name);

  const commitName = useCallback(() => {
    if (draftName === parameter.name) {
      return;
    }
    if (!onRename(parameter.parameterId, draftName)) {
      setDraftName(parameter.name);
    }
  }, [draftName, onRename, parameter.name, parameter.parameterId]);

  const label = `${directionLabel(t, direction)}: ${parameter.name}`;
  return (
    <li className="function-signature__row">
      <Input
        value={draftName}
        disabled={disabled}
        aria-label={t("graph.function.signature.parameterName", { label })}
        onChange={(event) => {
          setDraftName(event.currentTarget.value);
        }}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraftName(parameter.name);
            event.currentTarget.blur();
          }
        }}
      />
      <Select
        value={parameter.valueKind}
        options={kindOptions}
        disabled={disabled}
        aria-label={t("graph.function.signature.parameterType", { label })}
        onValueChange={(value) => {
          if (
            !onChangeKind(parameter.parameterId, value as FunctionParameterKind)
          ) {
            return;
          }
        }}
      />
      <Button
        size="icon"
        variant="ghost"
        disabled={disabled}
        title={t("graph.function.signature.removeParameter")}
        aria-label={t("graph.function.signature.removeParameterFor", { label })}
        onClick={() => {
          onRemove(parameter.parameterId);
        }}
      >
        <ProductIcon icon="action.deleteTask" size="small" />
      </Button>
    </li>
  );
}

interface FunctionSignatureEditorProps {
  graph: GraphV1;
}

/** Dense function identity and boundary editor shown before ordinary node properties. */
export function FunctionSignatureEditor({
  graph,
}: FunctionSignatureEditorProps) {
  return <FunctionSignatureEditorContent key={graph.graphId} graph={graph} />;
}

function FunctionSignatureEditorContent({
  graph,
}: FunctionSignatureEditorProps) {
  const { t } = useTranslation();
  const document = useDocumentStore((store) => store.history?.document);
  const executionLocked = useDocumentStore((store) => store.executionLocked);
  const runCommand = useDocumentStore((store) => store.runCommand);
  const [draftName, setDraftName] = useState(() => ({
    sourceName: graph.name,
    value: graph.name,
  }));
  const draftValue =
    draftName.sourceName === graph.name ? draftName.value : graph.name;

  const signature = graph.functionSignature;
  const kindOptions = useMemo<SelectOption[]>(
    () =>
      parameterKinds.map((value) => ({
        value,
        label: t(`graph.function.signature.types.${value}`),
      })),
    [t],
  );

  const commitGraphName = useCallback(() => {
    if (draftValue === graph.name) {
      return;
    }
    const outcome = runCommand("graph.history.renameFunction", {
      kind: "renameGraph",
      graphId: graph.graphId,
      name: draftValue,
    });
    if (!outcome.ok) {
      notify({
        severity: "error",
        titleKey: "graph.function.signature.errors.name",
      });
      setDraftName({ sourceName: graph.name, value: graph.name });
    }
  }, [draftValue, graph.graphId, graph.name, runCommand]);

  const currentSignature = signature ?? EMPTY_FUNCTION_SIGNATURE;

  const addParameter = useCallback(
    (direction: FunctionParameterDirection) => {
      const parameters =
        direction === "input"
          ? currentSignature.inputs
          : currentSignature.outputs;
      let ordinal = parameters.length + 1;
      let name = t(
        direction === "input"
          ? "graph.function.signature.defaultInputName"
          : "graph.function.signature.defaultOutputName",
        { count: ordinal },
      );
      const allNames = new Set(
        [...currentSignature.inputs, ...currentSignature.outputs].map(
          (parameter) => normalizedName(parameter.name),
        ),
      );
      while (allNames.has(normalizedName(name))) {
        ordinal += 1;
        name = t(
          direction === "input"
            ? "graph.function.signature.defaultInputName"
            : "graph.function.signature.defaultOutputName",
          { count: ordinal },
        );
      }
      if (document === undefined) {
        notify({
          severity: "info",
          titleKey: "graph.function.library.errors.noProject",
        });
        return;
      }
      const built = buildAddFunctionParameterCommand(
        document,
        graph.graphId,
        direction,
        name,
        "string",
        createIdentifier,
      );
      if (!built.ok) {
        reportFailure(built.reason);
        return;
      }
      const outcome = runCommand(
        "graph.history.addFunctionParameter",
        built.value.command,
      );
      if (!outcome.ok) {
        notify({
          severity: "error",
          titleKey: "graph.function.signature.errors.commandRejected",
        });
      }
    },
    [currentSignature, document, graph.graphId, runCommand, t],
  );

  const renameParameter = useCallback(
    (parameterId: string, name: string): boolean => {
      const document = useDocumentStore.getState().history?.document;
      if (document === undefined) {
        return false;
      }
      const built = buildRenameFunctionParameterCommand(
        document,
        graph.graphId,
        parameterId,
        name,
      );
      if (!built.ok) {
        reportFailure(built.reason);
        return false;
      }
      const outcome = runCommand(
        "graph.history.renameFunctionParameter",
        built.value.command,
      );
      if (!outcome.ok) {
        notify({
          severity: "error",
          titleKey: "graph.function.signature.errors.commandRejected",
        });
      }
      return outcome.ok;
    },
    [graph.graphId, runCommand],
  );

  const changeParameterKind = useCallback(
    (parameterId: string, valueKind: FunctionParameterKind): boolean => {
      const document = useDocumentStore.getState().history?.document;
      if (document === undefined) {
        return false;
      }
      const built = buildChangeFunctionParameterKindCommand(
        document,
        graph.graphId,
        parameterId,
        valueKind,
      );
      if (!built.ok) {
        reportFailure(built.reason);
        return false;
      }
      const outcome = runCommand(
        "graph.history.changeFunctionParameterKind",
        built.value.command,
      );
      if (!outcome.ok) {
        notify({
          severity: "error",
          titleKey: "graph.function.signature.errors.commandRejected",
        });
      }
      return outcome.ok;
    },
    [graph.graphId, runCommand],
  );

  const removeParameter = useCallback(
    (parameterId: string): boolean => {
      const document = useDocumentStore.getState().history?.document;
      if (document === undefined) {
        return false;
      }
      const built = buildRemoveFunctionParameterCommand(
        document,
        graph.graphId,
        parameterId,
      );
      if (!built.ok) {
        reportFailure(built.reason);
        return false;
      }
      const outcome = runCommand(
        "graph.history.removeFunctionParameter",
        built.value.command,
      );
      if (!outcome.ok) {
        notify({
          severity: "error",
          titleKey: "graph.function.signature.errors.commandRejected",
        });
      }
      return outcome.ok;
    },
    [graph.graphId, runCommand],
  );

  const renderDirection = (
    direction: FunctionParameterDirection,
    parameters: readonly FunctionParameterV1[],
  ) => (
    <section
      className="function-signature__direction"
      aria-labelledby={`function-signature-${direction}`}
    >
      <div className="function-signature__direction-heading">
        <h4 id={`function-signature-${direction}`}>
          {directionLabel(t, direction)}
        </h4>
        <span>
          {t("graph.function.signature.parameterCount", {
            count: parameters.length,
            maximum: 16,
          })}
        </span>
      </div>
      {parameters.length === 0 ? (
        <p className="function-signature__empty">
          {t("graph.function.signature.noParameters")}
        </p>
      ) : (
        <ul className="function-signature__rows">
          {parameters.map((parameter) => (
            <ParameterRow
              key={`${parameter.parameterId}:${parameter.name}`}
              disabled={executionLocked || signature === undefined}
              direction={direction}
              kindOptions={kindOptions}
              parameter={parameter}
              onChangeKind={changeParameterKind}
              onRemove={removeParameter}
              onRename={renameParameter}
            />
          ))}
        </ul>
      )}
      <Button
        size="compact"
        variant="ghost"
        disabled={
          executionLocked || signature === undefined || parameters.length >= 16
        }
        title={t(
          direction === "input"
            ? "graph.function.signature.addInput"
            : "graph.function.signature.addOutput",
        )}
        aria-label={t(
          direction === "input"
            ? "graph.function.signature.addInput"
            : "graph.function.signature.addOutput",
        )}
        onClick={() => {
          addParameter(direction);
        }}
      >
        <span aria-hidden="true">+</span>
        <span>
          {t(
            direction === "input"
              ? "graph.function.signature.addInput"
              : "graph.function.signature.addOutput",
          )}
        </span>
      </Button>
    </section>
  );

  return (
    <section
      className="function-signature"
      aria-label={t("graph.function.signature.title")}
    >
      <div className="function-signature__header">
        <div>
          <h3>{t("graph.function.signature.title")}</h3>
          <p>{t("graph.function.signature.description")}</p>
        </div>
      </div>
      <Input
        value={draftValue}
        disabled={executionLocked}
        aria-label={t("graph.function.signature.nameLabel")}
        placeholder={t("graph.function.signature.namePlaceholder")}
        onChange={(event) => {
          setDraftName({
            sourceName: graph.name,
            value: event.currentTarget.value,
          });
        }}
        onBlur={commitGraphName}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraftName({ sourceName: graph.name, value: graph.name });
            event.currentTarget.blur();
          }
        }}
      />
      {signature === undefined ? (
        <p className="function-signature__empty">
          {t("graph.function.signature.missing")}
        </p>
      ) : (
        <div className="function-signature__directions">
          {renderDirection("input", signature.inputs)}
          {renderDirection("output", signature.outputs)}
        </div>
      )}
    </section>
  );
}
