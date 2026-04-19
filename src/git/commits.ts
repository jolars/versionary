import { execFileSync } from "node:child_process";
import path from "node:path";
import type { ReleaseType } from "../release/semver.js";

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
  header?: string;
  merge?: string | null;
  footer?: string | null;
  notes?: CommitNote[];
  references?: CommitReference[];
  mentions?: string[];
  revert?: RevertInfo | null;
  isConventional?: boolean;
  diagnostics?: ParseDiagnostic[];
}

export type CommitParseDiagnosticCode =
  | "invalid-header"
  | "malformed-breaking-footer"
  | "malformed-reference"
  | "ambiguous-revert";

export interface ParseDiagnostic {
  code: CommitParseDiagnosticCode;
  message: string;
}

export interface CommitNote {
  title: string;
  text: string;
}

export interface CommitReference {
  action: string | null;
  owner: string | null;
  repository: string | null;
  issue: string | null;
  raw: string;
  prefix: "#" | "GH-";
}

export interface RevertInfo {
  header: string;
  hashes: string[];
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
  isConventional: boolean;
  diagnostics: ParseDiagnostic[];
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
      isConventional: false,
      diagnostics: [
        {
          code: "invalid-header",
          message:
            "Header does not match Conventional Commits format: <type>(<scope>)?: <description>.",
        },
      ],
    };
  }

  return {
    type: conventionalMatch[1]?.toLowerCase() ?? null,
    scope: conventionalMatch[2]?.trim() ?? null,
    isBreakingHeader: conventionalMatch[3] === "!",
    description: conventionalMatch[4]?.trim() ?? subject,
    isConventional: true,
    diagnostics: [],
  };
}

