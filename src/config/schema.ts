import { z } from "zod";

const artifactRuleSchema = z.object({
  type: z.enum(["json", "toml", "yaml", "regex"]),
  path: z.string().min(1),
  jsonpath: z.string().optional(),
  pattern: z.string().optional(),
});

const packageSchema = z.object({
  "release-type": z.string().optional(),
  "package-name": z.string().optional(),
  "exclude-paths": z.array(z.string()).optional(),
  "extra-files": z.array(artifactRuleSchema).optional(),
});

export const configSchema = z.object({
  version: z.literal(1),
  "review-mode": z.enum(["direct", "review"]).optional(),
  "version-file": z.string().optional(),
  "changelog-file": z.string().optional(),
  "release-branch": z.string().optional(),
  "baseline-file": z.string().optional(),
  "bootstrap-sha": z.string().optional(),
  "monorepo-mode": z.enum(["independent", "fixed"]).optional(),
  "bump-minor-pre-major": z.boolean().optional(),
  "include-commit-authors": z.boolean().optional(),
  "release-type": z.string().optional(),
  packages: z.record(z.string().min(1), packageSchema).optional(),
  plugins: z.array(z.string().min(1)).optional(),
});

export type ConfigSchema = z.infer<typeof configSchema>;
