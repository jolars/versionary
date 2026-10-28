import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configSchema } from "../src/config/schema.js";
import { prepareReleasePr } from "../src/release/pr.js";
import { runReleaseDetailed } from "../src/release/release.js";
import {
  writeBaselineSha,
  writePackageReleaseState,
} from "../src/release/state.js";
import { runCli } from "./helpers/cli.js";

const directories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(cwd: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), content);
}

function setupRepo(direct = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-external-"));
  directories.push(root);
  const cwd = path.join(root, "work");
  const origin = path.join(root, "origin");
  fs.mkdirSync(cwd);
  fs.mkdirSync(origin);
  git(origin, "init", "--bare");
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Test User");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "remote", "add", "origin", origin);
  write(
    cwd,
    "versionary.jsonc",
    JSON.stringify({
      version: 1,
      "release-type": "julia",
      "release-mode": "external",
      "review-mode": direct ? "direct" : "pr",
    }),
  );
  write(cwd, "Project.toml", 'name = "Demo"\nversion = "1.0.0"\n');
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "chore: init");
  git(cwd, "tag", "v1.0.0");
  git(cwd, "commit", "--allow-empty", "-m", "fix: repair the solver");
  git(cwd, "push", "-u", "origin", "main", "--tags");
  return { cwd, origin };
}

