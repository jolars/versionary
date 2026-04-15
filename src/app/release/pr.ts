import { execFileSync } from "node:child_process";
import path from "node:path";
import { loadConfig } from "../../config/load-config.js";
import {
  prependChangelog,
  renderSimpleChangelog,
  renderSimpleReleaseNotes,
} from "../../domain/release/changelog.js";
import {
  createSimplePlan,
  type SimplePlan,
} from "../../domain/release/plan.js";
import { resolveVersionStrategy } from "../../domain/strategy/resolve.js";
import type { ParsedCommit } from "../../infra/git/commits.js";
import { findPluginsByCapability } from "../../plugins/capabilities.js";
import { loadRuntimePlugins } from "../../plugins/runtime.js";
import type { VersionaryPluginContext } from "../../types/plugins.js";
import { applyConfiguredArtifactRules } from "./artifact-rules.js";
import {
  getBaselineStatePath,
  type ReleaseTargetState,
  writeBaselineSha,
} from "./state.js";

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

function ensureCleanWorktree(
  cwd: string,
  logger?: VersionaryPluginContext["logger"],
): void {
  const dirtyFiles = listTrackedDirtyFiles(cwd);
  const { ignored, blocking } = splitSafeDirtyFiles(dirtyFiles);

  if (blocking.length > 0) {
    throw new Error(
      `Working tree has tracked modifications before versionary pr:\n${blocking.join("\n")}\nCommit/stash tracked changes first.`,
    );
  }

  if (ignored.length > 0) {
    logger?.warn(
      `Ignoring safe tracked changes before versionary pr:\n${ignored.join("\n")}`,
    );
  }
}

export function prepareSimpleReleasePr(
  cwd = process.cwd(),
  options: { logger?: VersionaryPluginContext["logger"] } = {},
): {
  branch: string;
  title: string;
  version: string;
  previousVersion: string;
  commits: ParsedCommit[];
  plan: SimplePlan;
} {
  const plan = createSimplePlan(cwd);
  const loaded = loadConfig(cwd);
  const strategy = resolveVersionStrategy(loaded.config);
  if (!plan.nextVersion) {
    throw new Error(
      "No releasable commits found. Nothing to open a release PR for.",
    );
  }

  ensureCleanWorktree(cwd, options.logger);

  const updatedVersionFiles = strategy.writeVersion(
    cwd,
    loaded.config,
    plan.nextVersion,
  );
  const updatedArtifactFiles = applyConfiguredArtifactRules(
    cwd,
    loaded.config,
    plan,
  );
  const section = renderSimpleChangelog(plan);
  prependChangelog(cwd, plan.changelogFile, section);

  const branch = plan.releaseBranchPrefix;
  const title = `chore(release): v${plan.nextVersion}`;

  execFileSync("git", ["checkout", "-B", branch], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const filesToAdd = [
    ...new Set([
      ...updatedVersionFiles,
      ...updatedArtifactFiles,
      plan.changelogFile,
    ]),
  ];
  execFileSync("git", ["add", ...filesToAdd], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  execFileSync("git", ["commit", "-m", title], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const releaseTargets: ReleaseTargetState[] = plan.packages
    ? plan.packages
        .filter((pkg) => pkg.nextVersion)
        .map((pkg) => ({
          path: pkg.path,
          version: pkg.nextVersion ?? "",
          tag:
            pkg.path === "."
              ? `v${pkg.nextVersion ?? ""}`
              : `${pkg.path.replaceAll("/", "-")}-v${pkg.nextVersion ?? ""}`,
        }))
    : [
        {
          path: ".",
          version: plan.nextVersion,
          tag: `v${plan.nextVersion}`,
        },
      ];
  writeBaselineSha(cwd, undefined, releaseTargets);
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
    previousVersion: plan.currentVersion,
    commits: plan.commits,
    plan,
  };
}

export function renderSimpleReviewRequestBody(
  version: string,
  previousVersion: string,
  commits: ParsedCommit[],
  plan: SimplePlan | null = null,
  cwd = process.cwd(),
): string {
  if (plan?.packages && plan.packages.length > 1) {
    const sections = plan.packages
      .filter((pkg) => pkg.nextVersion)
      .map((pkg) => {
        const notes = renderSimpleReleaseNotes(
          {
            currentVersion: pkg.currentVersion,
            nextVersion: pkg.nextVersion ?? "",
            commits: pkg.commits,
            cwd,
          },
          { includeFooter: false },
        );
        const linkedHeader = notes.match(
          /^##\s+\[([^\]]+)\]\(([^)]+)\)\s+\(([^)]+)\)/u,
        );
        if (linkedHeader) {
          const [, , compareUrl, date] = linkedHeader;
          return notes.replace(
            /^##\s+\[[^\]]+\]\([^)]+\)\s+\([^)]+\)/u,
            `## [${pkg.path}: ${pkg.nextVersion ?? ""}](${compareUrl}) (${date})`,
          );
        }

        const plainHeader = notes.match(/^##\s+([^\s]+)\s+\(([^)]+)\)/u);
        if (plainHeader) {
          const [, , date] = plainHeader;
          return notes.replace(
            /^##\s+[^\s]+\s+\([^)]+\)/u,
            `## ${pkg.path}: ${pkg.nextVersion ?? ""} (${date})`,
          );
        }
        return notes;
      })
      .join("\n\n");
    return `${sections}\n\nThis PR was generated by Versionary.`;
  }

  return renderSimpleReleaseNotes(
    {
      currentVersion: previousVersion,
      nextVersion: version,
      commits,
      cwd,
    },
    { includeFooter: true },
  );
}

export async function openOrUpdateSimpleReviewRequest(
  cwd: string,
  branch: string,
  title: string,
  version: string,
  previousVersion: string,
  commits: ParsedCommit[],
  plan: SimplePlan | null = null,
  options: { logger?: VersionaryPluginContext["logger"] } = {},
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
      body: renderSimpleReviewRequestBody(
        version,
        previousVersion,
        commits,
        plan,
        cwd,
      ),
      labels: ["release"],
    },
    {
      cwd,
      logger: options.logger,
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
