import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { compile } from "json-schema-to-typescript";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(packageRoot, "../..");

const { values } = parseArgs({
  options: {
    schema: { type: "string" },
    basename: { type: "string" },
    "root-type": { type: "string" },
    "output-root": { type: "string" },
    "emit-artifact-schema": { type: "string" },
  },
});

const schemaPath = resolve(repositoryRoot, values.schema ?? "");
const basename = values.basename ?? "";
const rootTypeName = values["root-type"] ?? "";
if (!values.schema || !basename || !rootTypeName) {
  throw new Error(
    "generate-artifacts requires --schema, --basename, and --root-type.",
  );
}
const outputRoot = values["output-root"]
  ? resolve(values["output-root"])
  : packageRoot;

const schemaText = await readFile(schemaPath, "utf8");
const canonicalSchema = JSON.parse(schemaText);
const schemaId = canonicalSchema.$id;
if (typeof schemaId !== "string" || !schemaId) {
  throw new Error(`Canonical schema ${values.schema} must define a string $id.`);
}

const validatorEngine = new Ajv2020({
  allErrors: false,
  allowUnionTypes: false,
  strict: true,
  validateFormats: true,
  code: { source: true, esm: true },
});
validatorEngine.addFormat(
  "uuid",
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
);
validatorEngine.addFormat(
  "date-time",
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
);
validatorEngine.addSchema(canonicalSchema);
if (!validatorEngine.getSchema(schemaId)) {
  throw new Error(`Canonical schema ${schemaId} failed to compile.`);
}

const definitionNames = Object.keys(canonicalSchema.$defs).sort();
const validatorExports = { rootValidator: schemaId };
for (const [index, definitionName] of definitionNames.entries()) {
  const definitionRef = `${schemaId}#/$defs/${definitionName}`;
  validatorEngine.compile({ $ref: definitionRef });
  validatorExports[`definitionValidator${index}`] = definitionRef;
}
const ucs2LengthImplementation = `((value) => {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      (value.charCodeAt(index + 1) & 0xfc00) === 0xdc00
    ) {
      index += 1;
    }
    length += 1;
  }
  return length;
})`;
const standaloneValidatorsSource = standaloneCode(
  validatorEngine,
  validatorExports,
).replaceAll(
  'require("ajv/dist/runtime/ucs2length").default',
  ucs2LengthImplementation,
);
if (
  /require\s*\(|new Function|eval\s*\(|(?:ajv|validatorEngine)\.compile\s*\(/u.test(
    standaloneValidatorsSource,
  )
) {
  throw new Error(
    `Static validator generation emitted a forbidden runtime construct for ${values.schema}.`,
  );
}

// Definitions such as message payloads are not always reachable from the schema root, and
// both generators skip unreachable definitions. This deterministic catalog wrapper makes
// every definition reachable so each one is generated exactly once with its canonical name.
function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

const catalogProperties = Object.fromEntries(
  Object.keys(canonicalSchema.$defs)
    .sort()
    .map((definitionName) => [
      lowerFirst(definitionName),
      { $ref: `#/$defs/${definitionName}` },
    ]),
);

// The schema root itself is generated under its canonical title. The catalog property is
// named after that title because one generator derives the type name from the title and
// the other from the property name; matching them keeps both artifacts on one name.
const { $schema, $id, $defs, title, description, ...rootBody } = canonicalSchema;
catalogProperties[lowerFirst(title)] = { title, ...rootBody };

const artifactSchema = {
  $schema,
  $id: `${$id.replace(/\.schema\.json$/u, "")}.artifact-catalog.json`,
  title: `${rootTypeName}ArtifactCatalog`,
  description: "Generation-only catalog that makes every definition reachable.",
  type: "object",
  additionalProperties: false,
  properties: catalogProperties,
  $defs,
};

if (values["emit-artifact-schema"]) {
  const artifactSchemaPath = resolve(values["emit-artifact-schema"]);
  await mkdir(dirname(artifactSchemaPath), { recursive: true });
  await writeFile(
    artifactSchemaPath,
    `${JSON.stringify(artifactSchema, null, 2)}\n`,
    "utf8",
  );
}

const typesSource = await compile(
  artifactSchema,
  `${rootTypeName}ArtifactCatalog`,
  {
    bannerComment: `/* Generated from ${values.schema}. Do not edit directly. */`,
    enableConstEnums: false,
    format: true,
    style: {
      bracketSpacing: true,
      printWidth: 88,
      semi: true,
      singleQuote: false,
      tabWidth: 2,
      trailingComma: "all",
      useTabs: false,
    },
    unknownAny: false,
    unreachableDefinitions: false,
  },
);

const schemaConstantName = `${basename.replaceAll("-", "_").toUpperCase()}_SCHEMA`;
const schemaModuleSource = [
  `/* Generated from ${values.schema}. Do not edit directly. */`,
  "",
  `export const ${lowerFirst(toCamelCase(schemaConstantName))} = ${JSON.stringify(
    JSON.parse(schemaText),
    null,
    2,
  )} as const;`,
  "",
].join("\n");

const validatorsModuleSource = [
  `/* Generated from ${values.schema}. Do not edit directly. */`,
  "",
  standaloneValidatorsSource.trimEnd(),
  "",
  "export const definitionValidators = new Map([",
  ...definitionNames.map(
    (definitionName, index) =>
      `  [${JSON.stringify(definitionName)}, definitionValidator${index}],`,
  ),
  "]);",
  "",
].join("\n");

const validatorsDeclarationSource = [
  `/* Generated from ${values.schema}. Do not edit directly. */`,
  "",
  "export interface ValidatorError {",
  "  instancePath: string;",
  "  keyword: string;",
  "  message?: string;",
  "  params: Record<string, unknown>;",
  "  schemaPath: string;",
  "}",
  "",
  "export interface StaticValidator {",
  "  (data: unknown): boolean;",
  "  errors?: ValidatorError[] | null;",
  "}",
  "",
  "export declare const rootValidator: StaticValidator;",
  "export declare const definitionValidators: ReadonlyMap<string, StaticValidator>;",
  "",
].join("\n");

function toCamelCase(constantName) {
  return constantName
    .toLowerCase()
    .split("_")
    .map((segment, index) =>
      index === 0 ? segment : segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join("");
}

const typesOutputPath = resolve(outputRoot, `src/generated/${basename}.types.ts`);
const schemaOutputPath = resolve(outputRoot, `src/generated/${basename}.schema.ts`);
const validatorsOutputPath = resolve(
  outputRoot,
  `src/generated/${basename}.validators.js`,
);
const validatorsDeclarationOutputPath = resolve(
  outputRoot,
  `src/generated/${basename}.validators.d.ts`,
);
await mkdir(dirname(typesOutputPath), { recursive: true });
await writeFile(typesOutputPath, typesSource.replaceAll("\r\n", "\n"), "utf8");
await writeFile(schemaOutputPath, schemaModuleSource.replaceAll("\r\n", "\n"), "utf8");
await writeFile(
  validatorsOutputPath,
  validatorsModuleSource.replaceAll("\r\n", "\n"),
  "utf8",
);
await writeFile(
  validatorsDeclarationOutputPath,
  validatorsDeclarationSource.replaceAll("\r\n", "\n"),
  "utf8",
);
