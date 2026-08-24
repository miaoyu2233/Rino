import type { NodeDefinitionV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import { developmentRegistrySnapshot } from "../registry/development-registry";
import { MAXIMUM_PROPERTY_FIELDS, readPropertyFields } from "./property-schema";

function definitionFor(typeKey: string): NodeDefinitionV1 {
  const definition = developmentRegistrySnapshot().definitions.find(
    (candidate) => candidate.typeKey === typeKey,
  );
  if (!definition) {
    throw new Error(`The registry fixture must declare ${typeKey}.`);
  }
  return definition;
}

function definitionWithSchema(
  propertySchema: NonNullable<NodeDefinitionV1["propertySchema"]>,
  propertyDefaults?: NonNullable<NodeDefinitionV1["propertyDefaults"]>,
): NodeDefinitionV1 {
  const base = definitionFor("core.flow.start");
  return propertyDefaults === undefined
    ? { ...base, propertySchema }
    : { ...base, propertySchema, propertyDefaults };
}

describe("property schema reading", () => {
  it("produces no fields for a definition that declares no property schema", () => {
    expect(readPropertyFields(definitionFor("core.flow.start"))).toEqual({
      fields: [],
      schemaUnreadable: false,
      hiddenFieldCount: 0,
    });
  });

  it("reads a numeric property with its label, requirement, and default", () => {
    const { fields } = readPropertyFields(
      definitionFor("core.value.numberLiteral"),
    );

    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      propertyKey: "value",
      labelKey: "node.core.value.numberLiteral.property.value.label",
      descriptionKey:
        "node.core.value.numberLiteral.property.value.description",
      required: true,
      defaultValue: 0,
    });
    expect(fields[0]?.editor.kind).toBe("number");
  });

  it("reads a choice property with a localization key for every option", () => {
    const { fields } = readPropertyFields(
      definitionFor("core.logic.numberCompare"),
    );
    const editor = fields[0]?.editor;

    expect(fields[0]?.propertyKey).toBe("operator");
    expect(editor?.kind).toBe("choice");
    if (editor?.kind !== "choice") {
      throw new Error("The operator property must render as a choice.");
    }
    expect(editor.choices.map((choice) => choice.value)).toEqual([
      "greaterThan",
      "greaterThanOrEqual",
      "lessThan",
      "lessThanOrEqual",
      "equalTo",
      "notEqualTo",
    ]);
    expect(editor.choices[0]?.labelKey).toBe(
      "node.core.logic.numberCompare.property.operator.option.greaterThan",
    );
  });

  it("reads boolean and text properties with their declared bounds", () => {
    const { fields } = readPropertyFields(
      definitionWithSchema({
        type: "object",
        properties: {
          enabled: { type: "boolean", "x-rinoLabelKey": "field.enabled" },
          name: {
            type: "string",
            minLength: 1,
            maxLength: 32,
            "x-rinoLabelKey": "field.name",
          },
        },
      }),
    );

    expect(fields[0]?.editor).toEqual({ kind: "boolean" });
    expect(fields[1]?.editor).toEqual({
      kind: "text",
      minimumLength: 1,
      maximumLength: 32,
    });
  });

  it("carries the unit and range of a bounded integer", () => {
    const { fields } = readPropertyFields(
      definitionWithSchema({
        type: "object",
        properties: {
          timeout: {
            type: "integer",
            minimum: 0,
            maximum: 60000,
            "x-rinoLabelKey": "field.timeout",
            "x-rinoUnitKey": "unit.millisecond",
          },
        },
      }),
    );

    expect(fields[0]?.editor).toEqual({
      kind: "number",
      integer: true,
      minimum: 0,
      maximum: 60000,
      unitKey: "unit.millisecond",
    });
  });

  it("refuses a property whose label or option labels are missing", () => {
    const { fields } = readPropertyFields(
      definitionWithSchema({
        type: "object",
        properties: {
          unlabelled: { type: "string" },
          opaqueChoice: {
            type: "string",
            enum: ["a", "b"],
            "x-rinoLabelKey": "field.choice",
          },
        },
      }),
    );

    expect(fields[0]).toMatchObject({
      labelKey: "unlabelled",
      editor: { kind: "unsupported", reason: "labelMissing" },
    });
    expect(fields[1]?.editor).toEqual({
      kind: "unsupported",
      reason: "choicesInvalid",
    });
  });

  it("refuses a property type it cannot draw while keeping the property visible", () => {
    const { fields } = readPropertyFields(
      definitionWithSchema({
        type: "object",
        properties: {
          region: { type: "object", "x-rinoLabelKey": "field.region" },
        },
      }),
    );

    expect(fields[0]).toMatchObject({
      propertyKey: "region",
      labelKey: "field.region",
      editor: { kind: "unsupported", reason: "typeUnsupported" },
    });
  });

  it("reports a declaration it cannot read as an object schema", () => {
    expect(readPropertyFields(definitionWithSchema({ type: "array" }))).toEqual(
      {
        fields: [],
        schemaUnreadable: true,
        hiddenFieldCount: 0,
      },
    );
  });

  it("bounds how many declared properties it renders", () => {
    const properties: Record<string, unknown> = {};
    for (let index = 0; index < MAXIMUM_PROPERTY_FIELDS + 3; index += 1) {
      properties[`field${String(index)}`] = {
        type: "string",
        "x-rinoLabelKey": `field.${String(index)}`,
      };
    }

    const result = readPropertyFields(
      definitionWithSchema({
        type: "object",
        properties,
      } as NonNullable<NodeDefinitionV1["propertySchema"]>),
    );

    expect(result.fields).toHaveLength(MAXIMUM_PROPERTY_FIELDS);
    expect(result.hiddenFieldCount).toBe(3);
  });

  it("marks a property required only when the schema says so", () => {
    const { fields } = readPropertyFields(
      definitionWithSchema(
        {
          type: "object",
          required: ["kept"],
          properties: {
            kept: { type: "string", "x-rinoLabelKey": "field.kept" },
            optional: { type: "string", "x-rinoLabelKey": "field.optional" },
          },
        },
        { kept: "value" },
      ),
    );

    expect(fields[0]).toMatchObject({ required: true, defaultValue: "value" });
    expect(fields[1]).toMatchObject({
      required: false,
      defaultValue: undefined,
    });
  });
});
