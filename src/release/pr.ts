import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import type { ParsedCommit } from "../git/commits.js";
import { ensureGitIdentity } from "../git/identity.js";
import { getScmClient } from "../scm/client.js";
import {
  resolvePackageStrategyContext,
  resolveReleaseName,
} from "../strategy/package-context.js";
import type {
  StrategyFinalizeContext,
  StrategyVersionWriteContext,
  VersionStrategy,
} from "../strategy/types.js";
import type {
  VersionaryChangelogFormat,
  VersionaryConfig,
} from "../types/config.js";
import type { VersionaryPluginContext } from "../types/plugins.js";
import { applyConfiguredArtifactRules } from "./artifact-rules.js";
import {
  extractUnreleasedNotes,
  prependChangelog,
  renderReleaseNotesSection,
  renderReleasePlanChangelog,
  renderReviewRequestFooter,
  renderRNewsReleaseNotes,
} from "./changelog.js";
import {
  buildInitialReleaseCohorts,
  resolveSeparateReleaseBranch,
  resolveSeparateReleaseBranchPrefix,
  stabilizeReleaseCohorts,
} from "./cohorts.js";
import {
  createReleasePlan,
  getChangelogDefaults,
  type ReleasePlan,
  resolvePackageDependencies,
} from "./plan.js";
import {
  hasFullyUntaggedPendingRelease,
  type ReleaseTargetState,
  readPendingReleaseCohorts,
  readPendingReleaseTargets,
  writeBaselineSha,
  writePackageReleaseState,
} from "./state.js";

const SAFE_DIRTY_FILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
]);
const VERSIONARY_RELEASE_TRAILER = "Versionary-Release: true";

/**
 * Read the manual-notes ("Unreleased") prose from the top of a changelog file.
 * Returns an empty string when the file is absent or has no notes block.
 */
export function readChangelogHighlights(
  cwd: string,
  changelogFile: string,
  format: VersionaryChangelogFormat,
): string {
  const changelogPath = path.join(cwd, changelogFile);
  if (!fs.existsSync(changelogPath)) {
    return "";
  }
  const existing = fs.readFileSync(changelogPath, "utf8");
  return extractUnreleasedNotes(existing, format).highlights;
}

export interface ResolvedReleaseHighlights {
  highlights: string;
  source: "changelog" | "none";
}

/**
 * Resolve release highlights from the editable "Unreleased" section at the top
 * of the changelog.
 */
export function resolveReleaseHighlights(
  cwd: string,
  changelogFile: string,
  format: VersionaryChangelogFormat,
): ResolvedReleaseHighlights {
  const fromChangelog = readChangelogHighlights(cwd, changelogFile, format);
  if (fromChangelog.length > 0) {
    return { highlights: fromChangelog, source: "changelog" };
  }

  return { highlights: "", source: "none" };
}

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

function normalizeReleaseNameForTag(releaseName: string): string {
  return releaseName
    .trim()
    .replace(/^@/u, "")
    .replaceAll("/", "-")
    .replace(/\s+/gu, "-");
}

