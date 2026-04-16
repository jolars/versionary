import fs from "node:fs";
import path from "node:path";
import {
  readBaselineSha,
  readReleaseTargets,
} from "../../app/release/state.js";
import { loadConfig } from "../../config/load-config.js";
import {
  analyzeParsedCommits,
  applyRevertSuppression,
  getParsedCommitsForPath,
  getParsedCommitsSinceLastTag,
  type ParsedCommit,
} from "../../infra/git/commits.js";
import { resolvePackageStrategyContext } from "../strategy/package-context.js";
import { resolveVersionStrategy } from "../strategy/resolve.js";
import type {
  StrategyPackagePlanContext,
  VersionStrategy,
} from "../strategy/types.js";
import { bumpVersion, type ReleaseType } from "./semver.js";

export interface SimplePlan {
  mode: "simple";
  releaseType: ReleaseType;
  currentVersion: string;
  nextVersion: string | null;
  versionFile: string;
  changelogFile: string;
  releaseBranchPrefix: string;
  baselineSha: string | null;
  commits: ParsedCommit[];
  packages?: Array<{
    path: string;
    releaseType: ReleaseType;
    currentVersion: string;
    nextVersion: string | null;
    commits: ParsedCommit[];
  }>;
}

function getMode(
  configMode?: "independent" | "fixed",
): "independent" | "fixed" {
  return configMode ?? "independent";
}

export function createSimplePlan(cwd = process.cwd()): SimplePlan {
  const loaded = loadConfig(cwd);
  const strategy = resolveVersionStrategy(loaded.config);
  const versionFile = strategy.getVersionFile(loaded.config);
  const changelogFile = loaded.config["changelog-file"] ?? "CHANGELOG.md";
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
      versionFile,
      changelogFile,
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
      versionFile,
      changelogFile,
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
    versionFile,
    changelogFile,
    releaseBranchPrefix,
    baselineSha,
    commits: adjustedPackages.flatMap((pkgPlan) => pkgPlan.commits),
    packages: adjustedPackages,
  };
}
