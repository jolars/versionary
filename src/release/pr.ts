import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import type { ParsedCommit } from "../git/commits.js";
import { getScmClient } from "../scm/client.js";
import { resolvePackageStrategyContext } from "../strategy/package-context.js";
import { resolveVersionStrategy } from "../strategy/resolve.js";
import type {
  StrategyVersionWriteContext,
  VersionStrategy,
} from "../strategy/types.js";
import type { VersionaryPackage } from "../types/config.js";
import type { VersionaryPluginContext } from "../types/plugins.js";
import { applyConfiguredArtifactRules } from "./artifact-rules.js";
import {
  prependChangelog,
  renderPackageChangelogSection,
  renderSimpleChangelog,
  renderSimpleReleaseNotes,
} from "./changelog.js";
import { createSimplePlan, type SimplePlan } from "./plan.js";
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

function normalizeSlashPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function listCargoLockFiles(cwd: string): string[] {
  const lockfiles: string[] = [];
  const queue: string[] = [cwd];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== "Cargo.lock") {
        continue;
      }
      lockfiles.push(normalizeSlashPath(path.relative(cwd, fullPath)));
    }
  }

  return lockfiles.sort((a, b) => a.localeCompare(b));
}

function ensureCargoLockUpToDate(cwd: string): string[] {
  const lockfiles = listCargoLockFiles(cwd);
  if (lockfiles.length === 0) {
    return [];
  }

  const updatedLockfiles: string[] = [];
  for (const lockfile of lockfiles) {
    const lockfilePath = path.join(cwd, lockfile);
    const before = fs.readFileSync(lockfilePath, "utf8");
    try {
      execFileSync("cargo", ["generate-lockfile"], {
        cwd: path.dirname(lockfilePath),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to refresh ${lockfile} via "cargo generate-lockfile". Ensure cargo is installed and available in PATH. Details: ${message}`,
      );
    }
    const after = fs.readFileSync(lockfilePath, "utf8");
    if (after !== before) {
      updatedLockfiles.push(lockfile);
    }
  }

  return updatedLockfiles;
}

function normalizeReleaseNameForTag(releaseName: string): string {
  return releaseName
    .trim()
    .replace(/^@/u, "")
    .replaceAll("/", "-")
    .replace(/\s+/gu, "-");
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
  if (plan.packages && plan.packages.length > 0) {
    for (const packagePlan of plan.packages) {
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
  } else {
    updatedVersionFiles.push(
      ...strategy.writeVersion(cwd, loaded.config, plan.nextVersion),
    );
    addStrategyWrite(strategy, {
      packagePath: ".",
      versionFile: strategy.getVersionFile(loaded.config),
      version: plan.nextVersion,
    });
  }
  for (const strategyGroup of writesByStrategy.values()) {
    updatedVersionFiles.push(
      ...(strategyGroup.strategy.finalizeVersionWrites?.(
        cwd,
        strategyGroup.writes,
      ) ?? []),
    );
  }
  const updatedArtifactFiles = applyConfiguredArtifactRules(
    cwd,
    loaded.config,
    plan,
  );
  const updatedRustLockFiles = ensureCargoLockUpToDate(cwd);
  const packageReleaseMetadata = buildPackageReleaseMetadata(
    cwd,
    plan,
    loaded.config,
  );
  const section = renderSimpleChangelog(plan);
  prependChangelog(cwd, plan.changelogFile, section);
  const updatedChangelogFiles = [plan.changelogFile];
  for (const packagePlan of plan.packages ?? []) {
    if (!packagePlan.nextVersion || packagePlan.path === ".") {
      continue;
    }
    const packageConfig = loaded.config.packages?.[packagePlan.path] ?? {};
    const packageChangelogFile = packageConfig["changelog-file"];
    if (!packageChangelogFile) {
      continue;
    }
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
    );
    updatedChangelogFiles.push(
      path.posix.join(packagePlan.path, packageChangelogFile),
    );
  }
  const releaseTargets = buildReleaseTargets(cwd, plan, loaded.config);

  const branch = plan.releaseBranchPrefix;
  const title = formatReleaseCommitTitle(releaseTargets);

  execFileSync("git", ["checkout", "-B", branch], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const filesToAdd = [
    ...new Set([
      ...updatedVersionFiles,
      ...updatedArtifactFiles,
      ...updatedRustLockFiles,
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
  const rootPackageLabel = path.basename(cwd);
  const formatPackageLabel = (packagePath: string): string =>
    packagePath === "." ? rootPackageLabel : packagePath;

  if (plan?.packages && plan.packages.length > 1) {
    const sections = plan.packages
      .filter((pkg) => pkg.nextVersion)
      .map((pkg) => {
        const packageLabel = formatPackageLabel(pkg.path);
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
            `## [${packageLabel}: ${pkg.nextVersion ?? ""}](${compareUrl}) (${date})`,
          );
        }

        const plainHeader = notes.match(/^##\s+([^\s]+)\s+\(([^)]+)\)/u);
        if (plainHeader) {
          const [, , date] = plainHeader;
          return notes.replace(
            /^##\s+[^\s]+\s+\([^)]+\)/u,
            `## ${packageLabel}: ${pkg.nextVersion ?? ""} (${date})`,
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
