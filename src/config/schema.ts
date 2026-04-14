import { z } from "zod";

const artifactRuleSchema = z.object({
  file: z.string().min(1),
  format: z.enum(["json", "toml", "yaml", "regex"]),
  path: z.string().optional(),
  pattern: z.string().optional(),
});

const packageSchema = z.object({
  path: z.string().min(1),
  strategy: z.string().optional(),
  packageName: z.string().optional(),
  excludePaths: z.array(z.string()).optional(),
  artifacts: z.array(artifactRuleSchema).optional(),
});

const pluginSchema = z.object({
  name: z.string().min(1),
  options: z.record(z.string(), z.unknown()).optional(),
});

const pluginExecutionSchema = z.object({
  step: z.enum([
    "verifyConditions",
    "analyzeCommits",
    "resolveReverts",
    "verifyRelease",
    "generateNotes",
    "updateArtifacts",
    "preparePr",
    "publish",
    "postRelease",
    "success",
    "fail",
  ]),
  lifecycle: z.array(z.enum(["plan", "pr", "release"])).optional(),
  merge: z.enum(["highest", "concat", "override", "reduce"]).optional(),
});

const pluginConfigSchema = z.object({
  extends: z.array(z.object({ name: z.string().min(1) })).optional(),
  globalOptions: z.record(z.string(), z.unknown()).optional(),
  execution: z.array(pluginExecutionSchema).optional(),
  plugins: z.array(pluginSchema).optional(),
});

export const configSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["simple", "standard"]).optional(),
  releaseFlow: z
    .object({
      mode: z.enum(["direct", "review"]).default("direct"),
    })
    .optional(),
  history: z
    .object({
      bootstrap: z
        .object({
          sha: z.string().optional(),
          tag: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  monorepo: z
    .object({
      mode: z.enum(["independent", "fixed"]).default("independent"),
    })
    .optional(),
  defaults: z
    .object({
      strategy: z.string().optional(),
      versioning: z
        .object({
          bumpMinorPreMajor: z.boolean().optional(),
        })
        .optional(),
      changelog: z
        .object({
          includeAuthors: z.boolean().optional(),
        })
        .optional(),
      commitConventions: z
        .object({
          preset: z.enum(["conventional", "angular", "custom"]).default("conventional"),
        })
        .optional(),
    })
    .optional(),
  packages: z.array(packageSchema).optional(),
  pluginConfig: pluginConfigSchema.optional(),
  plugins: z.array(pluginSchema).optional(),
  simple: z
    .object({
      versionFile: z.string().optional(),
      changelogFile: z.string().optional(),
      releaseBranchPrefix: z.string().optional(),
      baselineShaFile: z.string().optional(),
    })
    .optional(),
});

export type ConfigSchema = z.infer<typeof configSchema>;
