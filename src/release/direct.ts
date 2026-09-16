import { execFileSync } from "node:child_process";
import { loadConfig } from "../config/load-config.js";
import { createReleasePlan } from "./plan.js";
import {
  buildReleaseTargets,
  isReleaseCommitMessage,
  preparePendingReleasePr,
  prepareReleasePr,
} from "./pr.js";
import {
  type RunReleaseOptions,
  type RunReleaseResult,
  runReleaseDetailed,
} from "./release.js";
import {
  hasFullyUntaggedPendingRelease,
  hasReleaseStateChangeAtHead,
  readPendingReleaseTargets,
} from "./state.js";
import { releaseTargetHandoff } from "./targets.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function resolveDirectBranch(cwd: string): string {
  const ref = process.env.GITHUB_REF ?? "";
  const branch =
    process.env.VERSIONARY_BASE_BRANCH ||
    (ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "") ||
    git(cwd, "branch", "--show-current");
  if (!branch) {
    throw new Error(
      "Direct releases require a branch. Check out the release base branch or set VERSIONARY_BASE_BRANCH.",
    );
  }
  git(cwd, "check-ref-format", `refs/heads/${branch}`);
  return branch;
}

function pushDirectRelease(cwd: string, branch: string): void {
  git(cwd, "fetch", "origin", `refs/heads/${branch}`);
  try {
    // An earlier release may finish after a newer commit has reached trunk.
    git(cwd, "merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD");
    return;
  } catch {
    // A normal push rejects concurrent divergent updates without rewriting trunk.
  }
  try {
    git(cwd, "push", "origin", `HEAD:refs/heads/${branch}`);
  } catch (error) {
    throw new Error(
      `Failed pushing direct release commit to ${branch}; no release was published. Check branch permissions and whether the branch advanced, then retry.`,
      { cause: error },
    );
  }
}

export async function runDirectRelease(
  cwd = process.cwd(),
  options: RunReleaseOptions = {},
): Promise<RunReleaseResult | { action: "noop"; message: string }> {
  const releaseContext =
    isReleaseCommitMessage(git(cwd, "log", "-1", "--pretty=%B")) ||
    hasReleaseStateChangeAtHead(cwd);
  if (!releaseContext) {
    const pending = hasFullyUntaggedPendingRelease(cwd);
    const plan = pending ? undefined : createReleasePlan(cwd);
    if (plan && !plan.nextVersion) {
      return {
        action: "noop",
        message: "No releasable commits found. Nothing to do.",
      };
    }
    if (options["dry-run"]) {
      const targets = plan
        ? buildReleaseTargets(cwd, plan, loadConfig(cwd).config)
        : readPendingReleaseTargets(cwd);
      return {
        action: "release-dry-run",
        message: `Dry run: would ${pending ? "recover and publish" : "prepare and publish"} releases ${targets.map((target) => target.tag).join(", ")}`,
        targets: targets.map(({ tag, version }) => ({ tag, version })),
        releaseTargets: releaseTargetHandoff(targets, options.logger),
      };
    }
    const branch = resolveDirectBranch(cwd);
    if (pending) {
      preparePendingReleasePr(cwd, { logger: options.logger, branch });
    } else {
      prepareReleasePr(cwd, { logger: options.logger, branch });
    }
    pushDirectRelease(cwd, branch);
  } else if (!options["dry-run"]) {
    // A retry may start at a release commit whose previous branch push failed.
    pushDirectRelease(cwd, resolveDirectBranch(cwd));
  }
  return runReleaseDetailed(cwd, options);
}
