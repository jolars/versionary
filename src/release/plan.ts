import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import {
  analyzeParsedCommits,
  applyRevertSuppression,
  getParsedCommitsForPath,
  getParsedCommitsSinceLastTag,
  type ParsedCommit,
} from "../git/commits.js";
import { resolvePackageStrategyContext } from "../strategy/package-context.js";
import { resolveVersionStrategy } from "../strategy/resolve.js";
import type {
  StrategyPackagePlanContext,
  VersionStrategy,
} from "../strategy/types.js";
import type {
  VersionaryChangelogFormat,
  VersionaryConfig,
} from "../types/config.js";
import { bumpVersion, type ReleaseType } from "./semver.js";
import { readBaselineSha, readReleaseTargets } from "./state.js";

export interface ReleasePlan {
  mode: "simple";
  releaseType: ReleaseType;
  currentVersion: string;
  nextVersion: string | null;
  packageName: string;
  versionFile: string;
  changelogFile: string;
  changelogFormat: VersionaryChangelogFormat;
  releaseBranchPrefix: string;
  baselineSha: string | null;
  commits: ParsedCommit[];
  packages?: Array<{
    path: string;
    releaseType: ReleaseType;
    currentVersion: string;
    nextVersion: string | null;
    bumpReason?: "direct" | "dependency-propagation";
    commits: ParsedCommit[];
  }>;
}

/** @deprecated Use ReleasePlan. */
export type SimplePlan = ReleasePlan;

function getMode(
  configMode?: "independent" | "fixed",
): "independent" | "fixed" {
  return configMode ?? "independent";
}

export function getChangelogDefaults(config: {
  "release-type"?: VersionaryConfig["release-type"];
  "changelog-file"?: VersionaryConfig["changelog-file"];
  "changelog-format"?: VersionaryConfig["changelog-format"];
}): {
  changelogFile: string;
  changelogFormat: VersionaryChangelogFormat;
} {
  const changelogFormat =
    config["changelog-format"] ??
    (config["release-type"] === "r" ? "r-news" : "markdown-changelog");
  const changelogFile =
    config["changelog-file"] ??
    (changelogFormat === "r-news" ? "NEWS.md" : "CHANGELOG.md");
  return { changelogFile, changelogFormat };
}

