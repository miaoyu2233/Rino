import type { RinoProjectDocumentV1 } from "@rino/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select, type SelectOption } from "../../components/ui/Select";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import { clearDragPayload, writeDragPayload } from "../canvas/canvas-drag";
import type { LocalizationKey } from "../../diagnostics/diagnostic-model";
import { notify } from "../../diagnostics/diagnostic-store";

import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import {
  createProjectVariable,
  deleteProjectVariable,
  updateVariableDefinition,
} from "./variable-commands";
import {
  variablesForGraph,
  type VariableDefinition,
  type VariableValueKind,
} from "./variable-authoring";

const variableValueKinds = [
  "bool",
  "number",
  "string",
  "point",
  "rect",
  "imageRef",
] as const satisfies readonly VariableValueKind[];

const variableKindLabelKeys: Record<VariableValueKind, LocalizationKey> = {
  bool: "graph.variable.library.types.bool",
  number: "graph.variable.library.types.number",
  string: "graph.variable.library.types.string",
  point: "graph.variable.library.types.point",
  rect: "graph.variable.library.types.rect",
  imageRef: "graph.variable.library.types.imageRef",
};

const EMPTY_VARIABLES: readonly VariableDefinition[] = [];

function isVariableReferenced(
  document: RinoProjectDocumentV1,
  variableId: string,
): boolean {
  return document.graphs.some((graph) =>
    graph.nodes.some((node) => node.properties["variableId"] === variableId),
  );
}

function isVariableEditorControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("button, input, [role='combobox']") !== null
  );
}
function failureTitleKey(
  document: RinoProjectDocumentV1 | undefined,
  activeGraphId: string | undefined,
  executionLocked: boolean,
): LocalizationKey {
  if (document === undefined) {
    return "graph.variable.library.noProject";
  }
  if (activeGraphId === undefined) {
    return "graph.variable.library.noActiveGraph";
  }
  if (executionLocked) {
    return "graph.variable.library.executionLocked";
  }
  return "graph.variable.library.updateFailed";
}

