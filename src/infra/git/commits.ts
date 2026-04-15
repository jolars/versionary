import { execFileSync } from "node:child_process";
import path from "node:path";
import type { ReleaseType } from "../../domain/release/semver.js";

export interface CommitInfo {
  hash: string;
  subject: string;
}

function getReleaseBranchExcludeArgs(cwd: string): string[] {
  const releaseBranchesRaw = execFileSync(
    "git",
    ["branch", "--list", "--format", "%(refname:short)"],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const releaseBranches = releaseBranchesRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("versionary/release"));

  return releaseBranches.flatMap((branch) => ["--exclude", branch]);
}

function getLatestReleaseTag(cwd: string): string {
  const excludeArgs = getReleaseBranchExcludeArgs(cwd);
  try {
    const cmd = [
      "describe",
      "--tags",
      "--abbrev=0",
      "--match",
      "v[0-9]*",
      ...excludeArgs,
    ];
    return execFileSync("git", cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function isValidCommitish(cwd: string, ref: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function resolveRange(cwd: string, baselineSha?: string | null): string {
  const baseRef = baselineSha ?? "";
  if (!baseRef) {
    const latestTag = getLatestReleaseTag(cwd);
    return latestTag ? `${latestTag}..HEAD` : "HEAD";
  }
  if (isValidCommitish(cwd, baseRef)) {
    return `${baseRef}..HEAD`;
  }

  const latestTag = getLatestReleaseTag(cwd);
  return latestTag ? `${latestTag}..HEAD` : "HEAD";
}

function readGitLog(
  cwd: string,
  range: string,
  pathspecs: string[] = [],
): CommitInfo[] {
  const output = execFileSync(
    "git",
    ["log", range, "--pretty=format:%H%x09%s", "--", ...pathspecs],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );

  if (!output.trim()) {
    return [];
  }

  return output
    .trim()
    .split("\n")
    .map((line) => {
      const [hash, subject] = line.split("\t");
      return { hash, subject };
    });
}

export function getCommitsSinceLastTag(
  cwd = process.cwd(),
  baselineSha?: string | null,
): CommitInfo[] {
  const range = resolveRange(cwd, baselineSha);
  return readGitLog(cwd, range);
}

export function getCommitsForPath(
  cwd = process.cwd(),
  baselineSha?: string | null,
  packagePath = ".",
  excludePaths: string[] = [],
): CommitInfo[] {
  const range = resolveRange(cwd, baselineSha);
  const normalizedPackagePath = packagePath === "." ? "." : packagePath;

  const excludes = excludePaths.map((excludePath) => {
    const combined =
      normalizedPackagePath === "."
        ? excludePath
        : path.posix.join(normalizedPackagePath, excludePath);
    return `:(exclude)${combined}`;
  });

  return readGitLog(cwd, range, [normalizedPackagePath, ...excludes]);
}

export function inferReleaseTypeFromSubject(subject: string): ReleaseType {
  if (/^revert:\s/i.test(subject)) {
    return null;
  }

  if (/^chore(\(.+\))?:\s/i.test(subject)) {
    return null;
  }

  if (/!:/u.test(subject) || /BREAKING CHANGE/u.test(subject)) {
    return "major";
  }

  if (/^feat(\(.+\))?:\s/i.test(subject)) {
    return "minor";
  }

  if (/^(fix|perf)(\(.+\))?:\s/i.test(subject)) {
    return "patch";
  }

  return null;
}

export function isReleasableCommit(subject: string): boolean {
  return inferReleaseTypeFromSubject(subject) !== null;
}

export function analyzeCommits(commits: CommitInfo[]): ReleaseType {
  let result: ReleaseType = null;
  for (const commit of commits) {
    const type = inferReleaseTypeFromSubject(commit.subject);
    if (type === "major") {
      return "major";
    }

    if (type === "minor") {
      result = "minor";
      continue;
    }

    if (type === "patch" && result === null) {
      result = "patch";
    }
  }

  return result;
}
