import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

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
await mkdir(dirname(typesOutputPath), { recursive: true });
await writeFile(typesOutputPath, typesSource.replaceAll("\r\n", "\n"), "utf8");
await writeFile(schemaOutputPath, schemaModuleSource.replaceAll("\r\n", "\n"), "utf8");