function parseFooters(body: string): {
  bodyText: string;
  footerText: string | null;
  footers: Array<{ token: string; value: string }>;
  diagnostics: ParseDiagnostic[];
  references: CommitReference[];
  notes: CommitNote[];
} {
  if (!body) {
    return {
      bodyText: "",
      footerText: null,
      footers: [],
      diagnostics: [],
      references: [],
      notes: [],
    };
  }

  const parseFooterLine = (
    line: string,
  ): { token: string; value: string } | null => {
    const colonMatch = line.match(
      /^(BREAKING CHANGE|BREAKING-CHANGE|[A-Za-z][A-Za-z0-9-]*):\s+(.+)$/u,
    );
    if (colonMatch) {
      return {
        token: colonMatch[1] ?? "",
        value: colonMatch[2] ?? "",
      };
    }
    const issueRefMatch = line.match(
      /^([A-Za-z][A-Za-z0-9-]*)\s+((?:GH-|#).+)$/u,
    );
    if (issueRefMatch) {
      return {
        token: issueRefMatch[1] ?? "",
        value: issueRefMatch[2] ?? "",
      };
    }
    return null;
  };

  const diagnostics: ParseDiagnostic[] = [];
  const lines = body.split("\n");
  for (const line of lines) {
    if (
      /^\s*BREAKING(?:\s|-)?CHANGE\b/iu.test(line) &&
      !/^\s*(BREAKING CHANGE|BREAKING-CHANGE):\s+/iu.test(line)
    ) {
      diagnostics.push({
        code: "malformed-breaking-footer",
        message:
          "Found BREAKING CHANGE-like footer without required ': ' separator.",
      });
    }
  }
  const footerStart = lines.findIndex((line) => parseFooterLine(line) !== null);
  const bodyLines = footerStart < 0 ? lines : lines.slice(0, footerStart);
  const footerLines = footerStart < 0 ? [] : lines.slice(footerStart);

  const footers: Array<{ token: string; value: string }> = [];
  const references: CommitReference[] = [];
  const notes: CommitNote[] = [];
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

  const extractReferences = (text: string, action: string | null): void => {
    const refs = text.match(/(?:GH-|#)[^\s,;:()]+/gu) ?? [];
    for (const raw of refs) {
      const issue = raw.replace(/^(GH-|#)/u, "");
      if (!/^\d+$/u.test(issue)) {
        diagnostics.push({
          code: "malformed-reference",
          message: `Malformed issue reference "${raw}" in footer.`,
        });
        continue;
      }
      references.push({
        action,
        owner: null,
        repository: null,
        issue,
        raw,
        prefix: raw.startsWith("GH-") ? "GH-" : "#",
      });
    }
  };

  const extractInlineSentenceReferences = (text: string): void => {
    const inlineMatches = text.matchAll(
      /\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b\s+((?:(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+))?#(?<issue>\d+)|GH-(?<ghIssue>\d+))/giu,
    );
    for (const match of inlineMatches) {
      const action = match[1] ?? null;
      const raw = match[2] ?? "";
      const owner = match.groups?.owner ?? null;
      const repository = match.groups?.repo ?? null;
      const issue = match.groups?.issue ?? match.groups?.ghIssue ?? null;
      if (!issue || !/^\d+$/u.test(issue)) {
        continue;
      }
      references.push({
        action,
        owner,
        repository,
        issue,
        raw,
        prefix: raw.startsWith("GH-") ? "GH-" : "#",
      });
    }
  };

  for (const line of footerLines) {
    const footerMatch = parseFooterLine(line);
    if (footerMatch) {
      pushCurrent();
      current = {
        token: footerMatch.token,
        value: footerMatch.value,
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
  for (const footer of footers) {
    if (/^(BREAKING CHANGE|BREAKING-CHANGE)$/iu.test(footer.token)) {
      notes.push({
        title: "BREAKING CHANGE",
        text: footer.value,
      });
    }
    extractReferences(`${footer.token}: ${footer.value}`, footer.token);
  }
  extractInlineSentenceReferences(body);
  const dedupedReferences = [
    ...new Map(
      references.map((reference) => [
        `${reference.action ?? ""}:${reference.owner ?? ""}/${reference.repository ?? ""}:${reference.prefix}:${reference.issue ?? ""}`,
        reference,
      ]),
    ).values(),
  ];

  return {
    bodyText: bodyLines.join("\n").trim() || "",
    footerText: footerLines.length > 0 ? footerLines.join("\n").trim() : null,
    footers,
    diagnostics,
    references: dedupedReferences,
    notes,
  };
}

function extractRevertedShas(subject: string, body: string): string[] {
  const full = `${subject}\n${body}`;
  const matches = full.match(/\b[0-9a-f]{7,40}\b/giu) ?? [];
  return [...new Set(matches.map((sha) => sha.toLowerCase()))];
}

function extractMentions(text: string): string[] {
  const mentions =
    text.match(/(?:^|[^A-Za-z0-9_])@([A-Za-z0-9][A-Za-z0-9-]{0,38})/gu) ?? [];
  return [
    ...new Set(
      mentions
        .map((mention) => mention.replace(/^.*@/u, ""))
        .filter((mention) => mention.length > 0),
    ),
  ];
}

function parseCommitMessage(
  hash: string,
  subject: string,
  body: string,
): ParsedCommit {
  const header = parseHeader(subject);
  const footerResult = parseFooters(body);
  const bodyText = footerResult.bodyText;
  const footers = footerResult.footers;
  const hasBreakingFooter = footers.some((footer) =>
    /^(BREAKING CHANGE|BREAKING-CHANGE)$/iu.test(footer.token),
  );
  const isRevert =
    (header.type?.toLowerCase() ?? "") === "revert" ||
    /^revert:\s/i.test(subject);
  const revertInfo: RevertInfo | null = isRevert
    ? {
        header: subject,
        hashes: extractRevertedShas(subject, body),
      }
    : null;
  const diagnostics = [...header.diagnostics, ...footerResult.diagnostics];
  if (isRevert && revertInfo && revertInfo.hashes.length === 0) {
    diagnostics.push({
      code: "ambiguous-revert",
      message:
        "Revert commit detected but no reverted commit SHA reference was parsed.",
    });
  }

  return {
    hash,
    subject,
    body: bodyText,
    fullMessage: body ? `${subject}\n\n${body}` : subject,
    type: header.type,
    scope: header.scope,
    description: header.description,
    isBreaking: header.isBreakingHeader || hasBreakingFooter,
    isRevert,
    footers,
    revertedShas: isRevert ? extractRevertedShas(subject, body) : [],
    header: subject,
    merge: null,
    footer: footerResult.footerText,
    notes: footerResult.notes,
    references: footerResult.references,
    mentions: extractMentions(`${subject}\n${body}`),
    revert: revertInfo,
    isConventional: header.isConventional,
    diagnostics,
  };
}

export function parseConventionalCommitMessage(
  subject: string,
  body = "",
): ParsedCommit {
  return parseCommitMessage("", subject.trim(), body.trim());
}

export function parseConventionalCommitMessageDetailed(
  header: string,
  body = "",
): ParsedCommit {
  return parseCommitMessage("", header.trim(), body.trim());
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

  const excludes = excludePaths.flatMap((excludePath) => {
    const normalizedExcludePath = excludePath
      .replace(/^\.\//u, "")
      .replace(/\/+$/u, "");
    const combined =
      normalizedPackagePath === "."
        ? normalizedExcludePath
        : path.posix.join(normalizedPackagePath, normalizedExcludePath);
    return [`:(exclude)${combined}`, `:(exclude)${combined}/**`];
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
  const excludes = excludePaths.flatMap((excludePath) => {
    const normalizedExcludePath = excludePath
      .replace(/^\.\//u, "")
      .replace(/\/+$/u, "");
    const combined =
      normalizedPackagePath === "."
        ? normalizedExcludePath
        : path.posix.join(normalizedPackagePath, normalizedExcludePath);
    return [`:(exclude)${combined}`, `:(exclude)${combined}/**`];
  });
  return readGitLogFull(cwd, range, [normalizedPackagePath, ...excludes]);
}

export function inferReleaseTypeFromParsedCommit(
  commit: ParsedCommit,
): ReleaseType {
  if (commit.isBreaking) {
    return "major";
  }

  if (commit.isRevert) {
    return "patch";
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

export function getCommitParseDiagnostics(
  commit: ParsedCommit,
): ParseDiagnostic[] {
  return commit.diagnostics ?? [];
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
