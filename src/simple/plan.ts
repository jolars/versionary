import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import { analyzeCommits, getCommitsForPath, getCommitsSinceLastTag, type CommitInfo } from "./git.js";
import { bumpVersion, type ReleaseType } from "./semver.js";
import { readBaselineSha } from "./state.js";

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

function getMode(configMode?: "independent" | "fixed"): "independent" | "fixed" {
  return configMode ?? "independent";
}

export function createSimplePlan(cwd = process.cwd()): SimplePlan {
  const loaded = loadConfig(cwd);
  const mode = loaded.config.mode ?? "simple";
  if (mode !== "simple") {
    throw new Error("Simple plan requires mode: simple in config.");
  }

  const versionFile = loaded.config.simple?.versionFile ?? "version.txt";
  const changelogFile = loaded.config.simple?.changelogFile ?? "CHANGELOG.md";
  const releaseBranchPrefix = loaded.config.simple?.releaseBranchPrefix ?? "versionary/release";
  const baselineSha = readBaselineSha(cwd) ?? loaded.config.history?.bootstrap?.sha ?? null;
  const versionPath = path.join(cwd, versionFile);
  if (!fs.existsSync(versionPath)) {
    throw new Error(`Simple mode requires ${versionFile} to exist.`);
  }

  const currentVersion = fs.readFileSync(versionPath, "utf8").trim();
  const configuredPackages = loaded.config.packages ?? [];
  const monorepoMode = getMode(loaded.config.monorepo?.mode);
  const hasPackages = configuredPackages.length > 0;

  if (!hasPackages) {
    const commits = getCommitsSinceLastTag(cwd, baselineSha);
    const releaseType = analyzeCommits(commits);
    const nextVersion = releaseType ? bumpVersion(currentVersion, releaseType) : null;

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
      const commits = getCommitsForPath(cwd, baselineSha, pkg.path, pkg.excludePaths ?? []);
      const releaseType = analyzeCommits(commits);
      const nextVersion = releaseType ? bumpVersion(currentVersion, releaseType) : null;
      return {
        path: pkg.path,
        releaseType,
        nextVersion,
        commits,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  if (monorepoMode === "fixed") {
    const fixedType = analyzeCommits(packagePlans.flatMap((pkgPlan) => pkgPlan.commits));
    const fixedNextVersion = fixedType ? bumpVersion(currentVersion, fixedType) : null;
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

  const overallType = analyzeCommits(packagePlans.flatMap((pkgPlan) => pkgPlan.commits));
  const overallNextVersion = overallType ? bumpVersion(currentVersion, overallType) : null;

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
