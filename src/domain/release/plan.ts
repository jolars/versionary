import fs from "node:fs";
import path from "node:path";
import { readBaselineSha } from "../../app/release/state.js";
import { loadConfig } from "../../config/load-config.js";
import {
  analyzeParsedCommits,
  applyRevertSuppression,
  type CommitInfo,
  getParsedCommitsForPath,
  getParsedCommitsSinceLastTag,
} from "../../infra/git/commits.js";
import { resolveVersionStrategy } from "../strategy/resolve.js";
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
  commits: CommitInfo[];
  packages?: Array<{
    path: string;
    releaseType: ReleaseType;
    nextVersion: string | null;
    commits: CommitInfo[];
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
  const versionPath = path.join(cwd, versionFile);
  if (!fs.existsSync(versionPath)) {
    throw new Error(`Versionary requires ${versionFile} to exist.`);
  }

  const currentVersion = strategy.readVersion(cwd, loaded.config);
  const configuredPackages = Object.entries(loaded.config.packages ?? {}).map(
    ([pkgPath, cfg]) => ({
      path: pkgPath,
      ...cfg,
    }),
  );
  const monorepoMode = getMode(loaded.config["monorepo-mode"]);
  const hasPackages = configuredPackages.length > 0;

  if (!hasPackages) {
    const parsedCommits = getParsedCommitsSinceLastTag(cwd, baselineSha);
    const effectiveCommits = applyRevertSuppression(parsedCommits);
    const commits: CommitInfo[] = effectiveCommits.map((commit) => ({
      hash: commit.hash,
      subject: commit.subject,
    }));
    const releaseType = analyzeParsedCommits(parsedCommits);
    const nextVersion = releaseType
      ? bumpVersion(currentVersion, releaseType)
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
      const parsedCommits = getParsedCommitsForPath(
        cwd,
        baselineSha,
        pkg.path,
        pkg["exclude-paths"] ?? [],
      );
      const effectiveCommits = applyRevertSuppression(parsedCommits);
      const commits: CommitInfo[] = effectiveCommits.map((commit) => ({
        hash: commit.hash,
        subject: commit.subject,
      }));
      const releaseType = analyzeParsedCommits(parsedCommits);
      const nextVersion = releaseType
        ? bumpVersion(currentVersion, releaseType)
        : null;
      return {
        path: pkg.path,
        releaseType,
        nextVersion,
        commits,
        parsedCommits,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  if (monorepoMode === "fixed") {
    const fixedType = analyzeParsedCommits(
      packagePlans.flatMap((pkgPlan) => pkgPlan.parsedCommits),
    );
    const fixedNextVersion = fixedType
      ? bumpVersion(currentVersion, fixedType)
      : null;
    const adjusted = packagePlans.map((pkgPlan) => ({
      ...pkgPlan,
      releaseType: fixedType,
      nextVersion: fixedNextVersion,
    }));
    return {
      mode: "simple",
      releaseType: fixedType,
      currentVersion,
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
    packagePlans.flatMap((pkgPlan) => pkgPlan.parsedCommits),
  );
  const overallNextVersion = overallType
    ? bumpVersion(currentVersion, overallType)
    : null;

  return {
    mode: "simple",
    releaseType: overallType,
    currentVersion,
    nextVersion: overallNextVersion,
    versionFile,
    changelogFile,
    releaseBranchPrefix,
    baselineSha,
    commits: packagePlans.flatMap((pkgPlan) => pkgPlan.commits),
    packages: packagePlans,
  };
}
