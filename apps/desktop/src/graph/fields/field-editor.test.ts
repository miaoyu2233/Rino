import type { TypeDescriptorV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import {
  formatFieldValue,
  literalEditorFor,
  matchesEditor,
  parseFieldInput,
  unwrapOptional,
  type FieldEditor,
} from "./field-editor";

const numberEditor: FieldEditor = {
  kind: "number",
  integer: false,
  minimum: undefined,
  maximum: undefined,
  unitKey: undefined,
};

describe("literal editors", () => {
  it("offers an editor for the primitive types a user can write", () => {
    expect(literalEditorFor({ kind: "number" }).kind).toBe("number");
    expect(literalEditorFor({ kind: "string" }).kind).toBe("text");
    expect(literalEditorFor({ kind: "bool" }).kind).toBe("boolean");
  });

  it("refuses an editor for values that are picked or produced elsewhere", () => {
    const refused: TypeDescriptorV1[] = [
      { kind: "rect" },
      { kind: "point" },
      { kind: "imageRef" },
      { kind: "ocrResult" },
      { kind: "exec" },
      { kind: "collection", element: { kind: "number" } },
    ];

    for (const type of refused) {
      expect(literalEditorFor(type)).toEqual({
        kind: "unsupported",
        reason: "typeUnsupported",
      });
    }
  });

  it("edits an optional value with the editor of the value it wraps", () => {
    const optionalNumber: TypeDescriptorV1 = {
      kind: "optional",
      value: { kind: "number" },
    };

    expect(literalEditorFor(optionalNumber).kind).toBe("number");
    expect(unwrapOptional(optionalNumber)).toEqual({
      inner: { kind: "number" },
      clearable: true,
    });
    expect(unwrapOptional({ kind: "number" }).clearable).toBe(false);
  });
});

describe("field input validation", () => {
  it("accepts a number and rejects text that is not one", () => {
    expect(parseFieldInput(numberEditor, "12.5", false)).toEqual({
      ok: true,
      value: 12.5,
    });

    const rejected = parseFieldInput(numberEditor, "12abc", false);
    expect(rejected.ok).toBe(false);
    expect(rejected).toMatchObject({
      messageKey: "graph.inspector.validation.notANumber",
    });
  });

  it("rejects a fraction where the definition asked for a whole number", () => {
    expect(
      parseFieldInput({ ...numberEditor, integer: true }, "3.5", false),
    ).toMatchObject({
      ok: false,
      messageKey: "graph.inspector.validation.notAnInteger",
    });
  });

  it("reports the bound that was exceeded", () => {
    const bounded: FieldEditor = {
      ...numberEditor,
      minimum: 0,
      maximum: 100,
    };

    expect(parseFieldInput(bounded, "-1", false)).toMatchObject({
      ok: false,
      messageKey: "graph.inspector.validation.tooSmall",
      parameters: { minimum: 0 },
    });
    expect(parseFieldInput(bounded, "101", false)).toMatchObject({
      ok: false,
      messageKey: "graph.inspector.validation.tooLarge",
      parameters: { maximum: 100 },
    });
    expect(parseFieldInput(bounded, "100", false)).toEqual({
      ok: true,
      value: 100,
    });
  });

  it("counts text length in characters rather than code units", () => {
    const editor: FieldEditor = {
      kind: "text",
      minimumLength: undefined,
      maximumLength: 2,
    };

    // Two astral characters are four code units, and refusing them would be a limit the
    // user cannot see.
    expect(parseFieldInput(editor, "🙂🙂", false)).toEqual({
      ok: true,
      value: "🙂🙂",
    });
    expect(parseFieldInput(editor, "🙂🙂🙂", false)).toMatchObject({
      ok: false,
      messageKey: "graph.inspector.validation.tooLong",
    });
  });

  it("clears an optional value when the field is emptied and refuses to clear a required one", () => {
    expect(parseFieldInput(numberEditor, "", false)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(parseFieldInput(numberEditor, "", true)).toMatchObject({
      ok: false,
      messageKey: "graph.inspector.validation.required",
    });
  });

  it("accepts only a declared choice", () => {
    const editor: FieldEditor = {
      kind: "choice",
      choices: [{ value: "equalTo", labelKey: "option.equalTo" }],
    };

    expect(parseFieldInput(editor, "equalTo", true)).toEqual({
      ok: true,
      value: "equalTo",
    });
    expect(parseFieldInput(editor, "somethingElse", true)).toMatchObject({
      ok: false,
      messageKey: "graph.inspector.validation.notAChoice",
    });
  });

  it("never produces a value for a field with no editor", () => {
    expect(
      parseFieldInput(
        { kind: "unsupported", reason: "typeUnsupported" },
        "5",
        false,
      ),
    ).toMatchObject({
      ok: false,
      messageKey: "graph.inspector.validation.notEditable",
    });
  });
});

describe("stored values", () => {
  it("renders a stored value as the text an editor starts from", () => {
    expect(formatFieldValue(0)).toBe("0");
    expect(formatFieldValue(false)).toBe("false");
    expect(formatFieldValue("text")).toBe("text");
    expect(formatFieldValue(undefined)).toBe("");
    expect(formatFieldValue(null)).toBe("");
    expect(formatFieldValue([1, 2])).toBe("[1,2]");
  });

  it("detects a stored value that no longer matches its field", () => {
    expect(matchesEditor(numberEditor, 5)).toBe(true);
    expect(matchesEditor(numberEditor, "5")).toBe(false);
    // An absent value is not a mismatch: the field is simply empty.
    expect(matchesEditor(numberEditor, undefined)).toBe(true);
    expect(
      matchesEditor(
        { kind: "choice", choices: [{ value: "a", labelKey: "a" }] },
        "b",
      ),
    ).toBe(false);
  });
});
