import { execFileSync } from "node:child_process";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import type { ParsedCommit } from "../git/commits.js";
import { getScmClient } from "../scm/client.js";
import { resolvePackageStrategyContext } from "../strategy/package-context.js";
import type {
  StrategyFinalizeContext,
  StrategyVersionWriteContext,
  VersionStrategy,
} from "../strategy/types.js";
import type { VersionaryPackage } from "../types/config.js";
import type { VersionaryPluginContext } from "../types/plugins.js";
import { applyConfiguredArtifactRules } from "./artifact-rules.js";
import {
  prependChangelog,
  renderPackageChangelogSection,
  renderReleasePlanChangelog,
  renderReviewRequestFooter,
  renderSimpleReleaseNotes,
} from "./changelog.js";
import {
  createReleasePlan,
  getChangelogDefaults,
  type ReleasePlan,
  type SimplePlan,
} from "./plan.js";
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
const VERSIONARY_RELEASE_TRAILER = "Versionary-Release: true";

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

function resolveReleaseName(
  cwd: string,
  packagePath: string,
  packageConfig: VersionaryPackage,
  strategy: VersionStrategy,
  strategyConfig: ReturnType<typeof loadConfig>["config"],
): string {
  const configuredName = packageConfig["package-name"]?.trim();
  if (configuredName) {
    return configuredName;
  }

  return strategy.readPackageName?.(cwd, strategyConfig) ?? packagePath;
}

function buildReleaseTargets(
  cwd: string,
  plan: SimplePlan,
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
  plan: SimplePlan,
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
  const section = renderReleasePlanChangelog(plan);
  prependChangelog(cwd, plan.changelogFile, section, plan.changelogFormat);
  const updatedChangelogFiles = [plan.changelogFile];
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
    const { changelogFile: packageChangelogFile } = getChangelogDefaults({
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
    const packageSection = renderPackageChangelogSection({
      currentVersion: packagePlan.currentVersion,
      nextVersion: packagePlan.nextVersion,
      commits: packagePlan.commits,
      tagPrefix: packageMetadata.tagPrefix,
      cwd,
    });
    prependChangelog(
      cwd,
      path.posix.join(packagePlan.path, packageChangelogFile),
      packageSection,
      "markdown-changelog",
    );
    updatedChangelogFiles.push(
      path.posix.join(packagePlan.path, packageChangelogFile),
    );
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
  execFileSync(
    "git",
    ["commit", "-m", title, "-m", VERSIONARY_RELEASE_TRAILER],
    {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  writeBaselineSha(cwd, releaseBaselineSha, releaseTargets);
  execFileSync("git", ["add", getBaselineStatePath(cwd)], {
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
  };
}

export function renderSimpleReviewRequestBody(
  version: string,
  previousVersion: string,
  commits: ParsedCommit[],
  plan: SimplePlan | null = null,
  cwd = process.cwd(),
): string {
  const rootPackageLabel = path.basename(cwd);
  const formatPackageLabel = (packagePath: string): string =>
    packagePath === "." ? rootPackageLabel : packagePath;
  const isDirectBump = (
    pkg: NonNullable<SimplePlan["packages"]>[number],
  ): boolean =>
    pkg.bumpReason === "direct" ||
    (pkg.bumpReason === undefined &&
      Boolean(pkg.nextVersion) &&
      pkg.commits.length > 0);
  const findPropagatedDependencies = (
    packagePath: string,
    packages: NonNullable<SimplePlan["packages"]>,
  ): Array<{ name: string; version: string }> => {
    const target = packages.find((pkg) => pkg.path === packagePath);
    if (!target || target.bumpReason !== "dependency-propagation") {
      return [];
    }
    const directSources = packages
      .filter((pkg) => isDirectBump(pkg))
      .map((pkg) => ({
        name: formatPackageLabel(pkg.path),
        version: pkg.nextVersion ?? "",
      }))
      .filter((dependency) => dependency.version.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    return directSources;
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
      });
      sections.push(rootNotes);
    }
    const packageSections = plan.packages
      .filter((pkg) => pkg.path !== "." && pkg.nextVersion)
      .map((pkg) => {
        const packageLabel = formatPackageLabel(pkg.path);
        const propagatedDependencies = findPropagatedDependencies(
          pkg.path,
          plan.packages ?? [],
        );
        const notes = renderSimpleReleaseNotes(
          {
            currentVersion: pkg.currentVersion,
            nextVersion: pkg.nextVersion ?? "",
            commits: pkg.commits,
            cwd,
            dependencies: propagatedDependencies,
          },
          {
            includeFooter: false,
            headerLabel: `${packageLabel}: ${pkg.nextVersion ?? ""}`,
          },
        );
        return notes;
      });
    sections.push(...packageSections);
    const bodySections = sections.join("\n\n");
    if (bodySections.length === 0) {
      return renderReviewRequestFooter();
    }
    return `${bodySections}\n\n${renderReviewRequestFooter()}`;
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

export async function openOrUpdateReviewRequest(
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

/** @deprecated Use prepareReleasePr. */
export function prepareSimpleReleasePr(
  cwd = process.cwd(),
  options: { logger?: VersionaryPluginContext["logger"] } = {},
): ReturnType<typeof prepareReleasePr> {
  return prepareReleasePr(cwd, options);
}

/** @deprecated Use openOrUpdateReviewRequest. */
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
  return openOrUpdateReviewRequest(
    cwd,
    branch,
    title,
    version,
    previousVersion,
    commits,
    plan,
    options,
  );
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
