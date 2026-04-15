import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeIdempotentReleaseTarget } from "../src/app/release/recovery.js";

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

function setupRepoWithOrigin(): { cwd: string; origin: string } {
  const origin = makeTempDir("versionary-release-origin-");
  git(origin, "init", "--bare");

  const cwd = makeTempDir("versionary-release-work-");
  git(cwd, "init");
  git(cwd, "config", "user.name", "Test User");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "remote", "add", "origin", origin);
  write(cwd, "README.md", "hello\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-m", "chore: init");
  git(cwd, "branch", "-M", "main");
  git(cwd, "push", "-u", "origin", "main");

  return { cwd, origin };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("release recovery orchestration", () => {
  it("handles already-existing tag and metadata idempotently", async () => {
    const { cwd } = setupRepoWithOrigin();
    git(cwd, "tag", "v1.0.0");
    git(cwd, "push", "origin", "v1.0.0");

    const outcome = await executeIdempotentReleaseTarget(
      cwd,
      { tag: "v1.0.0", version: "1.0.0", notes: "notes" },
      {
        createReleaseMetadata: async () => ({
          url: "https://example.test/releases/v1.0.0",
          status: "exists",
        }),
      },
    );

    expect(outcome.tagStatus).toBe("exists");
    expect(outcome.metadataStatus).toBe("exists");
  });

  it("recovers drift where tag exists but metadata is missing", async () => {
    const { cwd } = setupRepoWithOrigin();
    git(cwd, "tag", "v1.1.0");
    git(cwd, "push", "origin", "v1.1.0");

    const outcome = await executeIdempotentReleaseTarget(
      cwd,
      { tag: "v1.1.0", version: "1.1.0", notes: "notes" },
      {
        createReleaseMetadata: async () => ({
          url: "https://example.test/releases/v1.1.0",
          status: "created",
        }),
      },
    );

    expect(outcome.tagStatus).toBe("exists");
    expect(outcome.metadataStatus).toBe("created");
  });

  it("supports rerun after metadata failure occurs post-tag push", async () => {
    const { cwd } = setupRepoWithOrigin();

    await expect(
      executeIdempotentReleaseTarget(
        cwd,
        { tag: "v1.2.0", version: "1.2.0", notes: "notes" },
        {
          createReleaseMetadata: async () => {
            throw new Error("GitHub API unavailable");
          },
        },
      ),
    ).rejects.toThrow("GitHub API unavailable");

    expect(git(cwd, "tag", "--list", "v1.2.0")).toBe("v1.2.0");
    expect(git(cwd, "ls-remote", "--tags", "origin", "refs/tags/v1.2.0")).toBe(
      `${git(cwd, "rev-parse", "refs/tags/v1.2.0")}\trefs/tags/v1.2.0`,
    );

    const rerun = await executeIdempotentReleaseTarget(
      cwd,
      { tag: "v1.2.0", version: "1.2.0", notes: "notes" },
      {
        createReleaseMetadata: async () => ({
          url: "https://example.test/releases/v1.2.0",
          status: "created",
        }),
      },
    );

    expect(rerun.tagStatus).toBe("exists");
    expect(rerun.metadataStatus).toBe("created");
  });

  it("fails fast with remediation hint for missing metadata URL", async () => {
    const { cwd } = setupRepoWithOrigin();

    await expect(
      executeIdempotentReleaseTarget(
        cwd,
        { tag: "v1.3.0", version: "1.3.0", notes: "notes" },
        {
          createReleaseMetadata: async () => ({
            url: "",
            status: "created",
          }),
        },
      ),
    ).rejects.toThrow(
      'Release metadata for "v1.3.0" did not return a URL. Verify SCM API permissions and retry.',
    );
  });

  it("fails on unsafe remote/local tag drift with actionable message", async () => {
    const { cwd, origin } = setupRepoWithOrigin();
    git(cwd, "tag", "v2.0.0");
    git(cwd, "push", "origin", "v2.0.0");

    const secondRepo = makeTempDir("versionary-release-second-");
    git(secondRepo, "init");
    git(secondRepo, "config", "user.name", "Second User");
    git(secondRepo, "config", "user.email", "second@example.com");
    git(secondRepo, "remote", "add", "origin", origin);
    write(secondRepo, "another.txt", "change\n");
    git(secondRepo, "add", "another.txt");
    git(secondRepo, "commit", "-m", "feat: another commit");
    git(secondRepo, "tag", "v2.0.0");

    await expect(
      executeIdempotentReleaseTarget(
        secondRepo,
        { tag: "v2.0.0", version: "2.0.0", notes: "notes" },
        {
          createReleaseMetadata: async () => ({
            url: "https://example.test/releases/v2.0.0",
            status: "created",
          }),
        },
      ),
    ).rejects.toThrow('Tag drift detected for "v2.0.0"');
  });
});
