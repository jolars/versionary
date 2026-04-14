import { execFileSync } from "node:child_process";
import type { ReleaseType } from "./semver.js";

export interface CommitInfo {
  hash: string;
  subject: string;
}

export function getCommitsSinceLastTag(cwd = process.cwd()): CommitInfo[] {
  let baseRef = "";
  try {
    baseRef = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    baseRef = "";
  }

  const range = baseRef ? `${baseRef}..HEAD` : "HEAD";
  const output = execFileSync("git", ["log", range, "--pretty=format:%H%x09%s"], {
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

function inferReleaseTypeFromSubject(subject: string): ReleaseType {
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

  if (/^(fix|perf|refactor)(\(.+\))?:\s/i.test(subject)) {
    return "patch";
  }

  return null;
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
