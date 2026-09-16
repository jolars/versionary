import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareReleasePr } from "../src/release/pr.js";
import { runCli } from "./helpers/cli.js";

const directories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function setupRepo(branch = "main") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-direct-"));
  directories.push(root);
  const origin = path.join(root, "origin");
  const cwd = path.join(root, "work");
  fs.mkdirSync(origin);
  fs.mkdirSync(cwd);
  git(origin, "init", "--bare");
  git(cwd, "init", "-b", branch);
  git(cwd, "config", "user.name", "Test User");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "remote", "add", "origin", origin);
  fs.writeFileSync(
    path.join(cwd, "versionary.jsonc"),
    JSON.stringify({
      version: 1,
      "review-mode": "direct",
    }),
  );
  fs.writeFileSync(path.join(cwd, "version.txt"), "0.7.0\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "chore: init");
  git(cwd, "tag", "v0.7.0");
  git(cwd, "commit", "--allow-empty", "-m", "fix: update formatter");
  git(cwd, "push", "-u", "origin", branch, "--tags");
  return { cwd, origin };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("direct release orchestration", () => {
  it("recovers a pending release after a corrective fix without bumping again", () => {
    const { cwd, origin } = setupRepo();
    prepareReleasePr(cwd, { branch: "main" });
    const pendingHead = git(cwd, "rev-parse", "HEAD");
    git(cwd, "commit", "--allow-empty", "-m", "fix: correct release workflow");
    git(cwd, "push", "origin", "main");
    const correctedHead = git(cwd, "rev-parse", "HEAD");

    expect(JSON.parse(runCli(cwd, "run", "--json", "--dry-run"))).toMatchObject(
      {
        action: "release-dry-run",
        tagNames: ["v0.7.1"],
      },
    );
    expect(git(cwd, "rev-parse", "HEAD")).toBe(correctedHead);
    expect(JSON.parse(runCli(cwd, "run", "--json")).tagNames).toEqual([
      "v0.7.1",
    ]);
    expect(git(cwd, "rev-parse", "HEAD^")).toBe(correctedHead);
    expect(
      git(
        cwd,
        "diff",
        pendingHead,
        "HEAD",
        "--",
        "version.txt",
        "CHANGELOG.md",
      ),
    ).toBe("");
    expect(git(origin, "rev-parse", "main")).toBe(
      git(origin, "rev-parse", "v0.7.1"),
    );
  });

  it("does nothing after a non-releasable commit", () => {
    const { cwd, origin } = setupRepo();
    runCli(cwd, "run", "--json");
    git(cwd, "commit", "--allow-empty", "-m", "docs: clarify usage");
    git(cwd, "push", "origin", "main");
    const head = git(cwd, "rev-parse", "HEAD");
    expect(JSON.parse(runCli(cwd, "run", "--json"))).toMatchObject({
      action: "noop",
      releaseCreated: false,
      tagNames: [],
    });
    expect(git(origin, "rev-parse", "main")).toBe(head);
    expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
  });

  it("rejects a concurrent branch update without overwriting it", () => {
    const { cwd, origin } = setupRepo();
    const remoteHead = git(
      origin,
      "-c",
      "user.name=Other User",
      "-c",
      "user.email=other@example.com",
      "commit-tree",
      "main^{tree}",
      "-p",
      "main",
      "-m",
      "docs: concurrent update",
    );
    git(origin, "update-ref", "refs/heads/main", remoteHead);
    expect(() => runCli(cwd, "run", "--json")).toThrow();
    expect(git(origin, "rev-parse", "main")).toBe(remoteHead);
    expect(git(cwd, "tag", "--list", "v0.7.1")).toBe("");
  });

  it("retries an earlier published commit after the remote branch advances", () => {
    const { cwd, origin } = setupRepo();
    runCli(cwd, "run", "--json");
    const releaseHead = git(cwd, "rev-parse", "HEAD");
    const remoteHead = git(
      origin,
      "-c",
      "user.name=Other User",
      "-c",
      "user.email=other@example.com",
      "commit-tree",
      "main^{tree}",
      "-p",
      "main",
      "-m",
      "docs: concurrent update",
    );
    git(origin, "update-ref", "refs/heads/main", remoteHead);
    expect(JSON.parse(runCli(cwd, "run", "--json")).tagNames).toEqual([
      "v0.7.1",
    ]);
    expect(git(origin, "rev-parse", "main")).toBe(remoteHead);
    expect(git(origin, "rev-parse", "v0.7.1")).toBe(releaseHead);
  });

  it("uses package release names consistently in dry runs and publishing", () => {
    const { cwd, origin } = setupRepo();
    fs.writeFileSync(
      path.join(cwd, "versionary.jsonc"),
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        packages: {
          "packages/a": {
            "release-type": "simple",
            "package-name": "@test/alpha",
          },
          "packages/b": { "release-type": "simple", "package-name": "beta" },
        },
      }),
    );
    for (const name of ["a", "b"]) {
      fs.mkdirSync(path.join(cwd, "packages", name), { recursive: true });
      fs.writeFileSync(
        path.join(cwd, "packages", name, "version.txt"),
        "1.0.0\n",
      );
    }
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: update packages");
    git(cwd, "push", "origin", "main");
    const preview = JSON.parse(runCli(cwd, "run", "--json", "--dry-run"));
    expect(preview.tagNames).toEqual(["test-alpha-v1.0.1", "beta-v1.0.1"]);
    const published = JSON.parse(runCli(cwd, "run", "--json"));
    expect(published.tagNames).toEqual(preview.tagNames);
    expect(published.releaseTargets).toEqual(preview.releaseTargets);
    for (const tag of published.tagNames) {
      expect(git(origin, "rev-parse", tag)).toBe(
        git(origin, "rev-parse", "main"),
      );
    }
  });

  it.each(["main", "trunk"])(
    "publishes a fix directly on %s and supports retries",
    (branch) => {
      const { cwd, origin } = setupRepo(branch);
      const originalHead = git(cwd, "rev-parse", "HEAD");
      const result = JSON.parse(runCli(cwd, "run", "--json"));
      expect(result).toMatchObject({
        action: "release-published",
        releaseCreated: true,
        tagNames: ["v0.7.1"],
        releaseTargets: [
          { path: ".", tag: "v0.7.1", version: "0.7.1", dependencies: [] },
        ],
      });
      const releaseHead = git(cwd, "rev-parse", "HEAD");
      expect(git(cwd, "rev-parse", "HEAD^")).toBe(originalHead);
      expect(git(origin, "rev-parse", `refs/heads/${branch}`)).toBe(
        releaseHead,
      );
      expect(git(origin, "rev-parse", "v0.7.1")).toBe(releaseHead);
      expect(git(cwd, "branch", "--show-current")).toBe(branch);
      expect(git(origin, "branch", "--list", "versionary/release")).toBe("");
      expect(fs.readFileSync(path.join(cwd, "version.txt"), "utf8")).toBe(
        "0.7.1\n",
      );
      expect(fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8")).toContain(
        "update formatter",
      );
      expect(JSON.parse(runCli(cwd, "run", "--json")).tagNames).toEqual([
        "v0.7.1",
      ]);
      expect(git(cwd, "rev-parse", "HEAD")).toBe(releaseHead);
    },
  );

  it("reports a release dry run without mutating the repository", () => {
    const { cwd, origin } = setupRepo();
    const head = git(cwd, "rev-parse", "HEAD");
    const result = JSON.parse(runCli(cwd, "run", "--json", "--dry-run"));
    expect(result).toMatchObject({
      action: "release-dry-run",
      releaseCreated: false,
      tagNames: ["v0.7.1"],
    });
    expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(origin, "rev-parse", "main")).toBe(head);
    expect(git(cwd, "status", "--porcelain")).toBe("");
    expect(git(cwd, "tag", "--list", "v0.7.1")).toBe("");
  });

  it("publishes nothing when the branch push is rejected, including on retry", () => {
    const { cwd, origin } = setupRepo();
    const head = git(origin, "rev-parse", "main");
    fs.writeFileSync(
      path.join(origin, "hooks", "pre-receive"),
      "#!/bin/sh\nexit 1\n",
      { mode: 0o755 },
    );
    expect(() => runCli(cwd, "run", "--json")).toThrow();
    expect(() => runCli(cwd, "run", "--json")).toThrow();
    expect(git(origin, "rev-parse", "main")).toBe(head);
    expect(git(cwd, "tag", "--list", "v0.7.1")).toBe("");
    fs.rmSync(path.join(origin, "hooks", "pre-receive"));
    expect(JSON.parse(runCli(cwd, "run", "--json")).tagNames).toEqual([
      "v0.7.1",
    ]);
    expect(git(origin, "rev-parse", "main")).toBe(
      git(origin, "rev-parse", "v0.7.1"),
    );
  });
});
