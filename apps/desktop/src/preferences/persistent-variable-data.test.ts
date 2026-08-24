import { describe, expect, it } from "vitest";

import {
  MAX_PERSISTENT_VARIABLE_DOCUMENTS,
  isPersistentVariableValue,
  parsePersistentVariablesByDocument,
  selectPersistentVariableInitialValues,
  validatePersistentVariableValues,
} from "./persistent-variable-data";

const DOCUMENT_ID = "62000000-0000-4000-8000-000000000001";
const BOOL_ID = "62000000-0000-4000-8000-000000000002";
const NUMBER_ID = "62000000-0000-4000-8000-000000000003";
const STRING_ID = "62000000-0000-4000-8000-000000000004";
const IMAGE_ID = "62000000-0000-4000-8000-000000000005";

describe("persistent variable data", () => {
  it("rejects malformed values at the untrusted boundary", () => {
    expect(
      isPersistentVariableValue({
        variableId: NUMBER_ID,
        valueKind: "number",
        value: Number.NaN,
      }),
    ).toBe(false);
    expect(
      isPersistentVariableValue({
        variableId: NUMBER_ID,
        valueKind: "number",
        value: 1e308,
      }),
    ).toBe(true);
    expect(
      isPersistentVariableValue({
        variableId: NUMBER_ID,
        valueKind: "number",
        value: 1e308 + 1e308,
      }),
    ).toBe(false);
    expect(
      isPersistentVariableValue({
        variableId: STRING_ID,
        valueKind: "string",
        value: "😀".repeat(4097),
      }),
    ).toBe(false);
    expect(
      isPersistentVariableValue({
        variableId: NUMBER_ID,
        valueKind: "point",
        value: { x: 0, y: 2_147_483_648 },
      }),
    ).toBe(false);
    expect(
      isPersistentVariableValue({
        variableId: NUMBER_ID,
        valueKind: "rect",
        value: { x: 0, y: 0, width: 0, height: 1 },
      }),
    ).toBe(false);
  });

  it("rejects duplicate values and overlarge document maps", () => {
    expect(
      parsePersistentVariablesByDocument({
        [DOCUMENT_ID]: [
          { variableId: BOOL_ID, valueKind: "bool", value: true },
          { variableId: BOOL_ID, valueKind: "bool", value: false },
        ],
      }),
    ).toEqual({});
    const tooManyDocuments = Object.fromEntries(
      Array.from({ length: MAX_PERSISTENT_VARIABLE_DOCUMENTS + 1 }, (_, i) => [
        `62000000-0000-4000-8000-${(1000 + i).toString(16).padStart(12, "0")}`,
        [],
      ]),
    );
    expect(parsePersistentVariablesByDocument(tooManyDocuments)).toEqual({});
  });

  it("selects persistent values in graph order and filters stale entries", () => {
    const values = [
      { variableId: STRING_ID, valueKind: "string" as const, value: "text" },
      { variableId: BOOL_ID, valueKind: "bool" as const, value: true },
      { variableId: IMAGE_ID, valueKind: "string" as const, value: "stale" },
    ];
    expect(
      selectPersistentVariableInitialValues(
        {
          variables: [
            {
              variableId: BOOL_ID,
              name: "enabled",
              valueKind: "bool",
              persistent: true,
            },
            {
              variableId: NUMBER_ID,
              name: "count",
              valueKind: "number",
              persistent: true,
            },
            {
              variableId: STRING_ID,
              name: "text",
              valueKind: "string",
              persistent: true,
            },
            {
              variableId: IMAGE_ID,
              name: "image",
              valueKind: "imageRef",
              persistent: false,
            },
          ],
        },
        values,
      ),
    ).toEqual([
      { variableId: BOOL_ID, valueKind: "bool", value: true },
      { variableId: STRING_ID, valueKind: "string", value: "text" },
    ]);
  });

  it("falls back to the selected legacy graph variables", () => {
    const graphId = "62000000-0000-4000-8000-000000000006";
    expect(
      selectPersistentVariableInitialValues(
        {
          graphs: [
            {
              graphId,
              name: "旧任务",
              kind: "entry",
              nodes: [],
              edges: [],
              variables: [
                {
                  variableId: NUMBER_ID,
                  name: "legacyCount",
                  valueKind: "number",
                  persistent: true,
                },
              ],
            },
          ],
        },
        [{ variableId: NUMBER_ID, valueKind: "number", value: 7 }],
        graphId,
      ),
    ).toEqual([{ variableId: NUMBER_ID, valueKind: "number", value: 7 }]);
  });

  it("does not use a different legacy graph as a fallback", () => {
    const graphId = "62000000-0000-4000-8000-000000000006";
    expect(
      selectPersistentVariableInitialValues(
        {
          graphs: [
            {
              graphId: "62000000-0000-4000-8000-000000000007",
              name: "另一个任务",
              kind: "entry",
              nodes: [],
              edges: [],
              variables: [
                {
                  variableId: NUMBER_ID,
                  name: "legacyCount",
                  valueKind: "number",
                  persistent: true,
                },
              ],
            },
          ],
        },
        [{ variableId: NUMBER_ID, valueKind: "number", value: 7 }],
        graphId,
      ),
    ).toEqual([]);
  });

  it("validates updates against persistence and kind", () => {
    const definitions = [
      { variableId: BOOL_ID, valueKind: "bool" as const, persistent: true },
      {
        variableId: NUMBER_ID,
        valueKind: "number" as const,
        persistent: false,
      },
    ];
    expect(
      validatePersistentVariableValues(definitions, [
        { variableId: BOOL_ID, valueKind: "bool", value: true },
      ]),
    ).toMatchObject({ ok: true });
    expect(
      validatePersistentVariableValues(definitions, [
        { variableId: NUMBER_ID, valueKind: "number", value: 1 },
      ]),
    ).toMatchObject({ ok: false, reason: "nonPersistentVariable" });
  });
});