/** Dense project-wide variable catalog; definitions are shared by every task and function graph. */
export function VariableLibrary() {
  const { t } = useTranslation();
  const document = useDocumentStore((store) => store.history?.document);
  const executionLocked = useDocumentStore((store) => store.executionLocked);
  const activeGraphId = useEditorSessionStore((store) => store.activeGraphId);
  const variables =
    document === undefined
      ? EMPTY_VARIABLES
      : variablesForGraph(document, activeGraphId);
  const activeGraph = useMemo(
    () => document?.graphs.find((graph) => graph.graphId === activeGraphId),
    [activeGraphId, document],
  );
  const [selectedVariableId, setSelectedVariableId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [createName, setCreateName] = useState("");
  const [createValueKind, setCreateValueKind] =
    useState<VariableValueKind>("string");

  const selectedVariable = variables.find(
    (variable) => variable.variableId === selectedVariableId,
  );
  const selectedVariableReferenced =
    document !== undefined && selectedVariable !== undefined
      ? isVariableReferenced(document, selectedVariable.variableId)
      : false;
  const canAuthor =
    document !== undefined && activeGraph !== undefined && !executionLocked;
  const canDrag = canAuthor && selectedVariable !== undefined;

  useEffect(() => {
    setSelectedVariableId((current) =>
      current !== "" &&
      variables.some((variable) => variable.variableId === current)
        ? current
        : (variables[0]?.variableId ?? ""),
    );
  }, [variables]);

  useEffect(() => {
    setDraftName(selectedVariable?.name ?? "");
  }, [selectedVariable?.name, selectedVariable?.variableId]);

  const kindOptions = useMemo<SelectOption[]>(
    () =>
      variableValueKinds.map((value) => ({
        value,
        label: t(variableKindLabelKeys[value]),
      })),
    [t],
  );
  const variableOptions = useMemo<SelectOption[]>(
    () =>
      variables.map((variable) => ({
        value: variable.variableId,
        label: t("graph.variable.library.item", {
          name: variable.name,
          type: t(variableKindLabelKeys[variable.valueKind]),
        }),
      })),
    [t, variables],
  );

  const createVariable = useCallback(() => {
    if (!canAuthor) {
      notify({
        severity: document === undefined ? "info" : "error",
        titleKey: failureTitleKey(document, activeGraphId, executionLocked),
      });
      return;
    }
    const name = createName.trim();
    const variableId = createProjectVariable(
      createValueKind,
      name.length === 0 ? undefined : name,
    );
    if (variableId === undefined) {
      notify({
        severity: "error",
        titleKey: "graph.variable.library.createFailed",
      });
      return;
    }
    setSelectedVariableId(variableId);
    setCreateName("");
  }, [
    activeGraphId,
    canAuthor,
    createName,
    createValueKind,
    document,
    executionLocked,
  ]);

  const commitName = useCallback(() => {
    if (selectedVariable === undefined) {
      return;
    }
    const name = draftName.trim();
    if (name === selectedVariable.name) {
      setDraftName(name);
      return;
    }
    if (
      !canAuthor ||
      !updateVariableDefinition(selectedVariable.variableId, { name })
    ) {
      notify({
        severity: "error",
        titleKey: "graph.variable.library.updateFailed",
      });
      setDraftName(selectedVariable.name);
      return;
    }
    setDraftName(name);
  }, [canAuthor, draftName, selectedVariable]);

  const handleNameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        setDraftName(selectedVariable?.name ?? "");
        event.currentTarget.blur();
      }
    },
    [selectedVariable?.name],
  );

  const changeKind = useCallback(
    (value: string) => {
      const nextKind = variableValueKinds.find((kind) => kind === value);
      if (selectedVariable === undefined || nextKind === undefined) {
        return;
      }
      if (selectedVariableReferenced) {
        notify({
          severity: "info",
          titleKey: "graph.variable.library.typeLocked",
        });
        return;
      }
      const outcome = updateVariableDefinition(selectedVariable.variableId, {
        valueKind: nextKind,
        ...(nextKind === "imageRef" && selectedVariable.persistent
          ? { persistent: false }
          : {}),
      });
      if (!outcome) {
        notify({
          severity: "error",
          titleKey: "graph.variable.library.updateFailed",
        });
      }
    },
    [selectedVariable, selectedVariableReferenced],
  );

  const changePersistent = useCallback(
    (persistent: boolean) => {
      if (selectedVariable === undefined) {
        return;
      }
      if (persistent && selectedVariable.valueKind === "imageRef") {
        notify({
          severity: "info",
          titleKey: "graph.variable.library.imagePersistentDisabled",
        });
        return;
      }
      if (
        !canAuthor ||
        !updateVariableDefinition(selectedVariable.variableId, { persistent })
      ) {
        notify({
          severity: "error",
          titleKey: "graph.variable.library.updateFailed",
        });
      }
    },
    [canAuthor, selectedVariable],
  );

  const deleteVariable = useCallback(() => {
    if (selectedVariable === undefined) {
      return;
    }
    if (selectedVariableReferenced) {
      notify({
        severity: "info",
        titleKey: "graph.variable.library.deleteLocked",
      });
      return;
    }
    if (!canAuthor || !deleteProjectVariable(selectedVariable.variableId)) {
      notify({
        severity: "error",
        titleKey: failureTitleKey(document, activeGraphId, executionLocked),
      });
      return;
    }
    setSelectedVariableId("");
  }, [
    activeGraphId,
    canAuthor,
    document,
    executionLocked,
    selectedVariable,
    selectedVariableReferenced,
  ]);

  const editorDisabled = !canAuthor || selectedVariable === undefined;
  const typeDisabled = editorDisabled || selectedVariableReferenced;

  return (
    <section
      className="variable-library"
      aria-label={t("shell.workbench.variables")}
    >
      <div className="variable-library__toolbar">
        <span className="variable-library__count">
          {t("graph.variable.library.count", { count: variables.length })}
        </span>
        <div className="variable-library__create">
          <label className="variable-library__field">
            <span>{t("graph.variable.library.createType")}</span>
            <Select
              aria-label={t("graph.variable.library.createType")}
              className="variable-library__select"
              disabled={!canAuthor}
              onValueChange={(value) => {
                const nextKind = variableValueKinds.find(
                  (kind) => kind === value,
                );
                if (nextKind !== undefined) {
                  setCreateValueKind(nextKind);
                }
              }}
              options={kindOptions}
              value={createValueKind}
            />
          </label>
          <label className="variable-library__field">
            <span>{t("graph.variable.library.createName")}</span>
            <Input
              aria-label={t("graph.variable.library.createName")}
              disabled={!canAuthor}
              maxLength={80}
              onChange={(event) => {
                setCreateName(event.currentTarget.value);
              }}
              placeholder={t("graph.variable.library.createNamePlaceholder")}
              value={createName}
            />
          </label>
          <Button
            aria-label={t("graph.variable.library.create")}
            disabled={!canAuthor}
            onClick={createVariable}
            size="icon"
            title={t("graph.variable.library.create")}
            variant="primary"
          >
            <ProductIcon icon="action.add" size="small" />
          </Button>
        </div>
      </div>

      {document === undefined ? (
        <p className="variable-library__notice">
          {t("graph.variable.library.noProject")}
        </p>
      ) : activeGraph === undefined ? (
        <p className="variable-library__notice">
          {t("graph.variable.library.noActiveGraph")}
        </p>
      ) : executionLocked ? (
        <p className="variable-library__notice">
          {t("graph.variable.library.executionLocked")}
        </p>
      ) : null}

      {variables.length === 0 ? (
        <p className="variable-library__empty">
          {t("graph.variable.library.empty")}
        </p>
      ) : (
        <div className="variable-library__body">
          <label className="variable-library__field">
            <span>{t("graph.variable.library.select")}</span>
            <Select
              aria-label={t("graph.variable.library.select")}
              className="variable-library__select"
              disabled={false}
              onValueChange={setSelectedVariableId}
              options={variableOptions}
              value={selectedVariableId}
            />
          </label>

          {selectedVariable === undefined ? null : (
            <article
              className="variable-library__editor"
              aria-label={t("graph.variable.library.selected")}
              title={t(
                canDrag
                  ? "graph.variable.library.dragHint"
                  : "graph.variable.library.dragDisabled",
                { name: selectedVariable.name },
              )}
              aria-description={t(
                canDrag
                  ? "graph.variable.library.dragHint"
                  : "graph.variable.library.dragDisabled",
                { name: selectedVariable.name },
              )}
              draggable={canDrag}
              onDragStart={(event: ReactDragEvent<HTMLElement>) => {
                if (!canDrag || isVariableEditorControl(event.target)) {
                  event.preventDefault();
                  clearDragPayload();
                  return;
                }
                writeDragPayload(event.dataTransfer, {
                  kind: "variable",
                  variableId: selectedVariable.variableId,
                });
                event.dataTransfer.effectAllowed = "copy";
              }}
              onDragEnd={clearDragPayload}
            >
              <div className="variable-library__editor-heading">
                <strong>{selectedVariable.name}</strong>
              </div>
              <div className="variable-library__fields">
                <label className="variable-library__field">
                  <span>{t("graph.variable.nameLabel")}</span>
                  <Input
                    aria-label={t("graph.variable.nameLabel")}
                    disabled={editorDisabled}
                    maxLength={80}
                    onBlur={commitName}
                    onChange={(event) => {
                      setDraftName(event.currentTarget.value);
                    }}
                    onKeyDown={handleNameKeyDown}
                    value={draftName}
                  />
                </label>
                <label className="variable-library__field">
                  <span>{t("graph.variable.library.type")}</span>
                  <Select
                    aria-describedby="variable-library-type-help"
                    aria-label={t("graph.variable.library.type")}
                    className="variable-library__select"
                    disabled={typeDisabled}
                    onValueChange={changeKind}
                    options={kindOptions}
                    value={selectedVariable.valueKind}
                  />
                </label>
              </div>
              <label className="variable-library__persistent">
                <input
                  aria-label={t("graph.variable.persistentLabel")}
                  checked={selectedVariable.persistent}
                  className="field-control__checkbox"
                  disabled={
                    editorDisabled || selectedVariable.valueKind === "imageRef"
                  }
                  onChange={(event) => {
                    changePersistent(event.currentTarget.checked);
                  }}
                  type="checkbox"
                />
                <span>{t("graph.variable.persistentLabel")}</span>
              </label>
              <p
                id="variable-library-type-help"
                className="variable-library__help"
              >
                {selectedVariableReferenced
                  ? t("graph.variable.library.typeLocked")
                  : selectedVariable.valueKind === "imageRef"
                    ? t("graph.variable.library.imagePersistentDisabled")
                    : t("graph.variable.library.sharedDescription")}
              </p>
              <div className="variable-library__actions">
                <Button
                  aria-label={t("graph.variable.library.delete")}
                  disabled={editorDisabled || selectedVariableReferenced}
                  onClick={deleteVariable}
                  size="compact"
                  title={
                    selectedVariableReferenced
                      ? t("graph.variable.library.deleteLocked")
                      : t("graph.variable.library.delete")
                  }
                  variant="destructive"
                >
                  <ProductIcon icon="action.deleteTask" size="small" />
                  <span>{t("graph.variable.library.delete")}</span>
                </Button>
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
