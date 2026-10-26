import { execFileSync } from "node:child_process";
import type { VersionaryCommitOverride } from "../types/config.js";
import {
  type ParsedCommit,
  parseConventionalCommitMessageDetailed,
} from "./commits.js";

export interface CommitOverrideReport {
  hash: string;
  originalMessage: string;
  override: VersionaryCommitOverride;
  packages: string[];
}

export interface ResolvedCommitOverride {
  report: CommitOverrideReport;
  replacement?: ParsedCommit;
}

export function parseCommitOverrideMessage(message: string): ParsedCommit {
  const [header, ...body] = message.trim().replace(/\r\n/gu, "\n").split("\n");
  const parsed = parseConventionalCommitMessageDetailed(
    header,
    body.join("\n"),
  );
  if (!parsed.isConventional || parsed.diagnostics?.length) {
    throw new Error(
      `Invalid commit override message: ${parsed.diagnostics?.[0]?.message ?? "expected a Conventional Commit message."}`,
    );
  }
  return parsed;
}

export function resolveCommitSha(cwd: string, sha: string): string {
  if (!/^[a-f0-9]{4,64}$/iu.test(sha)) {
    throw new Error(
      "Expected a commit SHA (at least four hexadecimal characters).",
    );
  }
  let hash: string;
  try {
    hash = execFileSync(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${sha}^{commit}`],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    throw new Error(
      `Commit SHA "${sha}" is unknown or ambiguous. Use a longer SHA and ensure the commit history is available locally.`,
    );
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", hash, "HEAD"], {
      cwd,
      stdio: "ignore",
    });
  } catch {
    throw new Error(`Commit ${hash} is not an ancestor of HEAD.`);
  }
  return hash;
}

export function resolveCommitOverrides(
  cwd: string,
  overrides: Record<string, VersionaryCommitOverride>,
): Map<string, ResolvedCommitOverride> {
  return new Map(
    Object.entries(overrides).map(([sha, override]) => {
      const hash = resolveCommitSha(cwd, sha);
      const originalMessage = execFileSync(
        "git",
        ["show", "-s", "--format=%B", hash],
        {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
      return [
        hash,
        {
          report: { hash, originalMessage, override, packages: [] },
          ...(override.message === undefined
            ? {}
            : {
                replacement: {
                  ...parseCommitOverrideMessage(override.message),
                  hash,
                },
              }),
        },
      ];
    }),
  );
}

export function applyCommitOverrides(
  commits: ParsedCommit[],
  overrides: ReadonlyMap<string, ResolvedCommitOverride>,
): ParsedCommit[] {
  return commits.flatMap((commit) => {
    const resolved = overrides.get(commit.hash);
    if (resolved?.report.override.skip) {
      return [];
    }
    return [resolved?.replacement ?? commit];
  });
}