export function createReleasePlan(cwd = process.cwd()): ReleasePlan {
  const loaded = loadConfig(cwd);
  const strategy = resolveVersionStrategy(loaded.config);
  const versionFile = strategy.getVersionFile(loaded.config);
  const { changelogFile, changelogFormat } = getChangelogDefaults(
    loaded.config,
  );
  const packageName =
    loaded.config["release-type"] === "r"
      ? (strategy.readPackageName?.(cwd, loaded.config) ?? path.basename(cwd))
      : path.basename(cwd);
  const releaseBranchPrefix =
    loaded.config["release-branch"] ?? "versionary/release";
  const baselineSha =
    readBaselineSha(cwd) ?? loaded.config["bootstrap-sha"] ?? null;
  const releaseTargetByPath = new Map(
    readReleaseTargets(cwd).map((target) => [target.path, target]),
  );
  const allowStableMajor = loaded.config["allow-stable-major"] ?? false;
  const configuredPackages = Object.entries(loaded.config.packages ?? {}).map(
    ([pkgPath, cfg]) => ({
      path: pkgPath,
      ...cfg,
    }),
  );
  const monorepoMode = getMode(loaded.config["monorepo-mode"]);
  const hasPackages = configuredPackages.length > 0;

  if (!hasPackages) {
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    const currentVersion = strategy.readVersion(cwd, loaded.config);
    const parsedCommits = getParsedCommitsSinceLastTag(cwd, baselineSha);
    const effectiveCommits = applyRevertSuppression(parsedCommits);
    const commits = effectiveCommits;
    const releaseType = analyzeParsedCommits(parsedCommits);
    const nextVersion = releaseType
      ? bumpVersion(currentVersion, releaseType, { allowStableMajor })
      : null;

    return {
      mode: "simple",
      releaseType,
      currentVersion,
      nextVersion,
      packageName,
      versionFile,
      changelogFile,
      changelogFormat,
      releaseBranchPrefix,
      baselineSha,
      commits,
    };
  }

  const packagePlans = configuredPackages
    .map((pkg) => {
      const packageContext = resolvePackageStrategyContext(
        loaded.config,
        pkg.path,
        pkg,
      );
      const packageCurrentVersion = packageContext.strategy.readVersion(
        cwd,
        packageContext.config,
      );
      const parsedCommits = getParsedCommitsForPath(
        cwd,
        releaseTargetByPath.get(pkg.path)?.tag ?? baselineSha,
        pkg.path,
        pkg["exclude-paths"] ?? [],
      );
      const effectiveCommits = applyRevertSuppression(parsedCommits);
      const commits = effectiveCommits;
      const releaseType = analyzeParsedCommits(parsedCommits);
      const nextVersion = releaseType
        ? bumpVersion(packageCurrentVersion, releaseType, { allowStableMajor })
        : null;
      return {
        path: pkg.path,
        releaseType,
        currentVersion: packageCurrentVersion,
        nextVersion,
        bumpReason: nextVersion ? ("direct" as const) : undefined,
        commits,
        parsedCommits,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const packageCurrentVersionByPath: Record<string, string> = {};
  const strategyPackagesByName = new Map<
    string,
    { strategy: VersionStrategy; packages: StrategyPackagePlanContext[] }
  >();
  for (const packagePlan of packagePlans) {
    const packageConfig = loaded.config.packages?.[packagePlan.path] ?? {};
    const packageContext = resolvePackageStrategyContext(
      loaded.config,
      packagePlan.path,
      packageConfig,
    );
    const existingGroup = strategyPackagesByName.get(
      packageContext.strategy.name,
    );
    if (existingGroup) {
      existingGroup.packages.push({
        packagePath: packagePlan.path,
        versionFile: packageContext.versionFile,
        currentVersion: packagePlan.currentVersion,
        nextVersion: packagePlan.nextVersion,
      });
    } else {
      strategyPackagesByName.set(packageContext.strategy.name, {
        strategy: packageContext.strategy,
        packages: [
          {
            packagePath: packagePlan.path,
            versionFile: packageContext.versionFile,
            currentVersion: packagePlan.currentVersion,
            nextVersion: packagePlan.nextVersion,
          },
        ],
      });
    }
    packageCurrentVersionByPath[packagePlan.path] = packagePlan.currentVersion;
  }
  const impactedPaths = new Set<string>();
  for (const strategyGroup of strategyPackagesByName.values()) {
    const impacted = strategyGroup.strategy.propagateDependentPatchImpacts?.(
      cwd,
      strategyGroup.packages,
    );
    for (const pkgPath of impacted ?? []) {
      impactedPaths.add(pkgPath);
    }
  }
  const adjustedPackages = packagePlans.map((pkgPlan) => {
    if (pkgPlan.nextVersion || !impactedPaths.has(pkgPlan.path)) {
      return pkgPlan;
    }
    const current =
      packageCurrentVersionByPath[pkgPlan.path] ?? pkgPlan.currentVersion;
    return {
      ...pkgPlan,
      releaseType: "patch" as ReleaseType,
      nextVersion: bumpVersion(current, "patch", { allowStableMajor }),
      bumpReason: "dependency-propagation" as const,
    };
  });

  if (monorepoMode === "fixed") {
    const fixedType = analyzeParsedCommits(
      adjustedPackages.flatMap((pkgPlan) => pkgPlan.parsedCommits),
    );
    const fixedBaseVersion =
      adjustedPackages.find((pkgPlan) => pkgPlan.path === ".")
        ?.currentVersion ??
      adjustedPackages[0]?.currentVersion ??
      "0.0.0";
    const fixedNextVersion = fixedType
      ? bumpVersion(fixedBaseVersion, fixedType, { allowStableMajor })
      : null;
    const adjusted = adjustedPackages.map((pkgPlan) => ({
      ...pkgPlan,
      releaseType: fixedType,
      nextVersion: fixedNextVersion,
    }));
    return {
      mode: "simple",
      releaseType: fixedType,
      currentVersion: fixedBaseVersion,
      nextVersion: fixedNextVersion,
      packageName,
      versionFile,
      changelogFile,
      changelogFormat,
      releaseBranchPrefix,
      baselineSha,
      commits: adjusted.flatMap((pkgPlan) => pkgPlan.commits),
      packages: adjusted,
    };
  }

  const overallType = analyzeParsedCommits(
    adjustedPackages.flatMap((pkgPlan) => pkgPlan.parsedCommits),
  );
  const overallBaseVersion =
    adjustedPackages.find((pkgPlan) => pkgPlan.path === ".")?.currentVersion ??
    adjustedPackages[0]?.currentVersion ??
    "0.0.0";
  const overallNextVersion = overallType
    ? bumpVersion(overallBaseVersion, overallType, { allowStableMajor })
    : null;

  return {
    mode: "simple",
    releaseType: overallType,
    currentVersion: overallBaseVersion,
    nextVersion: overallNextVersion,
    packageName,
    versionFile,
    changelogFile,
    changelogFormat,
    releaseBranchPrefix,
    baselineSha,
    commits: adjustedPackages.flatMap((pkgPlan) => pkgPlan.commits),
    packages: adjustedPackages,
  };
}

/** @deprecated Use createReleasePlan. */
export function createSimplePlan(cwd = process.cwd()): ReleasePlan {
  return createReleasePlan(cwd);
}
