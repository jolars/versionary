import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import { analyzeCommits, getCommitsSinceLastTag, type CommitInfo } from "./git.js";
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
