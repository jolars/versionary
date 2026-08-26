import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { configSchema } from "../src/config/schema.js";

const SCHEMA_ID =
  "https://raw.githubusercontent.com/jolars/versionary/main/schemas/config.json";

const OUTPUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "schemas",
  "config.json",
);

// `z.toJSONSchema()` cannot represent the `.superRefine()` cross-field rules on
// artifact rules (it flattens `extra-files` items into a single object where
// `field-path` and `pattern` are both independently optional). We
// re-impose the json/toml/yaml/nix vs regex discrimination by hand so editors
// still surface those constraints. Keep the allowed `type` values in sync with
// `artifactRuleSchema` in src/config/schema.ts.
const artifactRuleItems = {
  oneOf: [
    {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["json", "toml", "yaml", "nix"],
        },
        path: { type: "string", minLength: 1 },
        "field-path": { type: "string" },
      },
      required: ["type", "path", "field-path"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "regex" },
        path: { type: "string", minLength: 1 },
        pattern: { type: "string" },
        replacement: { type: "string" },
        "expected-matches": { type: "integer", minimum: 1 },
      },
      required: ["type", "path", "pattern"],
      additionalProperties: false,
    },
  ],
} as const;

/**
 * Build the JSON Schema for `versionary.jsonc`/`versionary.json` from the
 * authoritative Zod schema, patching in the constraints Zod cannot express.
 * Exported so a test can assert the committed `schemas/config.json` is in sync.
 */
export function buildConfigSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(configSchema, {
    target: "draft-2020-12",
  }) as Record<string, unknown> & {
    $schema?: string;
    properties: {
      packages: {
        additionalProperties: {
          properties: { "extra-files": { items: unknown } };
        };
      };
    };
  };

  generated.properties.packages.additionalProperties.properties[
    "extra-files"
  ].items = artifactRuleItems;

  const { $schema, ...rest } = generated;
  return {
    $schema,
    $id: SCHEMA_ID,
    title: "Versionary configuration",
    ...rest,
  };
}

function main(): void {
  const schema = buildConfigSchema();
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(schema, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
