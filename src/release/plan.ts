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
import { releaseTypeBetween, resolveReleaseAsOverride } from "./release-as.js";
import { bumpVersion, maxReleaseType, type ReleaseType } from "./semver.js";
import { readBaselineSha, readReleaseTargets } from "./state.js";

type BumpReason =
  | "direct"
  | "dependency-propagation"
  | "stale-dependency"
  | "follows"
  | "release-as";

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
    bumpReason?: BumpReason;
    dependencySourcePaths?: string[];
    commits: ParsedCommit[];
  }>;
}

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
  const allowStableMajorForPath = (packagePath: string): boolean =>
    loaded.config.packages?.[packagePath]?.["allow-stable-major"] ??
    allowStableMajor;
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
    bumpReason?: BumpReason;
    dependencySourcePaths?: string[];
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
    const excludePaths = [
      ...new Set([
        ...(loaded.config["exclude-paths"] ?? []),
        ...(pkg.config["exclude-paths"] ?? []),
      ]),
    ];
    const isImplicitRoot = !hasPackages && pkg.path === ".";
    let parsedCommits: ParsedCommit[];
    if (isImplicitRoot && excludePaths.length === 0) {
      parsedCommits = getParsedCommitsSinceLastTag(cwd, baselineSha);
    } else {
      parsedCommits = getParsedCommitsForPath(
        cwd,
        isImplicitRoot
          ? baselineSha
          : (releaseTargetByPath.get(pkg.path)?.tag ?? baselineSha),
        pkg.path,
        excludePaths,
      );
    }
    const effectiveCommits = applyRevertSuppression(parsedCommits);
    const commits = effectiveCommits;
    const analyzedType = analyzeParsedCommits(parsedCommits);
    const override = resolveReleaseAsOverride(commits, packageCurrentVersion);
    let releaseType: ReleaseType;
    let nextVersion: string | null;
    let bumpReason: BumpReason | undefined;
    if (override) {
      // An explicit `Release-As:` footer forces a release with the requested
      // version, even when the conventional-commit analysis produces no bump.
      nextVersion = override.version;
      releaseType = releaseTypeBetween(packageCurrentVersion, override.version);
      bumpReason = "release-as";
    } else {
      releaseType = analyzedType;
      nextVersion = releaseType
        ? bumpVersion(packageCurrentVersion, releaseType, {
            allowStableMajor: allowStableMajorForPath(pkg.path),
          })
        : null;
      bumpReason = nextVersion ? "direct" : undefined;
    }
    return {
      path: pkg.path,
      implicitRoot: pkg.implicitRoot,
      releaseType,
      currentVersion: packageCurrentVersion,
      nextVersion,
      bumpReason,
      commits,
      parsedCommits,
      resolvedVersionFile: packageContext.versionFile,
    };
  };

  const explicitPackagePlans = normalizedPackages
    .filter((pkg) => !pkg.implicitRoot)
    .map((pkg) => buildPackagePlan(pkg));
  const implicitRoot = normalizedPackages.find((pkg) => pkg.implicitRoot);
  const implicitRootPlan: ReturnType<typeof buildPackagePlan> | null =
    implicitRoot
      ? {
          path: ".",
          implicitRoot: true,
          releaseType: null,
          currentVersion: explicitPackagePlans[0]?.currentVersion ?? "0.0.0",
          nextVersion: null,
          bumpReason: undefined,
          dependencySourcePaths: undefined,
          commits: [],
          parsedCommits: [],
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
  // Strategy contexts are shared by reference with their group so that forcing
  // a bump during the fixpoint below is immediately visible to the next
  // `propagateDependentPatchImpacts` query.
  const strategyContextByPath = new Map<string, StrategyPackagePlanContext>();
  const strategyByPath = new Map<string, VersionStrategy>();
  for (const packagePlan of packagePlans) {
    const packageConfig = loaded.config.packages?.[packagePlan.path] ?? {};
    const packageContext = resolvePackageStrategyContext(
      loaded.config,
      packagePlan.path,
      packageConfig,
    );
    const strategyContext: StrategyPackagePlanContext = {
      packagePath: packagePlan.path,
      versionFile: packagePlan.resolvedVersionFile,
      currentVersion: packagePlan.currentVersion,
      nextVersion: packagePlan.nextVersion,
    };
    strategyContextByPath.set(packagePlan.path, strategyContext);
    strategyByPath.set(packagePlan.path, packageContext.strategy);
    const existingGroup = strategyPackagesByName.get(
      packageContext.strategy.name,
    );
    if (existingGroup) {
      existingGroup.packages.push(strategyContext);
    } else {
      strategyPackagesByName.set(packageContext.strategy.name, {
        strategy: packageContext.strategy,
        packages: [strategyContext],
      });
    }
    packageCurrentVersionByPath[packagePlan.path] = packagePlan.currentVersion;
  }

  const workingPlans = packagePlans.map((pkgPlan) => ({ ...pkgPlan }));
  const workingPlanByPath = new Map(
    workingPlans.map((pkgPlan) => [pkgPlan.path, pkgPlan]),
  );

  const forcePatchBump = (
    target: (typeof workingPlans)[number],
    reason: Extract<BumpReason, "dependency-propagation" | "stale-dependency">,
  ): void => {
    const current =
      packageCurrentVersionByPath[target.path] ?? target.currentVersion;
    target.releaseType = "patch";
    target.nextVersion = bumpVersion(current, "patch", {
      allowStableMajor: allowStableMajorForPath(target.path),
    });
    target.bumpReason = reason;
    const strategyContext = strategyContextByPath.get(target.path);
    if (strategyContext) {
      strategyContext.nextVersion = target.nextVersion;
    }
  };

  /**
   * Packages that record a version requirement on `sourcePath`, found by
   * asking the strategy who would need a requirement rewrite if `sourcePath`
   * alone released. Works whether or not `sourcePath` is currently bumping,
   * so it doubles as a reverse-edge lookup for a package that has not entered
   * the plan yet.
   */
  const findDependents = (sourcePath: string): string[] => {
    const strategyContext = strategyContextByPath.get(sourcePath);
    // The implicit root can name a version file that does not exist. Nothing
    // can record a requirement on a package that has no manifest, and asking
    // the strategy would make it read one.
    if (
      !strategyContext ||
      !fs.existsSync(path.join(cwd, strategyContext.versionFile))
    ) {
      return [];
    }
    const strategy = strategyByPath.get(sourcePath);
    const strategyGroup = strategy
      ? strategyPackagesByName.get(strategy.name)
      : undefined;
    if (!strategyGroup?.strategy.propagateDependentPatchImpacts) {
      return [];
    }
    const hypotheticalVersion =
      strategyContext.nextVersion ??
      bumpVersion(
        packageCurrentVersionByPath[sourcePath] ??
          strategyContext.currentVersion,
        "patch",
        { allowStableMajor: allowStableMajorForPath(sourcePath) },
      );
    return strategyGroup.strategy.propagateDependentPatchImpacts(
      cwd,
      strategyGroup.packages.map((pkg) => ({
        ...pkg,
        nextVersion:
          pkg.packagePath === sourcePath ? hypotheticalVersion : null,
      })),
    );
  };

  const isPublishable = (packagePath: string): boolean => {
    const strategy = strategyByPath.get(packagePath);
    const strategyContext = strategyContextByPath.get(packagePath);
    if (!strategy?.isPublishable || !strategyContext) {
      return true;
    }
    // Abstaining counts as publishable: the enforcement below should only be
    // skipped on a positive signal that nothing reaches a registry.
    return strategy.isPublishable(cwd, strategyContext) !== false;
  };

  // Forward dependency edges, inverted from the reverse-edge lookup above.
  // Whether one package records a requirement on another is a property of the
  // manifests, not of the versions in flight, so this is computed once.
  const dependenciesByPath = new Map<string, Set<string>>();
  for (const pkgPlan of workingPlans) {
    for (const dependentPath of findDependents(pkgPlan.path)) {
      const existing = dependenciesByPath.get(dependentPath);
      if (existing) {
        existing.add(pkgPlan.path);
        continue;
      }
      dependenciesByPath.set(dependentPath, new Set([pkgPlan.path]));
    }
  }

  /**
   * Every package reachable by following dependency edges down from a
   * publishable package that is currently releasing. Staleness matters
   * transitively: a release that pulls in a stale grandparent resolves against
   * the stale published copy just as readily as a direct dependency does.
   */
  const collectReleasingDependencyClosure = (): Set<string> => {
    const reachable = new Set<string>();
    const queue = workingPlans
      .filter((pkgPlan) => pkgPlan.nextVersion && isPublishable(pkgPlan.path))
      .map((pkgPlan) => pkgPlan.path);
    while (queue.length > 0) {
      const currentPath = queue.shift();
      if (currentPath === undefined) {
        continue;
      }
      for (const dependencyPath of dependenciesByPath.get(currentPath) ?? []) {
        if (reachable.has(dependencyPath)) {
          continue;
        }
        reachable.add(dependencyPath);
        queue.push(dependencyPath);
      }
    }
    return reachable;
  };

  const withReleasingDependencies = (
    plans: typeof workingPlans,
  ): typeof workingPlans => {
    const releasingPaths = new Set(
      plans
        .filter((pkgPlan) => pkgPlan.nextVersion)
        .map((pkgPlan) => pkgPlan.path),
    );
    for (const pkgPlan of plans) {
      const strategyContext = strategyContextByPath.get(pkgPlan.path);
      if (strategyContext) {
        strategyContext.nextVersion = pkgPlan.nextVersion;
      }
    }
    const dependencySourcePathsByPackage = new Map<string, Set<string>>();
    for (const sourcePackage of plans) {
      if (!sourcePackage.nextVersion) {
        continue;
      }
      for (const impactedPath of findDependents(sourcePackage.path)) {
        if (impactedPath === sourcePackage.path) {
          continue;
        }
        const existing = dependencySourcePathsByPackage.get(impactedPath);
        if (existing) {
          existing.add(sourcePackage.path);
        } else {
          dependencySourcePathsByPackage.set(
            impactedPath,
            new Set([sourcePackage.path]),
          );
        }
      }
    }
    return plans.map((pkgPlan) => {
      const dependencySourcePaths = [
        ...(dependencySourcePathsByPackage.get(pkgPlan.path) ??
          new Set<string>()),
      ]
        .filter((sourcePath) => releasingPaths.has(sourcePath))
        .sort((a, b) => a.localeCompare(b));
      if (dependencySourcePaths.length === 0) {
        return pkgPlan;
      }
      return {
        ...pkgPlan,
        dependencySourcePaths,
      };
    });
  };

  // Both rules below can enable each other: forcing a bump creates a dependent
  // whose requirement must be rewritten, and rewriting a dependent can in turn
  // expose a stale dependency a further level up. Iterating to a fixpoint
  // avoids having to order them, and terminates because a package can only
  // ever move from not-releasing to releasing.
  for (let iteration = 0; iteration <= workingPlans.length; iteration += 1) {
    let changed = false;

    // Rule 1: a package whose recorded requirement on a releasing sibling
    // would change must release too, or the rewritten requirement ships in the
    // release commit without a version to publish it under.
    for (const strategyGroup of strategyPackagesByName.values()) {
      const impacted =
        strategyGroup.strategy.propagateDependentPatchImpacts?.(
          cwd,
          strategyGroup.packages,
        ) ?? [];
      for (const impactedPath of impacted) {
        const target = workingPlanByPath.get(impactedPath);
        if (!target || target.nextVersion) {
          continue;
        }
        forcePatchBump(target, "dependency-propagation");
        changed = true;
      }
    }

    // Rule 2: a package that changed since its own last release but produced
    // no bump would leave a releasing dependent pointing at a stale published
    // copy. Commit type is deliberately not consulted — the exposure comes
    // from the change existing, not from how it was labeled.
    const reachableDependencies = collectReleasingDependencyClosure();
    for (const candidate of workingPlans) {
      if (candidate.nextVersion || candidate.commits.length === 0) {
        continue;
      }
      if (!reachableDependencies.has(candidate.path)) {
        continue;
      }
      if (!isPublishable(candidate.path)) {
        continue;
      }
      forcePatchBump(candidate, "stale-dependency");
      changed = true;
    }

    if (!changed) {
      break;
    }
  }

  // Attribute each dependent's requirement rewrite to the specific sources
  // driving it, using the settled version set so chained bumps are credited.
  const propagatedPackages = withReleasingDependencies(workingPlans);

  const followsByPath = new Map<string, string[]>();
  for (const [packagePath, packageConfig] of Object.entries(
    loaded.config.packages ?? {},
  )) {
    const follows = packageConfig.follows ?? [];
    if (follows.length > 0) {
      followsByPath.set(packagePath, follows);
    }
  }
  const adjustedPackages = propagatedPackages.map((pkgPlan) => {
    if (pkgPlan.bumpReason === "release-as") {
      // An explicit override pins this package's version; do not let a
      // followed source recompute it out from under the requested version.
      return pkgPlan;
    }
    const followsSources = followsByPath.get(pkgPlan.path) ?? [];
    const bumpingSources = followsSources
      .map((sourcePath) =>
        propagatedPackages.find((pkg) => pkg.path === sourcePath),
      )
      .filter((sourcePlan): sourcePlan is (typeof propagatedPackages)[number] =>
        Boolean(sourcePlan?.nextVersion),
      );
    if (bumpingSources.length === 0) {
      return pkgPlan;
    }
    const ownReleaseType = pkgPlan.releaseType;
    const combinedReleaseType = maxReleaseType([
      ownReleaseType,
      ...bumpingSources.map((sourcePlan) => sourcePlan.releaseType),
    ]);
    const mergedDependencySourcePaths = [
      ...new Set([
        ...(pkgPlan.dependencySourcePaths ?? []),
        ...bumpingSources.map((sourcePlan) => sourcePlan.path),
      ]),
    ].sort((a, b) => a.localeCompare(b));
    const sourceDrove =
      combinedReleaseType !== ownReleaseType ||
      pkgPlan.bumpReason === "dependency-propagation" ||
      pkgPlan.bumpReason === "stale-dependency" ||
      pkgPlan.bumpReason === undefined;
    const baseVersion =
      packageCurrentVersionByPath[pkgPlan.path] ?? pkgPlan.currentVersion;
    const nextVersion = combinedReleaseType
      ? bumpVersion(baseVersion, combinedReleaseType, {
          allowStableMajor: allowStableMajorForPath(pkgPlan.path),
        })
      : null;
    return {
      ...pkgPlan,
      releaseType: combinedReleaseType,
      nextVersion,
      bumpReason: sourceDrove ? ("follows" as const) : pkgPlan.bumpReason,
      dependencySourcePaths: mergedDependencySourcePaths,
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

  const rootOverridden = rootPackagePlan.bumpReason === "release-as";

  if (monorepoMode === "fixed") {
    const analyzedFixedType = analyzeParsedCommits(
      adjustedPackages.flatMap((pkgPlan) => pkgPlan.parsedCommits),
    );
    const fixedBaseVersion = rootPackagePlan.currentVersion;
    // A `Release-As:` footer on the shared (root) version pins every package.
    const fixedType = rootOverridden
      ? rootPackagePlan.releaseType
      : analyzedFixedType;
    const fixedNextVersion = rootOverridden
      ? rootPackagePlan.nextVersion
      : analyzedFixedType
        ? bumpVersion(fixedBaseVersion, analyzedFixedType, { allowStableMajor })
        : null;
    // Fixed mode can promote unchanged dependencies into the release, so the
    // final shared version set must drive dependency attribution.
    const adjusted = withReleasingDependencies(
      adjustedPackages.map((pkgPlan) => ({
        ...pkgPlan,
        releaseType: fixedType,
        nextVersion: fixedNextVersion,
      })),
    );
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

  const analyzedOverallType = analyzeParsedCommits(
    adjustedPackages.flatMap((pkgPlan) => pkgPlan.parsedCommits),
  );
  const overallBaseVersion = rootPackagePlan.currentVersion;
  // A root-level `Release-As:` footer drives the aggregate version too, keeping
  // the top-level plan consistent with the pinned root package.
  const overallType = rootOverridden
    ? rootPackagePlan.releaseType
    : analyzedOverallType;
  const overallNextVersion = rootOverridden
    ? rootPackagePlan.nextVersion
    : analyzedOverallType
      ? bumpVersion(overallBaseVersion, analyzedOverallType, {
          allowStableMajor,
        })
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

/**
 * The root package's own release, as distinct from the plan-level aggregate.
 *
 * `plan.releaseType`/`plan.nextVersion`/`plan.commits` describe the repository
 * as a whole: the aggregate release type folds in every package's commits and
 * is then applied to root's version number. That answers "is anything
 * releasing, and how large is the biggest change anywhere" — not "what is root
 * releasing". A sibling's `feat` therefore lifts the aggregate to a minor even
 * when root's own `exclude-paths` drop that commit, so anything that names or
 * describes root's release must go through here instead. Using the aggregate
 * would report a version no version file carries and list commits root
 * deliberately excluded.
 *
 * Falls back to the aggregate when the plan has no explicit root package: the
 * top-level changelog is then a repository-wide summary with no package of its
 * own to describe.
 */
export function resolveRootReleaseView(plan: ReleasePlan): {
  currentVersion: string;
  nextVersion: string | null;
  commits: ParsedCommit[];
} {
  const rootPackage = plan.packages?.find((pkg) => pkg.path === ".");
  if (!rootPackage) {
    return {
      currentVersion: plan.currentVersion,
      nextVersion: plan.nextVersion,
      commits: plan.commits,
    };
  }
  return {
    currentVersion: rootPackage.currentVersion,
    nextVersion: rootPackage.nextVersion,
    commits: rootPackage.commits,
  };
}

export function resolvePackageDependencies(
  plan: ReleasePlan,
  packagePath: string,
): Array<{ name: string; version: string }> {
  const target = plan.packages?.find((pkg) => pkg.path === packagePath);
  if (!target) {
    return [];
  }
  const sources = target.dependencySourcePaths ?? [];
  return sources
    .map((sourcePath) =>
      plan.packages?.find((pkg) => pkg.path === sourcePath && pkg.nextVersion),
    )
    .filter(
      (sourcePackage): sourcePackage is NonNullable<typeof sourcePackage> =>
        Boolean(sourcePackage),
    )
    .map((pkg) => ({
      name: pkg.path === "." ? plan.packageName : pkg.path,
      version: pkg.nextVersion as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