function mergeRelease(cwd: string): string {
  const pr = prepareReleasePr(cwd);
  git(cwd, "checkout", "main");
  git(cwd, "commit", "--allow-empty", "-m", "docs: queued documentation");
  git(cwd, "merge", "--no-ff", pr.branch, "-m", "Merge release PR");
  return git(cwd, "rev-parse", "HEAD");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("external release orchestration", () => {
  it("validates the release mode independently of the review mode", () => {
    expect(
      configSchema.safeParse({ version: 1, "release-mode": "external" })
        .success,
    ).toBe(true);
    expect(
      configSchema.safeParse({ version: 1, "release-mode": "tagbot" }).success,
    ).toBe(false);
  });

  it("hands off the actual merge commit and notes without creating a tag", async () => {
    const { cwd, origin } = setupRepo();
    const sha = mergeRelease(cwd);
    const result = await runReleaseDetailed(cwd);
    expect(result).toMatchObject({
      action: "release-ready",
      releaseTargets: [
        { path: ".", version: "1.0.1", tag: "v1.0.1", sha, dependencies: [] },
      ],
    });
    if (result.action !== "release-ready") throw new Error(result.action);
    expect(result.releaseTargets[0]?.notes).toContain("repair the solver");
    expect(git(cwd, "tag", "--list", "v1.0.1")).toBe("");
    expect(git(origin, "tag", "--list", "v1.0.1")).toBe("");
    expect(await runReleaseDetailed(cwd)).toEqual(result);
    expect(JSON.parse(runCli(cwd, "run", "--json"))).toMatchObject({
      action: "release-ready",
      releaseCreated: false,
      tagNames: [],
      releaseTargets: result.releaseTargets,
    });
  });

  it("waits on later commits without changing the target, notes, or release branch", () => {
    const { cwd } = setupRepo();
    const sha = mergeRelease(cwd);
    write(
      cwd,
      "CHANGELOG.md",
      "# Changelog\n\nFuture notes that must not be registered.\n",
    );
    const manifestPath = path.join(cwd, ".versionary-manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        JSON.parse(fs.readFileSync(manifestPath, "utf8")),
        null,
        4,
      ),
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: a later correction");
    const head = git(cwd, "rev-parse", "HEAD");
    const branch = git(cwd, "rev-parse", "versionary/release");
    const result = JSON.parse(runCli(cwd, "run", "--json"));
    expect(result.action).toBe("release-waiting");
    expect(result.releaseTargets[0].sha).toBe(sha);
    expect(result.releaseTargets[0].notes).toContain("repair the solver");
    expect(result.releaseTargets[0].notes).not.toContain("Future notes");
    expect(runCli(cwd, "pr")).toContain("Waiting for external release");
    expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(cwd, "rev-parse", "versionary/release")).toBe(branch);
    expect(fs.readFileSync(path.join(cwd, "Project.toml"), "utf8")).toContain(
      'version = "1.0.1"',
    );
  });

  it("resumes planning after TagBot creates an annotated tag", () => {
    const { cwd } = setupRepo();
    const sha = mergeRelease(cwd);
    git(cwd, "tag", "-a", "v1.0.1", "-m", "Registered version", sha);
    expect(JSON.parse(runCli(cwd, "run", "--json")).action).toBe("noop");
    git(cwd, "commit", "--allow-empty", "-m", "fix: another solver correction");
    const result = JSON.parse(runCli(cwd, "run", "--json", "--dry-run"));
    expect(result.action).toBe("pr-dry-run");
    expect(result.message).toContain("1.0.2");
  });

  it.each([false, true])(
    "supports partial registration with separate release PRs = %s",
    async (separate) => {
      const { cwd } = setupRepo();
      write(
        cwd,
        "versionary.jsonc",
        JSON.stringify({
          version: 1,
          "release-mode": "external",
          "separate-release-prs": separate,
          packages: {
            "packages/a": { "release-type": "julia" },
            "packages/b": { "release-type": "julia" },
          },
        }),
      );
      const targets = ["a", "b"].map((name) => ({
        path: `packages/${name}`,
        version: "1.0.1",
        tag: `${name}-v1.0.1`,
      }));
      for (const target of targets) {
        write(
          cwd,
          `${target.path}/Project.toml`,
          `name = "${target.path.slice(-1)}"\nversion = "1.0.1"\n`,
        );
        write(
          cwd,
          `${target.path}/CHANGELOG.md`,
          `## 1.0.1 - 2026-10-28\n\n- Fixed ${target.path}.\n`,
        );
      }
      if (separate)
        writePackageReleaseState(
          cwd,
          git(cwd, "rev-parse", "HEAD"),
          targets,
          "versionary/release",
        );
      else writeBaselineSha(cwd, undefined, targets);
      git(cwd, "add", ".");
      git(cwd, "commit", "-m", "chore(release): a-v1.0.1, b-v1.0.1");
      const sha = git(cwd, "rev-parse", "HEAD");
      git(cwd, "tag", "-a", "a-v1.0.1", "-m", "Registered A");
      git(cwd, "commit", "--allow-empty", "-m", "feat: later work");
      const result = await runReleaseDetailed(cwd);
      expect(result).toMatchObject({
        action: "release-waiting",
        releaseTargets: [{ ...targets[1], sha }],
      });
      expect(JSON.parse(runCli(cwd, "run", "--json")).action).toBe(
        "release-waiting",
      );
    },
  );

  it("pushes a direct release commit once, then waits without rebasing it", () => {
    const { cwd, origin } = setupRepo(true);
    const result = JSON.parse(runCli(cwd, "run", "--json"));
    const sha = git(cwd, "rev-parse", "HEAD");
    expect(result).toMatchObject({
      action: "release-ready",
      releaseCreated: false,
      tagNames: [],
      releaseTargets: [{ sha }],
    });
    expect(git(origin, "rev-parse", "main")).toBe(sha);
    expect(git(origin, "tag", "--list", "v1.0.1")).toBe("");
    git(cwd, "commit", "--allow-empty", "-m", "fix: later change");
    const head = git(cwd, "rev-parse", "HEAD");
    expect(JSON.parse(runCli(cwd, "run", "--json"))).toMatchObject({
      action: "release-waiting",
      releaseTargets: [{ sha }],
    });
    expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
  });

  it("previews a handoff without reporting a published release", () => {
    const { cwd } = setupRepo();
    mergeRelease(cwd);
    const result = JSON.parse(runCli(cwd, "run", "--json", "--dry-run"));
    expect(result).toMatchObject({
      action: "release-dry-run",
      releaseCreated: false,
      releaseTargets: [{ notes: expect.stringContaining("repair the solver") }],
    });
    expect(git(cwd, "tag", "--list", "v1.0.1")).toBe("");
  });
});
