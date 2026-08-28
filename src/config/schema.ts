import { z } from "zod";

const artifactRuleSchema = z
  .object({
    type: z.enum(["json", "toml", "yaml", "nix", "regex"]),
    path: z.string().min(1),
    "field-path": z.string().optional(),
    pattern: z.string().optional(),
    replacement: z.string().optional(),
    "expected-matches": z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    const needsFieldPath =
      value.type === "json" ||
      value.type === "toml" ||
      value.type === "yaml" ||
      value.type === "nix";
    if (needsFieldPath && !value["field-path"]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.type} artifact rules require "field-path".`,
        path: ["field-path"],
      });
    }
    if (needsFieldPath && value.pattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.type} artifact rules do not support "pattern".`,
        path: ["pattern"],
      });
    }
    if (needsFieldPath && value.replacement) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.type} artifact rules do not support "replacement".`,
        path: ["replacement"],
      });
    }
    if (needsFieldPath && value["expected-matches"] !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.type} artifact rules do not support "expected-matches".`,
        path: ["expected-matches"],
      });
    }
    if (value.type === "regex" && !value.pattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'regex artifact rules require "pattern".',
        path: ["pattern"],
      });
    }
    if (value.type === "regex" && value["field-path"]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'regex artifact rules do not support "field-path".',
        path: ["field-path"],
      });
    }
  });

const packageSchema = z
  .object({
    "release-type": z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    "package-name": z.string().optional(),
    "changelog-file": z.string().optional(),
    "changelog-format": z.enum(["markdown-changelog", "r-news"]).optional(),
    "allow-stable-major": z.boolean().optional(),
    "exclude-paths": z.array(z.string()).optional(),
    "extra-files": z.array(artifactRuleSchema).optional(),
    follows: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    "review-mode": z.enum(["direct", "pr"]).optional(),
    "version-file": z.string().optional(),
    "changelog-file": z.string().optional(),
    "changelog-format": z.enum(["markdown-changelog", "r-news"]).optional(),
    "release-draft": z.boolean().optional(),
    "release-reference-comments": z
      .enum(["off", "best-effort", "strict"])
      .optional(),
    "release-branch": z.string().optional(),
    "separate-release-prs": z.boolean().optional(),
    "baseline-file": z.string().optional(),
    "bootstrap-sha": z.string().optional(),
    "monorepo-mode": z.enum(["independent", "fixed"]).optional(),
    "bump-minor-pre-major": z.boolean().optional(),
    "allow-stable-major": z.boolean().optional(),
    "include-commit-authors": z.boolean().optional(),
    "exclude-paths": z.array(z.string()).optional(),
    "release-type": z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    packages: z.record(z.string().min(1), packageSchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const packages = value.packages;
    if (value["separate-release-prs"]) {
      if (!packages || Object.keys(packages).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '"separate-release-prs" requires a non-empty packages map.',
          path: ["separate-release-prs"],
        });
      }
      if (value["monorepo-mode"] === "fixed") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            '"separate-release-prs" cannot be combined with monorepo-mode "fixed".',
          path: ["separate-release-prs"],
        });
      }
      if (value["review-mode"] === "direct") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            '"separate-release-prs" cannot be combined with review-mode "direct".',
          path: ["separate-release-prs"],
        });
      }
    }
    if (!packages) {
      return;
    }
    const knownPaths = new Set(Object.keys(packages));
    const followsByPath = new Map<string, string[]>();
    for (const [packagePath, packageConfig] of Object.entries(packages)) {
      const follows = packageConfig.follows;
      if (!follows || follows.length === 0) {
        continue;
      }
      followsByPath.set(packagePath, follows);
      for (const sourcePath of follows) {
        if (sourcePath === packagePath) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Package "${packagePath}" cannot follow itself.`,
            path: ["packages", packagePath, "follows"],
          });
          continue;
        }
        if (!knownPaths.has(sourcePath)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Package "${packagePath}" follows unknown package "${sourcePath}".`,
            path: ["packages", packagePath, "follows"],
          });
        }
      }
    }
    if (followsByPath.size > 0 && value["monorepo-mode"] === "fixed") {
      for (const followerPath of followsByPath.keys()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Package "follows" cannot be combined with monorepo-mode "fixed" (fixed mode already pins all package versions together).',
          path: ["packages", followerPath, "follows"],
        });
      }
    }
    const reportedCycles = new Set<string>();
    const findCycleFrom = (start: string): string[] | null => {
      const trail: string[] = [];
      const visit = (node: string): string[] | null => {
        const trailIndex = trail.indexOf(node);
        if (trailIndex !== -1) {
          return [...trail.slice(trailIndex), node];
        }
        const sources = followsByPath.get(node);
        if (!sources || sources.length === 0) {
          return null;
        }
        trail.push(node);
        for (const source of sources) {
          if (!knownPaths.has(source)) {
            continue;
          }
          const cycle = visit(source);
          if (cycle) {
            return cycle;
          }
        }
        trail.pop();
        return null;
      };
      return visit(start);
    };
    for (const followerPath of followsByPath.keys()) {
      const cycle = findCycleFrom(followerPath);
      if (!cycle) {
        continue;
      }
      const key = [...cycle].sort().join("->");
      if (reportedCycles.has(key)) {
        continue;
      }
      reportedCycles.add(key);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Package "follows" cycle detected: ${cycle.join(" -> ")}.`,
        path: ["packages", cycle[0] ?? followerPath, "follows"],
      });
    }
  });

export type ConfigSchema = z.infer<typeof configSchema>;
