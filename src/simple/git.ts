import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ReleaseType } from "./semver.js";

export interface CommitInfo {
  hash: string;
  subject: string;
}

function getReleaseBranchExcludeArgs(cwd: string): string[] {
  const releaseBranchesRaw = execFileSync("git", ["branch", "--list", "--format", "%(refname:short)"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const releaseBranches = releaseBranchesRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("versionary/release"));

  return releaseBranches.flatMap((branch) => ["--exclude", branch]);
}

function resolveBaseRef(cwd: string, baselineSha?: string | null): string {
  const excludeArgs = getReleaseBranchExcludeArgs(cwd);
  let baseRef = baselineSha ?? "";
  if (!baseRef) {
    try {
      const cmd = ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", ...excludeArgs];
      baseRef = execFileSync("git", cmd, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      baseRef = "";
    }
  }

  return baseRef;
}

function readGitLog(cwd: string, range: string, pathspecs: string[] = []): CommitInfo[] {
  const output = execFileSync("git", ["log", range, "--pretty=format:%H%x09%s", "--", ...pathspecs], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

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

export function getCommitsSinceLastTag(cwd = process.cwd(), baselineSha?: string | null): CommitInfo[] {
  const baseRef = resolveBaseRef(cwd, baselineSha);
  const range = baseRef ? `${baseRef}..HEAD` : "HEAD";
  return readGitLog(cwd, range);
}

export function getCommitsForPath(
  cwd = process.cwd(),
  baselineSha?: string | null,
  packagePath = ".",
  excludePaths: string[] = [],
): CommitInfo[] {
  const baseRef = resolveBaseRef(cwd, baselineSha);
  const range = baseRef ? `${baseRef}..HEAD` : "HEAD";
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
