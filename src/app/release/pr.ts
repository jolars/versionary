import { execFileSync } from "node:child_process";
import path from "node:path";
import { loadConfig } from "../../config/load-config.js";
import {
  prependChangelog,
  renderSimpleChangelog,
} from "../../domain/release/changelog.js";
import { createSimplePlan } from "../../domain/release/plan.js";
import { resolveVersionStrategy } from "../../domain/strategy/resolve.js";
import type { ParsedCommit } from "../../infra/git/commits.js";
import { inferReleaseTypeFromParsedCommit } from "../../infra/git/commits.js";
import { resolveRepositoryWebBaseUrl } from "../../infra/git/repo-url.js";
import { findPluginsByCapability } from "../../plugins/capabilities.js";
import { loadRuntimePlugins } from "../../plugins/runtime.js";
import { getBaselineStatePath, writeBaselineSha } from "./state.js";

const SAFE_DIRTY_FILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
]);

function listTrackedDirtyFiles(cwd: string): string[] {
  const status = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );

  return status
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3))
    .map((pathPart) => {
      const renameParts = pathPart.split(" -> ");
      return renameParts.at(-1) ?? pathPart;
    })
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0);
}

export function splitSafeDirtyFiles(files: string[]): {
  ignored: string[];
  blocking: string[];
} {
  const ignored: string[] = [];
  const blocking: string[] = [];
  for (const file of files) {
    const basename = path.basename(file);
    if (SAFE_DIRTY_FILES.has(basename)) {
      ignored.push(file);
      continue;
    }
    blocking.push(file);
  }
  return { ignored, blocking };
}

function ensureCleanWorktree(cwd: string): void {
  const dirtyFiles = listTrackedDirtyFiles(cwd);
  const { ignored, blocking } = splitSafeDirtyFiles(dirtyFiles);

  if (blocking.length > 0) {
    throw new Error(
      `Working tree has tracked modifications before versionary pr:\n${blocking.join("\n")}\nCommit/stash tracked changes first.`,
    );
  }

  if (ignored.length > 0) {
    console.warn(
      `Ignoring safe tracked changes before versionary pr:\n${ignored.join("\n")}`,
    );
  }
}

export function prepareSimpleReleasePr(cwd = process.cwd()): {
  branch: string;
  title: string;
  version: string;
  commits: ParsedCommit[];
} {
  const plan = createSimplePlan(cwd);
  const loaded = loadConfig(cwd);
  const strategy = resolveVersionStrategy(loaded.config);
  if (!plan.nextVersion) {
    throw new Error(
      "No releasable commits found. Nothing to open a release PR for.",
    );
  }

  ensureCleanWorktree(cwd);

  const updatedVersionFiles = strategy.writeVersion(
    cwd,
    loaded.config,
    plan.nextVersion,
  );
  const section = renderSimpleChangelog(plan);
  prependChangelog(cwd, plan.changelogFile, section);

  const branch = plan.releaseBranchPrefix;
  const title = `chore(release): v${plan.nextVersion}`;

  execFileSync("git", ["checkout", "-B", branch], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const filesToAdd = [...new Set([...updatedVersionFiles, plan.changelogFile])];
  execFileSync("git", ["add", ...filesToAdd], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  execFileSync("git", ["commit", "-m", title], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  writeBaselineSha(cwd);
  execFileSync("git", ["add", getBaselineStatePath(cwd)], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  execFileSync("git", ["commit", "--amend", "--no-edit"], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });

  return {
    branch,
    title,
    version: plan.nextVersion,
    commits: plan.commits,
  };
}

function formatCommitMessage(subject: string): {
  label: string;
  message: string;
} {
  const conventional = subject.match(/^[a-z]+(?:\(([^)]+)\))?!?:\s+(.+)$/iu);
  if (!conventional) {
    return { label: "", message: subject };
  }

  const scope = conventional[1]?.trim();
  const message = conventional[2]?.trim() ?? subject;
  const label = scope ? `**${scope}:** ` : "";
  return { label, message };
}

export function renderSimpleReviewRequestBody(
  version: string,
  commits: ParsedCommit[],
  cwd = process.cwd(),
): string {
  const breaking: string[] = [];
  const features: string[] = [];
  const fixes: string[] = [];
  const commitBaseUrl = resolveRepositoryWebBaseUrl(cwd);

  for (const commit of commits) {
    const subject = commit.subject;
    const { label, message } = formatCommitMessage(subject);
    const hash = commit.hash.slice(0, 7);
    const hashLabel = commitBaseUrl
      ? `[\`${hash}\`](${commitBaseUrl}/commit/${commit.hash})`
      : `\`${hash}\``;
    const type = inferReleaseTypeFromParsedCommit(commit);
    if (!type) {
      continue;
    }

    const item = `- ${label}${message} (${hashLabel})`;
    if (type === "major") {
      breaking.push(item);
      continue;
    }

    if (type === "minor") {
      features.push(item);
      continue;
    }

    fixes.push(item);
  }

  const sections: string[] = [];
  if (breaking.length > 0) {
    sections.push("### Breaking changes", ...breaking, "");
  }
  if (features.length > 0) {
    sections.push("### Features", ...features, "");
  }
  if (fixes.length > 0) {
    sections.push("### Fixes", ...fixes, "");
  }

  return [
    ":robot: I have created a release PR for this repository.",
    "",
    `## Version`,
    "",
    `This PR prepares **v${version}**.`,
    "",
    "## Release notes preview",
    "",
    ...sections,
    "This PR was generated by Versionary.",
  ].join("\n");
}

export async function openOrUpdateSimpleReviewRequest(
  cwd: string,
  branch: string,
  title: string,
  version: string,
  commits: ParsedCommit[],
): Promise<string> {
  const loaded = loadConfig(cwd);
  const releaseFlow = loaded.config["review-mode"] ?? "direct";
  if (releaseFlow !== "review") {
    return "Release flow mode is direct; skipping review request creation.";
  }

  const plugins = loadRuntimePlugins();
  const scmPlugins = findPluginsByCapability(plugins, "scm.reviewRequest");
  if (scmPlugins.length === 0) {
    throw new Error(
      "review-mode is review but no scm.reviewRequest plugin is available.",
    );
  }

  const plugin = scmPlugins[0];
  if (!plugin?.createOrUpdateReviewRequest) {
    throw new Error(
      `Plugin "${plugin?.name ?? "unknown"}" does not implement createOrUpdateReviewRequest.`,
    );
  }

  const result = await plugin.createOrUpdateReviewRequest(
    {
      baseBranch: process.env.VERSIONARY_BASE_BRANCH ?? "main",
      headBranch: branch,
      title,
      body: renderSimpleReviewRequestBody(version, commits, cwd),
      labels: ["release"],
    },
    {
      cwd,
      logger: console,
    },
  );

  return result.url;
}

export function pushReleaseBranch(cwd: string, branch: string): void {
  execFileSync("git", ["push", "--force-with-lease", "origin", branch], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function isReleaseCommitMessage(subject: string): boolean {
  return /^chore\(release\):\sv\d+\.\d+\.\d+/u.test(subject);
}
