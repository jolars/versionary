import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  preparePendingReleasePr,
  preparePendingSeparateReleasePrs,
} from "../src/release/pr.js";
import {
  writeBaselineSha,
  writePackageReleaseState,
} from "../src/release/state.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function write(cwd: string, relative: string, content: string): void {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("pending release PR recovery", () => {
  it.each([
    "ci: repair release workflow",
    "fix(ci): repair release workflow",
    "feat: land queued work",
  ])("recreates the pending version after %s", (followUpMessage) => {
    const cwd = makeTempDir("versionary-pending-release-");
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({ version: 1, "release-branch": "release/retry" }),
    );
    write(cwd, "version.txt", "1.2.0\n");
    write(cwd, "CHANGELOG.md", "# Changelog\n\n## 1.2.0\n\n- Added.\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore(release): v1.2.0");
    writeBaselineSha(cwd, undefined, [
      { path: ".", version: "1.2.0", tag: "v1.2.0" },
      { path: "pkg/a", version: "0.4.0", tag: "a-v0.4.0" },
    ]);
    git(cwd, "add", ".versionary-manifest.json");
    git(cwd, "commit", "--amend", "--no-edit");
    write(cwd, ".github/workflows/ci.yml", "fixed: true\n");
    git(cwd, "add", ".github/workflows/ci.yml");
    git(cwd, "commit", "-m", followUpMessage);
    const fixedHead = git(cwd, "rev-parse", "HEAD");

    const recovered = preparePendingReleasePr(cwd);

    expect(recovered.branch).toBe("release/retry");
    expect(recovered.title).toBe("chore(release): v1.2.0 (+1 more)");
    expect(recovered.targets).toEqual([
      { path: ".", version: "1.2.0", tag: "v1.2.0" },
      { path: "pkg/a", version: "0.4.0", tag: "a-v0.4.0" },
    ]);
    expect(git(cwd, "show", "-s", "--format=%P", "HEAD")).toBe(fixedHead);
    expect(git(cwd, "show", "-s", "--format=%s", "HEAD")).toBe(
      "chore(release): v1.2.0 (+1 more)",
    );
    expect(git(cwd, "show", "-s", "--format=%B", "HEAD")).toContain(
      "Versionary-Release: true",
    );
    expect(git(cwd, "diff", "HEAD^", "HEAD", "--stat")).toBe("");
    expect(fs.readFileSync(path.join(cwd, "version.txt"), "utf8")).toBe(
      "1.2.0\n",
    );
  });

  it("recreates independent pending cohorts without moving the caller", () => {
    const cwd = makeTempDir("versionary-pending-separate-releases-");
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "separate-release-prs": true,
        packages: {
          "packages/a": { "release-type": "simple" },
          "packages/b": { "release-type": "simple" },
        },
      }),
    );
    write(cwd, "packages/a/version.txt", "1.1.0\n");
    write(cwd, "packages/b/version.txt", "2.1.0\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initialize");
    const releaseBase = git(cwd, "rev-parse", "HEAD");
    writePackageReleaseState(
      cwd,
      releaseBase,
      [{ path: "packages/a", version: "1.1.0", tag: "a-v1.1.0" }],
      "versionary/release-a-111111111111",
    );
    writePackageReleaseState(
      cwd,
      releaseBase,
      [{ path: "packages/b", version: "2.1.0", tag: "b-v2.1.0" }],
      "versionary/release-b-222222222222",
    );
    git(cwd, "add", ".versionary-manifest.json.d");
    git(cwd, "commit", "-m", "chore(release): a-v1.1.0 (+1 more)");
    write(cwd, ".github/workflows/ci.yml", "fixed: true\n");
    git(cwd, "add", ".github/workflows/ci.yml");
    git(cwd, "commit", "-m", "fix(ci): repair release workflow");
    const fixedHead = git(cwd, "rev-parse", "HEAD");
    const originalBranch = git(cwd, "branch", "--show-current");

    const recovered = preparePendingSeparateReleasePrs(cwd);

    expect(recovered.map((candidate) => candidate.branch)).toEqual([
      "versionary/release-a-111111111111",
      "versionary/release-b-222222222222",
    ]);
    expect(git(cwd, "rev-parse", "HEAD")).toBe(fixedHead);
    expect(git(cwd, "branch", "--show-current")).toBe(originalBranch);
    for (const candidate of recovered) {
      expect(git(cwd, "show", "-s", "--format=%P", candidate.branch)).toBe(
        fixedHead,
      );
      expect(git(cwd, "diff", `${candidate.branch}^`, candidate.branch)).toBe(
        "",
      );
    }
  });
});
