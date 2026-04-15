import { execFileSync } from "node:child_process";
import path from "node:path";
import type { ReleaseType } from "../../domain/release/semver.js";

export interface CommitInfo {
  hash: string;
  subject: string;
}

export interface ParsedCommit {
  hash: string;
  subject: string;
  body: string;
  fullMessage: string;
  type: string | null;
  scope: string | null;
  description: string;
  isBreaking: boolean;
  isRevert: boolean;
  footers: Array<{ token: string; value: string }>;
  revertedShas: string[];
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

function readGitLogFull(
  cwd: string,
  range: string,
  pathspecs: string[] = [],
): ParsedCommit[] {
  const recordSeparator = "\x1e";
  const fieldSeparator = "\x1f";
  const output = execFileSync(
    "git",
    [
      "log",
      range,
      `--pretty=format:%H${fieldSeparator}%s${fieldSeparator}%b${recordSeparator}`,
      "--",
      ...pathspecs,
    ],
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
    .split(recordSeparator)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash = "", subject = "", body = ""] = record.split(fieldSeparator);
      return parseCommitMessage(hash, subject.trim(), body.trim());
    });
}

function parseHeader(subject: string): {
  type: string | null;
  scope: string | null;
  description: string;
  isBreakingHeader: boolean;
} {
  const conventionalMatch = subject.match(
    /^([a-z][a-z0-9-]*)(?:\(([^)]+)\))?(!)?:\s+(.+)$/iu,
  );
  if (!conventionalMatch) {
    return {
      type: null,
      scope: null,
      description: subject,
      isBreakingHeader: false,
    };
  }

  return {
    type: conventionalMatch[1]?.toLowerCase() ?? null,
    scope: conventionalMatch[2]?.trim() ?? null,
    isBreakingHeader: conventionalMatch[3] === "!",
    description: conventionalMatch[4]?.trim() ?? subject,
  };
}

function parseFooters(body: string): Array<{ token: string; value: string }> {
  if (!body) {
    return [];
  }

  const lines = body.split("\n");
  const footers: Array<{ token: string; value: string }> = [];
  let current: { token: string; value: string } | null = null;

  const pushCurrent = (): void => {
    if (!current) {
      return;
    }
    footers.push({
      token: current.token,
      value: current.value.trim(),
    });
    current = null;
  };

  for (const line of lines) {
    const footerMatch = line.match(
      /^(BREAKING CHANGE|BREAKING-CHANGE|[A-Za-z][A-Za-z0-9-]*)(?::\s+|\s+#)(.*)$/u,
    );

    if (footerMatch) {
      pushCurrent();
      current = {
        token: footerMatch[1] ?? "",
        value: footerMatch[2] ?? "",
      };
      continue;
    }

    if (current && line.trim().length > 0) {
      current.value = `${current.value}\n${line}`;
      continue;
    }

    pushCurrent();
  }

  pushCurrent();
  return footers;
}

function extractRevertedShas(subject: string, body: string): string[] {
  const full = `${subject}\n${body}`;
  const matches = full.match(/\b[0-9a-f]{7,40}\b/giu) ?? [];
  return [...new Set(matches.map((sha) => sha.toLowerCase()))];
}

function parseCommitMessage(
  hash: string,
  subject: string,
  body: string,
): ParsedCommit {
  const header = parseHeader(subject);
  const footers = parseFooters(body);
  const hasBreakingFooter = footers.some((footer) =>
    /^(BREAKING CHANGE|BREAKING-CHANGE)$/iu.test(footer.token),
  );
  const isRevert =
    (header.type?.toLowerCase() ?? "") === "revert" ||
    /^revert:\s/i.test(subject);

  return {
    hash,
    subject,
    body,
    fullMessage: body ? `${subject}\n\n${body}` : subject,
    type: header.type,
    scope: header.scope,
    description: header.description,
    isBreaking: header.isBreakingHeader || hasBreakingFooter,
    isRevert,
    footers,
    revertedShas: isRevert ? extractRevertedShas(subject, body) : [],
  };
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

export function getParsedCommitsSinceLastTag(
  cwd = process.cwd(),
  baselineSha?: string | null,
): ParsedCommit[] {
  const range = resolveRange(cwd, baselineSha);
  return readGitLogFull(cwd, range);
}

export function getParsedCommitsForPath(
  cwd = process.cwd(),
  baselineSha?: string | null,
  packagePath = ".",
  excludePaths: string[] = [],
): ParsedCommit[] {
  const range = resolveRange(cwd, baselineSha);
  const normalizedPackagePath = packagePath === "." ? "." : packagePath;
  const excludes = excludePaths.map((excludePath) => {
    const combined =
      normalizedPackagePath === "."
        ? excludePath
        : path.posix.join(normalizedPackagePath, excludePath);
    return `:(exclude)${combined}`;
  });
  return readGitLogFull(cwd, range, [normalizedPackagePath, ...excludes]);
}

function inferReleaseTypeFromParsedCommit(commit: ParsedCommit): ReleaseType {
  if (commit.isRevert) {
    return null;
  }

  if (commit.isBreaking) {
    return "major";
  }

  const type = commit.type?.toLowerCase() ?? "";
  if (type === "feat") {
    return "minor";
  }

  if (type === "fix" || type === "perf") {
    return "patch";
  }

  if (type === "chore") {
    return null;
  }

  return null;
}

export function inferReleaseTypeFromSubject(subject: string): ReleaseType {
  return inferReleaseTypeFromParsedCommit(
    parseCommitMessage("", subject.trim(), ""),
  );
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

export function applyRevertSuppression(
  commits: ParsedCommit[],
): ParsedCommit[] {
  if (commits.length === 0) {
    return commits;
  }

  const presentShas = new Set(
    commits.map((commit) => commit.hash.toLowerCase()),
  );
  const reverted = new Set<string>();

  for (const commit of commits) {
    if (!commit.isRevert) {
      continue;
    }
    for (const sha of commit.revertedShas) {
      if (presentShas.has(sha)) {
        reverted.add(sha);
      }
    }
  }

  return commits.filter((commit) => !reverted.has(commit.hash.toLowerCase()));
}

export function analyzeParsedCommits(commits: ParsedCommit[]): ReleaseType {
  let result: ReleaseType = null;
  const effectiveCommits = applyRevertSuppression(commits);

  for (const commit of effectiveCommits) {
    const type = inferReleaseTypeFromParsedCommit(commit);
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

export function isReleasableParsedCommit(commit: ParsedCommit): boolean {
  return inferReleaseTypeFromParsedCommit(commit) !== null;
}
