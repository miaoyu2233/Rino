import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "json-schema-to-typescript";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const schemaPath = resolve(
  projectRoot,
  "schemas/protocol-envelope-v1.schema.json",
);
const outputArgumentIndex = process.argv.indexOf("--output");
const outputPath =
  outputArgumentIndex >= 0 && process.argv[outputArgumentIndex + 1]
    ? resolve(process.argv[outputArgumentIndex + 1])
    : resolve(
        projectRoot,
        "generated/typescript/protocol-envelope-v1.d.ts",
      );

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const source = await compile(schema, "RinoProtocolEnvelopeV1", {
  bannerComment:
    "/* Generated from schemas/protocol-envelope-v1.schema.json. Do not edit directly. */",
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
  unreachableDefinitions: true,
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, source.replaceAll("\r\n", "\n"), "utf8");
