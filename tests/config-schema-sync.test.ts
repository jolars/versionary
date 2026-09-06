import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildConfigSchema } from "../scripts/generate-schema.js";

const schemaPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "schemas",
  "config.json",
);

describe("schemas/config.json", () => {
  it("is in sync with the Zod config schema (run `pnpm gen:schema`)", () => {
    const onDisk = JSON.parse(readFileSync(schemaPath, "utf8"));
    expect(onDisk).toEqual(buildConfigSchema());
  });

  it("marks bump-minor-pre-major as deprecated", () => {
    const schema = buildConfigSchema() as {
      properties: Record<
        string,
        {
          deprecated?: boolean;
          additionalProperties?: {
            properties?: Record<string, { deprecated?: boolean }>;
          };
        }
      >;
    };

    expect(schema.properties["bump-minor-pre-major"]?.deprecated).toBe(true);
    expect(
      schema.properties.packages?.additionalProperties?.properties?.[
        "bump-minor-pre-major"
      ]?.deprecated,
    ).toBe(true);
  });
});
