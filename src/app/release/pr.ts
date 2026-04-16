import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
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
import { resolvePackageStrategyContext } from "../../domain/strategy/package-context.js";
import { resolveVersionStrategy } from "../../domain/strategy/resolve.js";
import {
  applyRustWorkspaceDependencyUpdates,
  rustVersionStrategy,
} from "../../domain/strategy/rust.js";
import type { ParsedCommit } from "../../infra/git/commits.js";
import { findPluginsByCapability } from "../../plugins/capabilities.js";
import { loadRuntimePlugins } from "../../plugins/runtime.js";
import type { VersionaryPackage } from "../../types/config.js";
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

function normalizeReleaseNameForTag(releaseName: string): string {
  return releaseName
    .trim()
    .replace(/^@/u, "")
    .replaceAll("/", "-")
    .replace(/\s+/gu, "-");
}

function readNodePackageName(versionPath: string): string | null {
  const raw = JSON.parse(fs.readFileSync(versionPath, "utf8")) as {
    name?: unknown;
  };
  const name = raw.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return null;
  }
  return name.trim();
}

function readRustPackageName(versionPath: string): string | null {
  const parsed = TOML.parse(fs.readFileSync(versionPath, "utf8")) as {
    package?: { name?: unknown };
  };
  const name = parsed.package?.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return null;
  }
  return name.trim();
}

function readRPackageName(versionPath: string): string | null {
  const content = fs.readFileSync(versionPath, "utf8");
  const match = content.match(/^Package:\s*(.+)\s*$/mu);
  if (!match?.[1]) {
    return null;
  }
  const name = match[1].trim();
  return name.length > 0 ? name : null;
}

function resolveReleaseName(
  cwd: string,
  packagePath: string,
  packageConfig: VersionaryPackage,
  strategyName: string,
  versionFile: string,
): string {
  const configuredName = packageConfig["package-name"]?.trim();
  if (configuredName) {
    return configuredName;
  }

  const versionPath = path.join(cwd, versionFile);
  if (strategyName === "node") {
    return readNodePackageName(versionPath) ?? packagePath;
  }
  if (strategyName === "rust") {
    return readRustPackageName(versionPath) ?? packagePath;
  }
  if (strategyName === "r") {
    return readRPackageName(versionPath) ?? packagePath;
  }
  return packagePath;
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
            packageContext.strategy.name,
            packageContext.versionFile,
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

function formatReleaseCommitTitle(
  releaseTargets: ReleaseTargetState[],
): string {
  if (releaseTargets.length === 0) {
    return "chore(release): v0.0.0";
  }
  const tags = releaseTargets.map((target) => target.tag);
  return `chore(release): ${tags.join(", ")}`;
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
  const rustManifestVersionTargets: Record<string, string> = {};
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
      if (packageContext.strategy.name === rustVersionStrategy.name) {
        rustManifestVersionTargets[packageContext.versionFile] =
          packagePlan.nextVersion;
      }
    }
    updatedVersionFiles.push(
      ...applyRustWorkspaceDependencyUpdates(cwd, rustManifestVersionTargets),
    );
  } else {
    updatedVersionFiles.push(
      ...strategy.writeVersion(cwd, loaded.config, plan.nextVersion),
    );
  }
  const updatedArtifactFiles = applyConfiguredArtifactRules(
    cwd,
    loaded.config,
    plan,
  );
  const section = renderSimpleChangelog(plan);
  prependChangelog(cwd, plan.changelogFile, section);
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
  return /^chore\(release\):\s+(?:v\d+\.\d+\.\d+|\S+-v\d+\.\d+\.\d+)(?:,\s+(?:v\d+\.\d+\.\d+|\S+-v\d+\.\d+\.\d+))*$/u.test(
    subject,
  );
}
