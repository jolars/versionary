import { z } from "zod";

const artifactRuleSchema = z
  .object({
    type: z.enum(["json", "toml", "yaml", "regex"]),
    path: z.string().min(1),
    "field-path": z.string().optional(),
    jsonpath: z.string().optional(),
    pattern: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const needsJsonPath =
      value.type === "json" || value.type === "toml" || value.type === "yaml";
    const hasFieldPath = Boolean(value["field-path"] ?? value.jsonpath);
    if (needsJsonPath && !hasFieldPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.type} artifact rules require "field-path" (or deprecated "jsonpath").`,
        path: ["field-path"],
      });
    }
    if (needsJsonPath && value.pattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.type} artifact rules do not support "pattern".`,
        path: ["pattern"],
      });
    }
    if (value["field-path"] && value.jsonpath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Specify only one of "field-path" or deprecated "jsonpath".',
        path: ["field-path"],
      });
    }
    if (value.type === "regex" && !value.pattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'regex artifact rules require "pattern".',
        path: ["pattern"],
      });
    }
    if (value.type === "regex" && (value["field-path"] || value.jsonpath)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'regex artifact rules do not support "field-path" or deprecated "jsonpath".',
        path: ["field-path"],
      });
    }
  });

const packageSchema = z
  .object({
    "release-type": z.string().optional(),
    "package-name": z.string().optional(),
    "changelog-file": z.string().optional(),
    "changelog-format": z.enum(["markdown-changelog", "r-news"]).optional(),
    "exclude-paths": z.array(z.string()).optional(),
    "extra-files": z.array(artifactRuleSchema).optional(),
  })
  .strict();

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    "review-mode": z.enum(["direct", "pr", "review"]).optional(),
    "version-file": z.string().optional(),
    "changelog-file": z.string().optional(),
    "changelog-format": z.enum(["markdown-changelog", "r-news"]).optional(),
    "release-draft": z.boolean().optional(),
    "release-reference-comments": z
      .enum(["off", "best-effort", "strict"])
      .optional(),
    "release-branch": z.string().optional(),
    "baseline-file": z.string().optional(),
    "bootstrap-sha": z.string().optional(),
    "monorepo-mode": z.enum(["independent", "fixed"]).optional(),
    "bump-minor-pre-major": z.boolean().optional(),
    "allow-stable-major": z.boolean().optional(),
    "include-commit-authors": z.boolean().optional(),
    "release-type": z.string().optional(),
    packages: z.record(z.string().min(1), packageSchema).optional(),
  })
  .strict();

export type ConfigSchema = z.infer<typeof configSchema>;
