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
  VersionaryPackage,
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
  defaultChangelogFormat?: VersionaryChangelogFormat;
}): {
  changelogFile: string;
  changelogFormat: VersionaryChangelogFormat;
} {
  const changelogFormat =
    config["changelog-format"] ??
    config.defaultChangelogFormat ??
    "markdown-changelog";
  const changelogFile =
    config["changelog-file"] ??
    (changelogFormat === "r-news" ? "NEWS.md" : "CHANGELOG.md");
  return { changelogFile, changelogFormat };
}

function getNormalizedPackages(
  config: VersionaryConfig,
): Array<{ path: string; config: VersionaryPackage; implicitRoot: boolean }> {
  const configured = Object.entries(config.packages ?? {}).map(
    ([packagePath, packageConfig]) => ({
      path: packagePath,
      config: packageConfig,
      implicitRoot: false,
    }),
  );
  if (configured.length === 0) {
    return [{ path: ".", config: {}, implicitRoot: false }];
  }
  if (configured.some((pkg) => pkg.path === ".")) {
    return configured;
  }
  return [{ path: ".", config: {}, implicitRoot: true }, ...configured];
}

export function createReleasePlan(cwd = process.cwd()): ReleasePlan {
  const loaded = loadConfig(cwd);
  const strategy = resolveVersionStrategy(loaded.config);
  const configuredPackageCount = Object.keys(
    loaded.config.packages ?? {},
  ).length;
  const hasPackages = configuredPackageCount > 0;
  const hasExplicitRootPackage = Boolean(loaded.config.packages?.["."]);
  const normalizedPackages = getNormalizedPackages(loaded.config);
  const versionFile = strategy.getVersionFile(loaded.config);
  const { changelogFile, changelogFormat } = getChangelogDefaults({
    ...loaded.config,
    defaultChangelogFormat: strategy.getDefaultChangelogFormat?.(),
  });
  const packageName = hasPackages
    ? path.basename(cwd)
    : (strategy.readPackageName?.(cwd, loaded.config) ?? path.basename(cwd));
  const releaseBranchPrefix =
    loaded.config["release-branch"] ?? "versionary/release";
  const baselineSha =
    readBaselineSha(cwd) ?? loaded.config["bootstrap-sha"] ?? null;
  const releaseTargetByPath = new Map(
    readReleaseTargets(cwd).map((target) => [target.path, target]),
  );
  const allowStableMajor = loaded.config["allow-stable-major"] ?? false;
  const monorepoMode = getMode(loaded.config["monorepo-mode"]);

  const buildPackagePlan = (pkg: {
    path: string;
    config: VersionaryPackage;
    implicitRoot: boolean;
  }): {
    path: string;
    implicitRoot: boolean;
    releaseType: ReleaseType;
    currentVersion: string;
    nextVersion: string | null;
    bumpReason?: "direct";
    commits: ParsedCommit[];
    parsedCommits: ParsedCommit[];
    resolvedVersionFile: string;
  } => {
    const packageContext = resolvePackageStrategyContext(
      loaded.config,
      pkg.path,
      pkg.config,
    );
    const currentVersionFile = path.join(cwd, packageContext.versionFile);
    if (!fs.existsSync(currentVersionFile)) {
      throw new Error(
        `Versionary requires ${packageContext.versionFile} to exist for package "${pkg.path}".`,
      );
    }
    const packageCurrentVersion = packageContext.strategy.readVersion(
      cwd,
      packageContext.config,
    );
    const parsedCommits =
      !hasPackages && pkg.path === "."
        ? getParsedCommitsSinceLastTag(cwd, baselineSha)
        : getParsedCommitsForPath(
            cwd,
            releaseTargetByPath.get(pkg.path)?.tag ?? baselineSha,
            pkg.path,
            pkg.config["exclude-paths"] ?? [],
          );
    const effectiveCommits = applyRevertSuppression(parsedCommits);
    const commits = effectiveCommits;
    const releaseType = analyzeParsedCommits(parsedCommits);
    const nextVersion = releaseType
      ? bumpVersion(packageCurrentVersion, releaseType, { allowStableMajor })
      : null;
    return {
      path: pkg.path,
      implicitRoot: pkg.implicitRoot,
      releaseType,
      currentVersion: packageCurrentVersion,
      nextVersion,
      bumpReason: nextVersion ? ("direct" as const) : undefined,
      commits,
      parsedCommits,
      resolvedVersionFile: packageContext.versionFile,
    };
  };

  const explicitPackagePlans = normalizedPackages
    .filter((pkg) => !pkg.implicitRoot)
    .map((pkg) => buildPackagePlan(pkg));
  const implicitRoot = normalizedPackages.find((pkg) => pkg.implicitRoot);
  const implicitRootPlan = implicitRoot
    ? {
        path: ".",
        implicitRoot: true,
        releaseType: null as ReleaseType,
        currentVersion: explicitPackagePlans[0]?.currentVersion ?? "0.0.0",
        nextVersion: null,
        commits: [] as ParsedCommit[],
        parsedCommits: [] as ParsedCommit[],
        resolvedVersionFile: versionFile,
      }
    : null;
  const packagePlans = [
    ...explicitPackagePlans,
    ...(implicitRootPlan ? [implicitRootPlan] : []),
  ].sort((a, b) => a.path.localeCompare(b.path));

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
        versionFile: packagePlan.resolvedVersionFile,
        currentVersion: packagePlan.currentVersion,
        nextVersion: packagePlan.nextVersion,
      });
    } else {
      strategyPackagesByName.set(packageContext.strategy.name, {
        strategy: packageContext.strategy,
        packages: [
          {
            packagePath: packagePlan.path,
            versionFile: packagePlan.resolvedVersionFile,
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
  const visiblePackages = adjustedPackages.filter(
    (pkgPlan) => !pkgPlan.implicitRoot || hasExplicitRootPackage,
  );

  const rootPackagePlan = adjustedPackages.find(
    (pkgPlan) => pkgPlan.path === ".",
  );
  if (!rootPackagePlan) {
    throw new Error(
      'Internal error: normalized package list must always include root path ".".',
    );
  }

  if (!hasPackages) {
    return {
      mode: "simple",
      releaseType: rootPackagePlan.releaseType,
      currentVersion: rootPackagePlan.currentVersion,
      nextVersion: rootPackagePlan.nextVersion,
      packageName,
      versionFile,
      changelogFile,
      changelogFormat,
      releaseBranchPrefix,
      baselineSha,
      commits: rootPackagePlan.commits,
    };
  }

  if (monorepoMode === "fixed") {
    const fixedType = analyzeParsedCommits(
      adjustedPackages.flatMap((pkgPlan) => pkgPlan.parsedCommits),
    );
    const fixedBaseVersion = rootPackagePlan.currentVersion;
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
      packages: adjusted
        .filter((pkgPlan) => !pkgPlan.implicitRoot || hasExplicitRootPackage)
        .map(({ implicitRoot: _implicitRoot, ...pkgPlan }) => pkgPlan),
    };
  }

  const overallType = analyzeParsedCommits(
    adjustedPackages.flatMap((pkgPlan) => pkgPlan.parsedCommits),
  );
  const overallBaseVersion = rootPackagePlan.currentVersion;
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
    packages: visiblePackages.map(
      ({ implicitRoot: _implicitRoot, ...pkgPlan }) => pkgPlan,
    ),
  };
}

/** @deprecated Use createReleasePlan. */
export function createSimplePlan(cwd = process.cwd()): ReleasePlan {
  return createReleasePlan(cwd);
}
