import { z } from "zod";

const artifactRuleSchema = z
  .object({
    type: z.enum(["json", "toml", "yaml", "regex"]),
    path: z.string().min(1),
    jsonpath: z.string().optional(),
    pattern: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const needsJsonPath =
      value.type === "json" || value.type === "toml" || value.type === "yaml";
    if (needsJsonPath && !value.jsonpath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.type} artifact rules require "jsonpath".`,
        path: ["jsonpath"],
      });
    }
    if (needsJsonPath && value.pattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.type} artifact rules do not support "pattern".`,
        path: ["pattern"],
      });
    }
    if (value.type === "regex" && !value.pattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'regex artifact rules require "pattern".',
        path: ["pattern"],
      });
    }
    if (value.type === "regex" && value.jsonpath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'regex artifact rules do not support "jsonpath".',
        path: ["jsonpath"],
      });
    }
  });

const packageSchema = z
  .object({
    "release-type": z.string().optional(),
    "package-name": z.string().optional(),
    "exclude-paths": z.array(z.string()).optional(),
    "extra-files": z.array(artifactRuleSchema).optional(),
  })
  .strict();

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    "review-mode": z.enum(["direct", "review"]).optional(),
    "version-file": z.string().optional(),
    "changelog-file": z.string().optional(),
    "release-branch": z.string().optional(),
    "baseline-file": z.string().optional(),
    "bootstrap-sha": z.string().optional(),
    "monorepo-mode": z.enum(["independent", "fixed"]).optional(),
    "bump-minor-pre-major": z.boolean().optional(),
    "allow-stable-major": z.boolean().optional(),
    "include-commit-authors": z.boolean().optional(),
    "release-type": z.string().optional(),
    packages: z.record(z.string().min(1), packageSchema).optional(),
    plugins: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type ConfigSchema = z.infer<typeof configSchema>;
