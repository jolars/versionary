import { execFileSync } from "node:child_process";

/**
 * Default committer identity Versionary uses when a repository has no
 * `user.name`/`user.email` configured (for example a bare CI runner).
 *
 * This intentionally mirrors the GitHub Action entrypoint
 * (`src/action/index.ts`), which is a standalone bundle and cannot import this
 * module, so release commits are attributed to the same bot regardless of how
 * Versionary is invoked (composite action vs. running the CLI from source).
 */
export const DEFAULT_GIT_AUTHOR_NAME = "github-actions[bot]";
export const DEFAULT_GIT_AUTHOR_EMAIL =
  "41898282+github-actions[bot]@users.noreply.github.com";

function hasGitConfig(cwd: string, key: string): boolean {
  try {
    execFileSync("git", ["config", key], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure git has a committer identity before Versionary creates release
 * commits. This only fills the gap: if `user.name`/`user.email` already resolve
 * (local, global, or system config), they are left untouched. Otherwise a
 * repository-local default is set so `git commit` does not fail with
 * "Please tell me who you are".
 */
export function ensureGitIdentity(cwd: string): void {
  if (!hasGitConfig(cwd, "user.name")) {
    execFileSync("git", ["config", "user.name", DEFAULT_GIT_AUTHOR_NAME], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
  }
  if (!hasGitConfig(cwd, "user.email")) {
    execFileSync("git", ["config", "user.email", DEFAULT_GIT_AUTHOR_EMAIL], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
  }
}
