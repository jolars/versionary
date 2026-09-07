import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createReleaseMetadata } = vi.hoisted(() => ({
  createReleaseMetadata: vi.fn(async (input: { tag: string }) => ({
    url: `https://example.test/releases/${input.tag}`,
    status: "created" as const,
  })),
}));

vi.mock("../src/scm/client.js", () => ({
  getScmClient: () => ({
    provider: "github",
    createReleaseMetadata,
  }),
}));

import { runReleaseDetailed } from "../src/release/release.js";
import { writePackageReleaseState } from "../src/release/state.js";

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
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(cwd: string, relativePath: string, content: string): void {
  const target = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

afterEach(() => {
  createReleaseMetadata.mockClear();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("per-package draft releases", () => {
  it("passes each target's resolved draft setting to the SCM client", async () => {
    const origin = makeTempDir("versionary-draft-origin-");
    git(origin, "init", "--bare");

    const cwd = makeTempDir("versionary-draft-release-");
    git(cwd, "init", "-b", "main");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "remote", "add", "origin", origin);

    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "simple",
        "monorepo-mode": "independent",
        "separate-release-prs": true,
        "release-draft": false,
        packages: {
          "packages/python": {},
          "packages/r": { "release-draft": true },
        },
      }),
    );
    write(cwd, "packages/python/CHANGELOG.md", "# Changelog\n");
    write(cwd, "packages/r/CHANGELOG.md", "# Changelog\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    const baselineSha = git(cwd, "rev-parse", "HEAD");

    writePackageReleaseState(
      cwd,
      baselineSha,
      [
        {
          path: "packages/python",
          version: "1.1.0",
          tag: "python-v1.1.0",
        },
        { path: "packages/r", version: "1.1.0", tag: "r-v1.1.0" },
      ],
      "versionary/release-mixed",
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore(release): mixed packages");

    const result = await runReleaseDetailed(cwd);

    expect(result.action).toBe("release-published");
    expect(createReleaseMetadata).toHaveBeenCalledTimes(2);
    expect(createReleaseMetadata).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tag: "python-v1.1.0", draft: false }),
      expect.objectContaining({ cwd }),
    );
    expect(createReleaseMetadata).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tag: "r-v1.1.0", draft: true }),
      expect.objectContaining({ cwd }),
    );
  });
});
