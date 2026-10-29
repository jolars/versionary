import { readFileSync } from "node:fs";
import { z } from "zod";
import { loadConfig } from "./config/load-config.js";
import { resolveSeparateReleaseBranchPrefix } from "./release/cohorts.js";

const pullRequestSchema = z.object({
  pull_request: z.object({
    head: z.object({
      ref: z.string().min(1),
      repo: z.object({ full_name: z.string().min(1) }),
    }),
    base: z.object({ repo: z.object({ full_name: z.string().min(1) }) }),
  }),
});

export interface CiDecision {
  action: "ci-evaluated";
  message: string;
  runChecks: boolean;
  isReleasePr: boolean;
}

function readPullRequest(env: NodeJS.ProcessEnv) {
  if (
    (env.GITHUB_EVENT_NAME !== "pull_request" &&
      env.GITHUB_EVENT_NAME !== "pull_request_target") ||
    !env.GITHUB_EVENT_PATH
  ) {
    return null;
  }
  try {
    const result = pullRequestSchema.safeParse(
      JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")),
    );
    return result.success ? result.data.pull_request : null;
  } catch {
    // Incomplete event context must never suppress checks.
    return null;
  }
}

export function evaluateCi(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): CiDecision {
  const { config } = loadConfig(cwd);
  const request = readPullRequest(env);
  const repository = env.GITHUB_REPOSITORY?.trim().toLowerCase();
  const releaseBranch = resolveSeparateReleaseBranchPrefix(
    config["release-branch"] ?? "versionary/release",
  );
  const headBranch = request?.head.ref ?? "";
  const separateBranch =
    config["separate-release-prs"] === true &&
    headBranch.startsWith(`${releaseBranch}-`) &&
    /^[A-Za-z0-9._-]+-[a-f0-9]{12}$/u.test(
      headBranch.slice(releaseBranch.length + 1),
    );
  const isReleasePr = Boolean(
    config["review-mode"] !== "direct" &&
      releaseBranch &&
      repository &&
      request?.head.repo.full_name.toLowerCase() === repository &&
      request?.base.repo.full_name.toLowerCase() === repository &&
      (headBranch === releaseBranch || separateBranch),
  );
  const runChecks = config["release-pr-checks"] !== "skip" || !isReleasePr;
  return {
    action: "ci-evaluated",
    message: runChecks
      ? "CI checks are enabled."
      : `Skipping checks for Versionary release PR ${headBranch}.`,
    runChecks,
    isReleasePr,
  };
}
