import {
  useId,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { Select } from "../../components/ui/Select";
import type {
  DiagnosticParameters,
  LocalizationKey,
} from "../../diagnostics/diagnostic-model";
import { translateDiagnostic } from "../../diagnostics/translate-diagnostic";
import { translateDataKey } from "../../localization/data-keys";
import type { EditableValue } from "../commands/graph-commands";
import {
  formatFieldValue,
  matchesEditor,
  parseFieldInput,
  type FieldEditor,
  type UnsupportedFieldReason,
} from "./field-editor";
import "./field-control.css";

const unsupportedReasonKeys: Record<UnsupportedFieldReason, LocalizationKey> = {
  typeUnsupported: "graph.inspector.unsupported.typeUnsupported",
  labelMissing: "graph.inspector.unsupported.labelMissing",
  choicesInvalid: "graph.inspector.unsupported.choicesInvalid",
  declarationInvalid: "graph.inspector.unsupported.declarationInvalid",
};

interface FieldError {
  messageKey: LocalizationKey;
  parameters: DiagnosticParameters | undefined;
}

export interface FieldControlProps {
  editor: FieldEditor;
  value: EditableValue | undefined;
  required: boolean;
  /** Accessible name. The inspector also shows it as a visible label; a control drawn on a
   * node has only this. */
  label: string;
  /** `inline` is the compact form drawn inside a node body. */
  variant?: "panel" | "inline";
  /** Applies the edit and reports whether the document accepted it. */
  onCommit: (value: EditableValue | undefined) => boolean;
}

/** One editable value, shared by the inspector and the fields drawn on a node.
 *
 * While the control has focus its draft text is authoritative: an edit arriving from
 * elsewhere, including an undo, updates the document but never rewrites what the user is
 * in the middle of typing. Once focus leaves, the control shows the document's value
 * again, so the two surfaces cannot drift apart.
 *
 * Typing produces no command. A command is created when an edit is committed, so one
 * meaningful interaction is one undo entry rather than one per keystroke.
 */
export function FieldControl({
  editor,
  value,
  required,
  label,
  variant = "panel",
  onCommit,
}: FieldControlProps) {
  const { t } = useTranslation();
  const errorId = useId();
  const [draft, setDraft] = useState(() => formatFieldValue(value));
  const [synchronizedValue, setSynchronizedValue] = useState(value);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<FieldError | undefined>(undefined);

  if (!editing && !Object.is(value, synchronizedValue)) {
    setSynchronizedValue(value);
    setDraft(formatFieldValue(value));
    setError(undefined);
  }

  if (editor.kind === "unsupported") {
    return (
      <div
        className="field-control field-control--unsupported"
        data-variant={variant}
      >
        <output className="field-control__readonly font-code">
          {formatFieldValue(value)}
        </output>
        <p className="field-control__note">
          {t(unsupportedReasonKeys[editor.reason])}
        </p>
      </div>
    );
  }

  const applyValue = (next: EditableValue | undefined): void => {
    if (Object.is(next, value)) {
      setError(undefined);
      return;
    }
    if (onCommit(next)) {
      setSynchronizedValue(next);
      setError(undefined);
      return;
    }
    // The command was refused, which means the node or graph is no longer there. The
    // control returns to the value the document still holds instead of keeping a draft
    // that nothing accepted.
    setDraft(formatFieldValue(value));
    setError(undefined);
  };

  const commitDraft = (): void => {
    const validation = parseFieldInput(editor, draft, required);
    if (!validation.ok) {
      setError({
        messageKey: validation.messageKey,
        parameters: validation.parameters,
      });
      return;
    }
    applyValue(validation.value);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(formatFieldValue(value));
      setError(undefined);
    }
  };

  const errorMessage = error
    ? translateDiagnostic(t, error.messageKey, error.parameters)
    : matchesEditor(editor, value)
      ? undefined
      : t("graph.inspector.validation.storedValueMismatch");

  const describedBy = errorMessage === undefined ? undefined : errorId;

  const control =
    editor.kind === "boolean" ? (
      <input
        type="checkbox"
        className="field-control__checkbox nodrag"
        aria-label={label}
        checked={value === true}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          applyValue(event.target.checked);
        }}
      />
    ) : editor.kind === "choice" ? (
      <Select
        className="field-control__select nodrag"
        aria-label={label}
        value={typeof value === "string" ? value : ""}
        placeholder={
          matchesEditor(editor, value) ? undefined : formatFieldValue(value)
        }
        options={editor.choices.map((choice) => ({
          value: choice.value,
          label: translateDataKey(t, choice.labelKey, choice.value),
          ...(choice.descriptionKey === undefined
            ? {}
            : {
                description: translateDataKey(t, choice.descriptionKey, ""),
              }),
        }))}
        onValueChange={(nextValue) => {
          applyValue(nextValue);
        }}
      />
    ) : (
      <input
        type="text"
        className="field-control__input nodrag"
        aria-label={label}
        aria-invalid={errorMessage === undefined ? undefined : true}
        aria-describedby={describedBy}
        inputMode={editor.kind === "number" ? "decimal" : undefined}
        value={draft}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setDraft(event.target.value);
        }}
        onFocus={() => {
          setEditing(true);
        }}
        onBlur={() => {
          setEditing(false);
          commitDraft();
        }}
        onKeyDown={handleKeyDown}
      />
    );

  return (
    <div
      className="field-control"
      data-variant={variant}
      data-invalid={errorMessage === undefined ? undefined : "true"}
    >
      <div className="field-control__row">
        {control}
        {editor.kind === "number" && editor.unitKey !== undefined ? (
          <span className="field-control__unit">
            {translateDataKey(t, editor.unitKey, "")}
          </span>
        ) : null}
      </div>
      {errorMessage === undefined ? null : (
        <p className="field-control__error" id={errorId}>
          {errorMessage}
        </p>
      )}
    </div>
  );
}