function getCommitTreeSha(cwd: string, revision: string): string {
  return execFileSync("git", ["rev-parse", `${revision}^{tree}`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function resolveCommitDate(cwd: string, revision: string): string {
  return execFileSync("git", ["show", "-s", "--format=%cs", revision], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function hasOriginRemote(cwd: string): boolean {
  const remotes = execFileSync("git", ["remote"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .split("\n")
    .map((remote) => remote.trim())
    .filter((remote) => remote.length > 0);
  return remotes.includes("origin");
}

function remoteReleaseBranchExists(cwd: string, branch: string): boolean {
  if (!hasOriginRemote(cwd)) {
    return false;
  }
  const output = execFileSync(
    "git",
    ["ls-remote", "--heads", "origin", branch],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  ).trim();
  return output.length > 0;
}

function fetchRemoteReleaseBranch(cwd: string, branch: string): string {
  const remoteRef = `refs/remotes/origin/${branch}`;
  execFileSync(
    "git",
    ["fetch", "--no-tags", "origin", `refs/heads/${branch}:${remoteRef}`],
    {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return remoteRef;
}

function buildReleaseTargets(
  cwd: string,
  plan: ReleasePlan,
  loadedConfig: ReturnType<typeof loadConfig>["config"],
): ReleaseTargetState[] {
  const releaseTargets: ReleaseTargetState[] = plan.packages
    ? plan.packages
        .filter((pkg) => pkg.nextVersion)
        .map((pkg) => {
          if (pkg.path === ".") {
            return {
              path: pkg.path,
              version: pkg.nextVersion ?? "",
              tag: `v${pkg.nextVersion ?? ""}`,
            };
          }
          const packageConfig = loadedConfig.packages?.[pkg.path] ?? {};
          const packageContext = resolvePackageStrategyContext(
            loadedConfig,
            pkg.path,
            packageConfig,
          );
          const releaseName = resolveReleaseName(
            cwd,
            pkg.path,
            packageConfig,
            packageContext.strategy,
            packageContext.config,
          );
          const tagPrefix = normalizeReleaseNameForTag(releaseName);
          return {
            path: pkg.path,
            version: pkg.nextVersion ?? "",
            tag: `${tagPrefix}-v${pkg.nextVersion ?? ""}`,
          };
        })
    : [
        {
          path: ".",
          version: plan.nextVersion ?? "",
          tag: `v${plan.nextVersion ?? ""}`,
        },
      ];

  const seenTags = new Map<string, string>();
  for (const target of releaseTargets) {
    const existingPath = seenTags.get(target.tag);
    if (existingPath) {
      throw new Error(
        `Duplicate release tag "${target.tag}" for packages "${existingPath}" and "${target.path}". Configure unique "package-name" values.`,
      );
    }
    seenTags.set(target.tag, target.path);
  }
  return releaseTargets;
}

interface PackageReleaseMetadata {
  releaseName: string;
  tagPrefix: string;
}

function buildPackageReleaseMetadata(
  cwd: string,
  plan: ReleasePlan,
  loadedConfig: ReturnType<typeof loadConfig>["config"],
): Record<string, PackageReleaseMetadata> {
  const metadataByPath: Record<string, PackageReleaseMetadata> = {};
  for (const pkg of plan.packages ?? []) {
    if (!pkg.nextVersion || pkg.path === ".") {
      continue;
    }
    const packageConfig = loadedConfig.packages?.[pkg.path] ?? {};
    const packageContext = resolvePackageStrategyContext(
      loadedConfig,
      pkg.path,
      packageConfig,
    );
    const releaseName = resolveReleaseName(
      cwd,
      pkg.path,
      packageConfig,
      packageContext.strategy,
      packageContext.config,
    );
    metadataByPath[pkg.path] = {
      releaseName,
      tagPrefix: normalizeReleaseNameForTag(releaseName),
    };
  }
  return metadataByPath;
}

function formatReleaseCommitTitle(
  releaseTargets: ReleaseTargetState[],
): string {
  if (releaseTargets.length === 0) {
    return "chore(release): v0.0.0";
  }
  const tags = releaseTargets.map((target) => target.tag);
  if (tags.length === 1) {
    return `chore(release): ${tags[0]}`;
  }
  return `chore(release): ${tags[0]} (+${tags.length - 1} more)`;
}

export interface PendingReleasePrResult {
  branch: string;
  title: string;
  updated: boolean;
  targets: ReleaseTargetState[];
  body: string;
}

function getCommitSubject(cwd: string, revision: string): string {
  return execFileSync("git", ["show", "-s", "--format=%s", revision], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function getFirstParent(cwd: string, revision: string): string {
  return execFileSync("git", ["rev-parse", `${revision}^`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function renderPendingReleaseReviewRequestBody(
  targets: ReleaseTargetState[],
): string {
  const releases = targets
    .map((target) => `- \`${target.tag}\` (${target.path})`)
    .join("\n");
  return `## Pending release recovery\n\nThis PR retries a release that did not reach the publish stage. Its empty release commit records the corrected CI-tested commit as the release target; it does not advance any versions.\n\n${releases}\n\n${renderReviewRequestFooter()}`;
}

/**
 * Recreate the release marker on the corrected base without advancing an
 * untagged version. The empty commit is intentional: the version and
 * changelog changes were already reviewed in the original release PR.
 */
export function preparePendingReleasePr(
  cwd = process.cwd(),
  options: { logger?: VersionaryPluginContext["logger"] } = {},
): PendingReleasePrResult {
  const targets = readPendingReleaseTargets(cwd);
  if (!hasFullyUntaggedPendingRelease(cwd)) {
    throw new Error("No unpublished pending release found to recover.");
  }

  ensureCleanWorktree(cwd, options.logger);
  const loaded = loadConfig(cwd);
  const branch = loaded.config["release-branch"] ?? "versionary/release";
  const title = formatReleaseCommitTitle(targets);
  const releaseBaselineSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const hasRemoteReleaseBranch = remoteReleaseBranchExists(cwd, branch);
  const remoteReleaseRef = hasRemoteReleaseBranch
    ? fetchRemoteReleaseBranch(cwd, branch)
    : null;

  execFileSync("git", ["checkout", "-B", branch], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  ensureGitIdentity(cwd);
  execFileSync(
    "git",
    ["commit", "--allow-empty", "-m", title, "-m", VERSIONARY_RELEASE_TRAILER],
    { cwd, stdio: ["ignore", "pipe", "ignore"] },
  );

  const updated =
    !remoteReleaseRef ||
    getFirstParent(cwd, remoteReleaseRef) !== releaseBaselineSha ||
    getCommitSubject(cwd, remoteReleaseRef) !== title;

  return {
    branch,
    title,
    updated,
    targets,
    body: renderPendingReleaseReviewRequestBody(targets),
  };
}

/**
 * Recreate each unpublished package cohort on its own corrected-base branch.
 * A temporary worktree keeps the caller on the trunk commit that triggered
 * recovery while still leaving local branch refs available for pushing.
 */
export function preparePendingSeparateReleasePrs(
  cwd = process.cwd(),
  options: {
    logger?: VersionaryPluginContext["logger"];
    "dry-run"?: boolean;
  } = {},
): SeparateReviewCandidate[] {
  const loaded = loadConfig(cwd);
  if (!loaded.config["separate-release-prs"]) {
    throw new Error(
      'preparePendingSeparateReleasePrs requires "separate-release-prs" to be enabled.',
    );
  }
  const cohorts = readPendingReleaseCohorts(cwd);
  if (cohorts.length === 0) {
    throw new Error("No unpublished pending release found to recover.");
  }
  const candidates = cohorts.map((cohort) => {
    const title = formatReleaseCommitTitle(cohort.targets);
    return {
      branch: cohort.branch,
      title,
      updated: true,
      packagePaths: cohort.targets.map((target) => target.path),
      targets: cohort.targets,
      body: renderPendingReleaseReviewRequestBody(cohort.targets),
    };
  });
  if (options["dry-run"]) {
    return candidates;
  }

  ensureCleanWorktree(cwd, options.logger);
  const baselineSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-recovery-worktree-"),
  );
  const worktree = path.join(temporaryRoot, "worktree");
  execFileSync("git", ["worktree", "add", "--detach", worktree, baselineSha], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });

  try {
    for (const candidate of candidates) {
      resetTemporaryWorktree(worktree, baselineSha);
      const remoteRef = remoteReleaseBranchExists(cwd, candidate.branch)
        ? fetchRemoteReleaseBranch(cwd, candidate.branch)
        : null;
      execFileSync("git", ["checkout", "-B", candidate.branch, baselineSha], {
        cwd: worktree,
        stdio: ["ignore", "pipe", "ignore"],
      });
      ensureGitIdentity(worktree);
      execFileSync(
        "git",
        [
          "commit",
          "--allow-empty",
          "-m",
          candidate.title,
          "-m",
          VERSIONARY_RELEASE_TRAILER,
        ],
        { cwd: worktree, stdio: ["ignore", "pipe", "ignore"] },
      );
      candidate.updated =
        !remoteRef ||
        getFirstParent(worktree, remoteRef) !== baselineSha ||
        getCommitSubject(worktree, remoteRef) !== candidate.title;
      resetTemporaryWorktree(worktree, baselineSha);
    }
    return candidates;
  } finally {
    // Cleanup is best effort: a throwing `worktree remove` must neither replace
    // the error we may be unwinding with nor skip the prune that drops the
    // stale administrative entry.
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktree], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // Ignored; the prune below still clears the registration.
    }
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // Ignored.
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function prepareReleasePr(
  cwd = process.cwd(),
  options: { logger?: VersionaryPluginContext["logger"] } = {},
): {
  branch: string;
  title: string;
  version: string;
  previousVersion: string;
  commits: ParsedCommit[];
  plan: ReleasePlan;
  updated: boolean;
  highlights: string;
} {
  const plan = createReleasePlan(cwd);
  const loaded = loadConfig(cwd);
  if (!plan.nextVersion) {
    throw new Error(
      "No releasable commits found. Nothing to open a release PR for.",
    );
  }

  ensureCleanWorktree(cwd, options.logger);
  const releaseBaselineSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const finalizeContext: StrategyFinalizeContext = {
    releaseCommitSha: releaseBaselineSha,
    releaseDate: resolveCommitDate(cwd, releaseBaselineSha),
  };

  const updatedVersionFiles: string[] = [];
  const writesByStrategy = new Map<
    string,
    {
      strategy: VersionStrategy;
      writes: StrategyVersionWriteContext[];
    }
  >();
  const addStrategyWrite = (
    strategy: VersionStrategy,
    write: StrategyVersionWriteContext,
  ): void => {
    const existing = writesByStrategy.get(strategy.name);
    if (existing) {
      existing.writes.push(write);
      return;
    }
    writesByStrategy.set(strategy.name, {
      strategy,
      writes: [write],
    });
  };
  const versionTargets =
    plan.packages && plan.packages.length > 0
      ? plan.packages
      : [
          {
            path: ".",
            releaseType: plan.releaseType,
            currentVersion: plan.currentVersion,
            nextVersion: plan.nextVersion,
            commits: plan.commits,
          },
        ];
  for (const packagePlan of versionTargets) {
    if (!packagePlan.nextVersion) {
      continue;
    }
    const packageConfig = loaded.config.packages?.[packagePlan.path] ?? {};
    const packageContext = resolvePackageStrategyContext(
      loaded.config,
      packagePlan.path,
      packageConfig,
    );
    const packageUpdated = packageContext.strategy.writeVersion(
      cwd,
      packageContext.config,
      packagePlan.nextVersion,
    );
    updatedVersionFiles.push(...packageUpdated);
    addStrategyWrite(packageContext.strategy, {
      packagePath: packagePlan.path,
      versionFile: packageContext.versionFile,
      version: packagePlan.nextVersion,
    });
  }
  for (const strategyGroup of writesByStrategy.values()) {
    updatedVersionFiles.push(
      ...(strategyGroup.strategy.finalizeVersionWrites?.(
        cwd,
        strategyGroup.writes,
        finalizeContext,
      ) ?? []),
    );
  }
  const updatedArtifactFiles = applyConfiguredArtifactRules(
    cwd,
    loaded.config,
    plan,
  );
  const packageReleaseMetadata = buildPackageReleaseMetadata(
    cwd,
    plan,
    loaded.config,
  );
  const highlightsResult = resolveReleaseHighlights(
    cwd,
    plan.changelogFile,
    plan.changelogFormat,
  );
  const highlights = highlightsResult.highlights;
  const section = renderReleasePlanChangelog(plan, { highlights, cwd });
  const updatedChangelogFiles: string[] = [];
  // An empty section means root itself is not releasing, only siblings are.
  // Writing then would leave a bare heading behind and, worse, strip the
  // manual-notes block that nothing has folded in yet.
  if (section.length > 0) {
    prependChangelog(cwd, plan.changelogFile, section, plan.changelogFormat);
    updatedChangelogFiles.push(plan.changelogFile);
  }
  for (const packagePlan of plan.packages ?? []) {
    if (!packagePlan.nextVersion || packagePlan.path === ".") {
      continue;
    }
    const packageConfig = loaded.config.packages?.[packagePlan.path] ?? {};
    const packageContext = resolvePackageStrategyContext(
      loaded.config,
      packagePlan.path,
      packageConfig,
    );
    const {
      changelogFile: packageChangelogFile,
      changelogFormat: packageChangelogFormat,
    } = getChangelogDefaults({
      "release-type":
        packageConfig["release-type"] ?? loaded.config["release-type"],
      "changelog-file":
        packageConfig["changelog-file"] ?? loaded.config["changelog-file"],
      "changelog-format":
        packageConfig["changelog-format"] ?? loaded.config["changelog-format"],
      defaultChangelogFormat:
        packageContext.strategy.getDefaultChangelogFormat?.(),
    });
    const packageMetadata = packageReleaseMetadata[packagePlan.path];
    if (!packageMetadata) {
      continue;
    }
    const packageChangelogPath = path.posix.join(
      packagePlan.path,
      packageChangelogFile,
    );
    const packageHighlights = readChangelogHighlights(
      cwd,
      packageChangelogPath,
      packageChangelogFormat,
    );
    const packageSection =
      packageChangelogFormat === "r-news"
        ? renderRNewsReleaseNotes({
            packageName: packageMetadata.releaseName,
            nextVersion: packagePlan.nextVersion,
            commits: packagePlan.commits,
            cwd,
            highlights: packageHighlights,
          })
        : renderReleaseNotesSection({
            currentVersion: packagePlan.currentVersion,
            nextVersion: packagePlan.nextVersion,
            commits: packagePlan.commits,
            tagPrefix: packageMetadata.tagPrefix,
            cwd,
            dependencies: resolvePackageDependencies(plan, packagePlan.path),
            highlights: packageHighlights,
          });
    prependChangelog(
      cwd,
      packageChangelogPath,
      packageSection,
      packageChangelogFormat,
    );
    updatedChangelogFiles.push(packageChangelogPath);
  }
  const releaseTargets = buildReleaseTargets(cwd, plan, loaded.config);

  const branch = plan.releaseBranchPrefix;
  const title = formatReleaseCommitTitle(releaseTargets);
  const hasRemoteReleaseBranch = remoteReleaseBranchExists(cwd, branch);
  const remoteReleaseRef = hasRemoteReleaseBranch
    ? fetchRemoteReleaseBranch(cwd, branch)
    : null;

  execFileSync("git", ["checkout", "-B", branch], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const filesToAdd = [
    ...new Set([
      ...updatedVersionFiles,
      ...updatedArtifactFiles,
      ...updatedChangelogFiles,
    ]),
  ];
  execFileSync("git", ["add", ...filesToAdd], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  ensureGitIdentity(cwd);
  execFileSync(
    "git",
    ["commit", "-m", title, "-m", VERSIONARY_RELEASE_TRAILER],
    {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const updatedStateFiles = writeBaselineSha(
    cwd,
    releaseBaselineSha,
    releaseTargets,
  );
  execFileSync("git", ["add", ...updatedStateFiles], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  execFileSync("git", ["commit", "--amend", "--no-edit"], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const updated =
    !remoteReleaseRef ||
    getCommitTreeSha(cwd, "HEAD") !== getCommitTreeSha(cwd, remoteReleaseRef);

  return {
    branch,
    title,
    version: plan.nextVersion,
    previousVersion: plan.currentVersion,
    commits: plan.commits,
    plan,
    updated,
    highlights,
  };
}

export interface PreparedSeparateReleasePr {
  branch: string;
  title: string;
  version: string;
  previousVersion: string;
  commits: ParsedCommit[];
  plan: ReleasePlan;
  updated: boolean;
  highlights: string;
  packagePaths: string[];
  targets: ReleaseTargetState[];
  body: string;
}

export interface SeparateReviewCandidate {
  branch: string;
  title: string;
  updated: boolean;
  packagePaths: string[];
  targets: ReleaseTargetState[];
  body: string;
}

interface MaterializedCandidate {
  files: string[];
  highlights: string;
  targets: ReleaseTargetState[];
}

function scopeReleasePlan(
  plan: ReleasePlan,
  packagePaths: readonly string[],
): ReleasePlan {
  const selected = new Set(packagePaths);
  const packages = (plan.packages ?? []).map((pkg) =>
    selected.has(pkg.path)
      ? pkg
      : {
          ...pkg,
          releaseType: null,
          nextVersion: null,
          bumpReason: undefined,
          dependencySourcePaths: undefined,
        },
  );
  const releasing = packages.filter((pkg) => pkg.nextVersion);
  const first = releasing[0];
  return {
    ...plan,
    releaseType: first?.releaseType ?? null,
    currentVersion: first?.currentVersion ?? plan.currentVersion,
    nextVersion: first?.nextVersion ?? null,
    commits: releasing.flatMap((pkg) => pkg.commits),
    packages,
  };
}

function materializeCandidateChanges(
  cwd: string,
  plan: ReleasePlan,
  options: {
    baselineSha: string;
    branch?: string;
    writePackageState?: boolean;
  },
): MaterializedCandidate {
  const loaded = loadConfig(cwd);
  const finalizeContext: StrategyFinalizeContext = {
    releaseCommitSha: options.baselineSha,
    releaseDate: resolveCommitDate(cwd, options.baselineSha),
  };
  const updatedVersionFiles: string[] = [];
  const writesByStrategy = new Map<
    string,
    {
      strategy: VersionStrategy;
      writes: StrategyVersionWriteContext[];
    }
  >();
  for (const packagePlan of plan.packages ?? []) {
    if (!packagePlan.nextVersion) {
      continue;
    }
    const packageConfig = loaded.config.packages?.[packagePlan.path] ?? {};
    const packageContext = resolvePackageStrategyContext(
      loaded.config,
      packagePlan.path,
      packageConfig,
    );
    updatedVersionFiles.push(
      ...packageContext.strategy.writeVersion(
        cwd,
        packageContext.config,
        packagePlan.nextVersion,
      ),
    );
    const existing = writesByStrategy.get(packageContext.strategy.name);
    const write: StrategyVersionWriteContext = {
      packagePath: packagePlan.path,
      versionFile: packageContext.versionFile,
      version: packagePlan.nextVersion,
    };
    if (existing) {
      existing.writes.push(write);
    } else {
      writesByStrategy.set(packageContext.strategy.name, {
        strategy: packageContext.strategy,
        writes: [write],
      });
    }
  }
  for (const strategyGroup of writesByStrategy.values()) {
    updatedVersionFiles.push(
      ...(strategyGroup.strategy.finalizeVersionWrites?.(
        cwd,
        strategyGroup.writes,
        finalizeContext,
      ) ?? []),
    );
  }

  const updatedArtifactFiles = applyConfiguredArtifactRules(
    cwd,
    loaded.config,
    plan,
  );
  const packageReleaseMetadata = buildPackageReleaseMetadata(
    cwd,
    plan,
    loaded.config,
  );
  const rootIsReleasing = Boolean(
    plan.packages?.find((pkg) => pkg.path === ".")?.nextVersion,
  );
  const highlights = rootIsReleasing
    ? resolveReleaseHighlights(cwd, plan.changelogFile, plan.changelogFormat)
        .highlights
    : "";
  const updatedChangelogFiles: string[] = [];
  const rootSection = rootIsReleasing
    ? renderReleasePlanChangelog(plan, { highlights, cwd })
    : "";
  if (rootSection.length > 0) {
    prependChangelog(
      cwd,
      plan.changelogFile,
      rootSection,
      plan.changelogFormat,
    );
    updatedChangelogFiles.push(plan.changelogFile);
  }
  for (const packagePlan of plan.packages ?? []) {
    if (!packagePlan.nextVersion || packagePlan.path === ".") {
      continue;
    }
    const packageConfig = loaded.config.packages?.[packagePlan.path] ?? {};
    const packageContext = resolvePackageStrategyContext(
      loaded.config,
      packagePlan.path,
      packageConfig,
    );
    const {
      changelogFile: packageChangelogFile,
      changelogFormat: packageChangelogFormat,
    } = getChangelogDefaults({
      "release-type":
        packageConfig["release-type"] ?? loaded.config["release-type"],
      "changelog-file":
        packageConfig["changelog-file"] ?? loaded.config["changelog-file"],
      "changelog-format":
        packageConfig["changelog-format"] ?? loaded.config["changelog-format"],
      defaultChangelogFormat:
        packageContext.strategy.getDefaultChangelogFormat?.(),
    });
    const metadata = packageReleaseMetadata[packagePlan.path];
    if (!metadata) {
      continue;
    }
    const packageChangelogPath = path.posix.join(
      packagePlan.path,
      packageChangelogFile,
    );
    const packageHighlights = readChangelogHighlights(
      cwd,
      packageChangelogPath,
      packageChangelogFormat,
    );
    const section =
      packageChangelogFormat === "r-news"
        ? renderRNewsReleaseNotes({
            packageName: metadata.releaseName,
            nextVersion: packagePlan.nextVersion,
            commits: packagePlan.commits,
            cwd,
            highlights: packageHighlights,
          })
        : renderReleaseNotesSection({
            currentVersion: packagePlan.currentVersion,
            nextVersion: packagePlan.nextVersion,
            commits: packagePlan.commits,
            tagPrefix: metadata.tagPrefix,
            cwd,
            dependencies: resolvePackageDependencies(plan, packagePlan.path),
            highlights: packageHighlights,
          });
    prependChangelog(
      cwd,
      packageChangelogPath,
      section,
      packageChangelogFormat,
    );
    updatedChangelogFiles.push(packageChangelogPath);
  }

  const targets = buildReleaseTargets(cwd, plan, loaded.config);
  const stateFiles =
    options.writePackageState && options.branch
      ? writePackageReleaseState(
          cwd,
          options.baselineSha,
          targets,
          options.branch,
        )
      : [];
  return {
    files: [
      ...new Set([
        ...updatedVersionFiles,
        ...updatedArtifactFiles,
        ...updatedChangelogFiles,
        ...stateFiles,
      ]),
    ].sort((a, b) => a.localeCompare(b)),
    highlights,
    targets,
  };
}

function packageReleaseName(
  cwd: string,
  plan: ReleasePlan,
  packagePath: string,
  config: VersionaryConfig,
): string {
  if (packagePath === ".") {
    return plan.packageName;
  }
  const packageConfig = config.packages?.[packagePath] ?? {};
  const packageContext = resolvePackageStrategyContext(
    config,
    packagePath,
    packageConfig,
  );
  return resolveReleaseName(
    cwd,
    packagePath,
    packageConfig,
    packageContext.strategy,
    packageContext.config,
  );
}

function resetTemporaryWorktree(cwd: string, baselineSha: string): void {
  execFileSync("git", ["checkout", "--detach", baselineSha], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  execFileSync("git", ["reset", "--hard", baselineSha], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  execFileSync("git", ["clean", "-fdx"], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/**
 * Build every independently mergeable release branch from the same immutable
 * base without moving or modifying the caller's worktree.
 */
export function prepareSeparateReleasePrs(
  cwd = process.cwd(),
  options: {
    logger?: VersionaryPluginContext["logger"];
    "dry-run"?: boolean;
  } = {},
): PreparedSeparateReleasePr[] {
  const plan = createReleasePlan(cwd);
  const loaded = loadConfig(cwd);
  if (!loaded.config["separate-release-prs"]) {
    throw new Error(
      'prepareSeparateReleasePrs requires "separate-release-prs" to be enabled.',
    );
  }
  const initialCohorts = buildInitialReleaseCohorts(plan);
  if (initialCohorts.length === 0) {
    return [];
  }
  buildReleaseTargets(cwd, plan, loaded.config);
  ensureCleanWorktree(cwd, options.logger);
  const baselineSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-release-worktree-"),
  );
  const worktree = path.join(temporaryRoot, "worktree");
  execFileSync("git", ["worktree", "add", "--detach", worktree, baselineSha], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });

  try {
    const cohorts = stabilizeReleaseCohorts(initialCohorts, (packagePaths) => {
      resetTemporaryWorktree(worktree, baselineSha);
      return materializeCandidateChanges(
        worktree,
        scopeReleasePlan(plan, packagePaths),
        { baselineSha },
      ).files;
    });
    const prepared: PreparedSeparateReleasePr[] = [];
    for (const packagePaths of cohorts) {
      resetTemporaryWorktree(worktree, baselineSha);
      const leader = packagePaths[0];
      if (!leader) {
        continue;
      }
      const branch = resolveSeparateReleaseBranch(
        plan.releaseBranchPrefix,
        packageReleaseName(worktree, plan, leader, loaded.config),
        leader,
      );
      const remoteRef =
        !options["dry-run"] && remoteReleaseBranchExists(cwd, branch)
          ? fetchRemoteReleaseBranch(cwd, branch)
          : null;
      if (!options["dry-run"]) {
        execFileSync("git", ["checkout", "-B", branch, baselineSha], {
          cwd: worktree,
          stdio: ["ignore", "pipe", "ignore"],
        });
      }
      const scopedPlan = scopeReleasePlan(plan, packagePaths);
      const materialized = materializeCandidateChanges(worktree, scopedPlan, {
        baselineSha,
        branch,
        writePackageState: true,
      });
      const title = formatReleaseCommitTitle(materialized.targets);
      if (!options["dry-run"]) {
        execFileSync("git", ["add", ...materialized.files], {
          cwd: worktree,
          stdio: ["ignore", "pipe", "ignore"],
        });
        ensureGitIdentity(worktree);
        execFileSync(
          "git",
          ["commit", "-m", title, "-m", VERSIONARY_RELEASE_TRAILER],
          {
            cwd: worktree,
            stdio: ["ignore", "pipe", "ignore"],
          },
        );
      }
      const updated =
        options["dry-run"] ||
        !remoteRef ||
        getCommitTreeSha(worktree, "HEAD") !==
          getCommitTreeSha(worktree, remoteRef);
      const firstPackage = scopedPlan.packages?.find((pkg) => pkg.nextVersion);
      const commits = [
        ...new Map(
          (scopedPlan.packages ?? [])
            .filter((pkg) => pkg.nextVersion)
            .flatMap((pkg) => pkg.commits)
            .map((commit) => [commit.hash, commit]),
        ).values(),
      ];
      const version = materialized.targets[0]?.version ?? "";
      const body = renderSimpleReviewRequestBody(
        version,
        firstPackage?.currentVersion ?? version,
        commits,
        scopedPlan,
        worktree,
        materialized.highlights,
        loaded.config,
      );
      prepared.push({
        branch,
        title,
        version,
        previousVersion: firstPackage?.currentVersion ?? version,
        commits,
        plan: scopedPlan,
        updated,
        highlights: materialized.highlights,
        packagePaths,
        targets: materialized.targets,
        body,
      });
      resetTemporaryWorktree(worktree, baselineSha);
    }
    return prepared;
  } finally {
    // Cleanup is best effort: a throwing `worktree remove` must neither replace
    // the error we may be unwinding with nor skip the prune that drops the
    // stale administrative entry.
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktree], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // Ignored; the prune below still clears the registration.
    }
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // Ignored.
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function renderSimpleReviewRequestBody(
  version: string,
  previousVersion: string,
  commits: ParsedCommit[],
  plan: ReleasePlan | null = null,
  cwd = process.cwd(),
  highlights = "",
  loadedConfig?: VersionaryConfig,
): string {
  // `cwd` can be a temporary worktree, whose basename would leak into the PR
  // body; the plan carries the repository-derived name.
  const rootPackageLabel = plan?.packageName ?? path.basename(cwd);
  const formatPackageLabel = (packagePath: string): string =>
    packagePath === "." ? rootPackageLabel : packagePath;
  const resolveTagPrefix = (packagePath: string): string | undefined => {
    if (packagePath === ".") {
      return undefined;
    }
    if (!loadedConfig) {
      return normalizeReleaseNameForTag(packagePath);
    }
    const packageConfig = loadedConfig.packages?.[packagePath] ?? {};
    const packageContext = resolvePackageStrategyContext(
      loadedConfig,
      packagePath,
      packageConfig,
    );
    const releaseName = resolveReleaseName(
      cwd,
      packagePath,
      packageConfig,
      packageContext.strategy,
      packageContext.config,
    );
    return normalizeReleaseNameForTag(releaseName);
  };
  if (plan?.packages && plan.packages.length > 1) {
    const sections: string[] = [];
    const rootPackage = plan.packages.find(
      (pkg) => pkg.path === "." && pkg.nextVersion,
    );
    if (rootPackage?.nextVersion) {
      const rootNotes = renderReleasePlanChangelog(plan, {
        headerLabel: `${formatPackageLabel(".")}: ${rootPackage.nextVersion}`,
        cwd,
        highlights,
      });
      sections.push(rootNotes);
    }
    const packageSections = plan.packages
      .filter((pkg) => pkg.path !== "." && pkg.nextVersion)
      .map((pkg) =>
        renderReleaseNotesSection({
          currentVersion: pkg.currentVersion,
          nextVersion: pkg.nextVersion ?? "",
          commits: pkg.commits,
          cwd,
          dependencies: resolvePackageDependencies(plan, pkg.path),
          tagPrefix: resolveTagPrefix(pkg.path),
          headerLabel: `${formatPackageLabel(pkg.path)}: ${pkg.nextVersion ?? ""}`,
        }),
      );
    sections.push(...packageSections);
    const bodySections = sections.join("\n\n");
    if (bodySections.length === 0) {
      return renderReviewRequestFooter();
    }
    return `${bodySections}\n\n${renderReviewRequestFooter()}`;
  }

  // Honor the plan's changelog format (e.g. r-news) so manual notes, which are
  // authored/extracted relative to that format's heading depth, render at the
  // right level. Falling through to renderReleaseNotesSection would always use
  // the markdown-changelog convention and leave r-news highlights one level too
  // high relative to the auto-generated sections.
  if (plan && plan.changelogFormat === "r-news") {
    const notes = renderReleasePlanChangelog(plan, { cwd, highlights });
    return `${notes}\n\n${renderReviewRequestFooter()}`;
  }

  return renderReleaseNotesSection(
    {
      currentVersion: previousVersion,
      nextVersion: version,
      commits,
      cwd,
      highlights,
    },
    { includeFooter: true },
  );
}

export async function openOrUpdateReviewRequest(
  cwd: string,
  branch: string,
  title: string,
  version: string,
  previousVersion: string,
  commits: ParsedCommit[],
  plan: ReleasePlan | null = null,
  options: {
    logger?: VersionaryPluginContext["logger"];
    highlights?: string;
    body?: string;
  } = {},
): Promise<string> {
  const loaded = loadConfig(cwd);
  const releaseFlow = loaded.config["review-mode"] ?? "pr";
  if (releaseFlow === "direct") {
    return "Release flow mode is direct; skipping review request creation.";
  }

  const scmClient = getScmClient();
  const result = await scmClient.createOrUpdateReviewRequest(
    {
      baseBranch: process.env.VERSIONARY_BASE_BRANCH ?? "main",
      headBranch: branch,
      title,
      body:
        options.body ??
        renderSimpleReviewRequestBody(
          version,
          previousVersion,
          commits,
          plan,
          cwd,
          options.highlights ?? "",
          loaded.config,
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

export interface ReviewRequestRunResult {
  packagePaths: string[];
  branch: string;
  title: string;
  reviewUrl?: string;
  status: "prepared" | "up-to-date" | "dry-run" | "recovered";
  targets: ReleaseTargetState[];
}

export async function reconcileSeparateReviewRequests(
  cwd: string,
  prepared: SeparateReviewCandidate[],
  options: {
    logger?: VersionaryPluginContext["logger"];
    "dry-run"?: boolean;
    recovered?: boolean;
  } = {},
): Promise<ReviewRequestRunResult[]> {
  if (options["dry-run"]) {
    return prepared.map((candidate) => ({
      packagePaths: candidate.packagePaths,
      branch: candidate.branch,
      title: candidate.title,
      status: "dry-run",
      targets: candidate.targets,
    }));
  }

  const loaded = loadConfig(cwd);
  const baseBranch = process.env.VERSIONARY_BASE_BRANCH ?? "main";
  const branchPrefix = resolveSeparateReleaseBranchPrefix(
    loaded.config["release-branch"] ?? "versionary/release",
  );
  const scmClient = getScmClient();
  const existing = await scmClient.listOpenReviewRequests(
    {
      baseBranch,
      headBranchPrefix: branchPrefix,
      labels: ["release"],
    },
    { cwd, logger: options.logger },
  );
  const activeBranches = new Set(prepared.map((candidate) => candidate.branch));
  const results: ReviewRequestRunResult[] = [];
  for (const candidate of prepared) {
    const existingRequest = existing.find(
      (request) => request.headBranch === candidate.branch,
    );
    let reviewUrl = existingRequest?.url;
    if (candidate.updated) {
      pushReleaseBranch(cwd, candidate.branch);
    }
    if (candidate.updated || !existingRequest) {
      const result = await scmClient.createOrUpdateReviewRequest(
        {
          baseBranch,
          headBranch: candidate.branch,
          title: candidate.title,
          body: candidate.body,
          labels: ["release"],
        },
        { cwd, logger: options.logger },
      );
      reviewUrl = result.url;
    }
    results.push({
      packagePaths: candidate.packagePaths,
      branch: candidate.branch,
      title: candidate.title,
      reviewUrl,
      status:
        candidate.updated || !existingRequest
          ? options.recovered
            ? "recovered"
            : "prepared"
          : "up-to-date",
      targets: candidate.targets,
    });
  }

  if (!options.recovered) {
    for (const stale of existing) {
      if (activeBranches.has(stale.headBranch)) {
        continue;
      }
      await scmClient.closeReviewRequestIfExists(
        {
          baseBranch,
          headBranch: stale.headBranch,
          reason:
            "Closing stale release PR because its package cohort is no longer releasable for the current baseline/tag state.",
        },
        { cwd, logger: options.logger },
      );
    }
  }
  return results.sort((a, b) => a.branch.localeCompare(b.branch));
}

function hasScmRuntimeContext(): boolean {
  const hasRepository = Boolean(process.env.GITHUB_REPOSITORY);
  const hasToken = Boolean(
    process.env.VERSIONARY_PR_TOKEN ??
      process.env.GH_TOKEN ??
      process.env.GITHUB_TOKEN,
  );
  return hasRepository && hasToken;
}

export async function closeStaleReviewRequestIfExists(
  cwd = process.cwd(),
  options: { logger?: VersionaryPluginContext["logger"] } = {},
): Promise<{ closed: boolean; url?: string; number?: number }> {
  if (!hasScmRuntimeContext()) {
    return { closed: false };
  }
  const loaded = loadConfig(cwd);
  const scmClient = getScmClient();
  const baseBranch = process.env.VERSIONARY_BASE_BRANCH ?? "main";
  const releaseBranch = loaded.config["release-branch"] ?? "versionary/release";
  if (loaded.config["separate-release-prs"]) {
    const branchPrefix = resolveSeparateReleaseBranchPrefix(releaseBranch);
    const openRequests = await scmClient.listOpenReviewRequests(
      {
        baseBranch,
        headBranchPrefix: branchPrefix,
        labels: ["release"],
      },
      { cwd, logger: options.logger },
    );
    let firstClosed: { closed: boolean; url?: string; number?: number } = {
      closed: false,
    };
    for (const request of openRequests) {
      const result = await scmClient.closeReviewRequestIfExists(
        {
          baseBranch,
          headBranch: request.headBranch,
          reason:
            "Closing stale release PR because no releasable commits remain for the current baseline/tag state.",
        },
        { cwd, logger: options.logger },
      );
      if (result.closed && !firstClosed.closed) {
        firstClosed = result;
      }
      if (result.closed && result.number) {
        options.logger?.info(
          `Closed stale release review request #${result.number} for ${request.headBranch}.`,
        );
      }
    }
    return firstClosed;
  }

  const result = await scmClient.closeReviewRequestIfExists(
    {
      baseBranch,
      headBranch: releaseBranch,
      reason:
        "Closing stale release PR because no releasable commits remain for the current baseline/tag state.",
    },
    {
      cwd,
      logger: options.logger,
    },
  );
  if (result.closed && result.number) {
    options.logger?.info(
      `Closed stale release review request #${result.number} for ${releaseBranch}.`,
    );
  }
  return result;
}

export function pushReleaseBranch(cwd: string, branch: string): void {
  execFileSync("git", ["push", "--force-with-lease", "origin", branch], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function isReleaseCommitMessage(commitMessage: string): boolean {
  if (/^Versionary-Release:\s*true$/imu.test(commitMessage)) {
    return true;
  }
  const subject = commitMessage.split("\n")[0]?.trim() ?? "";
  return /^chore\(release\):\s+(?:(?:v\d+\.\d+\.\d+|\S+-v\d+\.\d+\.\d+)(?:,\s+(?:v\d+\.\d+\.\d+|\S+-v\d+\.\d+\.\d+))*|(?:v\d+\.\d+\.\d+|\S+-v\d+\.\d+\.\d+)\s+\(\+\d+\s+more\))(?:\s+\(#\d+\))?$/u.test(
    subject,
  );
}
