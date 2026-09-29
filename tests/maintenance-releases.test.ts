import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: {
    pulls: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
    repos: { getReleaseByTag: vi.fn(), createRelease: vi.fn() },
    issues: { addLabels: vi.fn(), createComment: vi.fn() },
  },
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    pulls = api.pulls;
    repos = api.repos;
    issues = api.issues;
  },
}));

import { runDirectRelease } from "../src/release/direct.js";
import { createReleasePlan } from "../src/release/plan.js";
import {
  closeStaleReviewRequestIfExists,
  openOrUpdateReviewRequest,
  prepareReleasePr,
  pushReleaseBranch,
} from "../src/release/pr.js";
import { runReleaseDetailed } from "../src/release/release.js";
import { readReleaseTargets, writeBaselineSha } from "../src/release/state.js";

interface Pull {
  id: number;
  number: number;
  base: { ref: string };
  head: { ref: string };
  title: string;
  body: string;
  state: "open" | "closed";
  html_url: string;
}

const directories: string[] = [];
let pulls: Pull[];
let releases: Map<string, { html_url: string }>;
let latestTag: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(cwd: string, file: string, content: string): void {
  fs.writeFileSync(path.join(cwd, file), content);
}

function commit(cwd: string, message: string): string {
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function setupRepo(recordBaseline = true, mode: "pr" | "direct" = "pr") {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-maintenance-"),
  );
  directories.push(directory);
  const cwd = path.join(directory, "work");
  const origin = path.join(directory, "origin");
  fs.mkdirSync(cwd);
  fs.mkdirSync(origin);
  git(origin, "init", "--bare");
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Test User");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "remote", "add", "origin", origin);
  const config = { version: 1, "review-mode": mode };
  write(cwd, "versionary.jsonc", JSON.stringify(config));
  write(cwd, "version.txt", "1.15.0\n");
  write(
    cwd,
    "CHANGELOG.md",
    "# Changelog\n\n## 1.15.0 - 2026-01-01\n\n- Original feature.\n",
  );
  const baseline = commit(cwd, "feat: original feature");
  if (recordBaseline) {
    writeBaselineSha(cwd, baseline, [
      { path: ".", version: "1.15.0", tag: "v1.15.0" },
    ]);
    commit(cwd, "chore(release): v1.15.0");
  }
  git(cwd, "tag", "v1.15.0");
  git(cwd, "branch", "1.x");

  write(cwd, "breaking.txt", "New API.\n");
  const breaking = commit(cwd, "feat!: replace the API");
  write(cwd, "version.txt", "2.0.0\n");
  write(
    cwd,
    "CHANGELOG.md",
    "# Changelog\n\n## 2.0.0 - 2026-02-01\n\n- Replace the API.\n",
  );
  if (recordBaseline) {
    writeBaselineSha(cwd, breaking, [
      { path: ".", version: "2.0.0", tag: "v2.0.0" },
    ]);
  }
  commit(cwd, "chore(release): v2.0.0");
  git(cwd, "tag", "v2.0.0");
  write(cwd, "main-only.txt", "New feature.\n");
  const mainFeature = commit(cwd, "feat: add a main-only feature");
  write(cwd, "fix.txt", "Convergence repaired.\n");
  const originalFix = commit(cwd, "fix: repair convergence");
  git(cwd, "push", "origin", "main", "--tags");

  git(cwd, "checkout", "1.x");
  write(
    cwd,
    "versionary.jsonc",
    JSON.stringify({
      ...config,
      "release-branch": "versionary/release-1.x",
      "release-latest": false,
    }),
  );
  commit(cwd, "chore: configure maintenance releases");
  git(cwd, "cherry-pick", "-x", originalFix);
  const backport = git(cwd, "rev-parse", "HEAD");
  git(cwd, "push", "origin", "1.x");
  return {
    cwd,
    origin,
    baseline,
    breaking,
    mainFeature,
    originalFix,
    backport,
  };
}

async function openRelease(cwd: string, base: string) {
  vi.stubEnv("VERSIONARY_BASE_BRANCH", base);
  git(cwd, "checkout", base);
  const prepared = prepareReleasePr(cwd);
  pushReleaseBranch(cwd, prepared.branch);
  await openOrUpdateReviewRequest(
    cwd,
    prepared.branch,
    prepared.title,
    prepared.version,
    prepared.previousVersion,
    prepared.commits,
    prepared.plan,
  );
  return prepared;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GITHUB_REPOSITORY", "test/repository");
  vi.stubEnv("VERSIONARY_PR_TOKEN", "test-token");
  vi.stubEnv("VERSIONARY_BASE_BRANCH", "1.x");
  vi.stubEnv("GITHUB_REF", "refs/heads/1.x");
  pulls = [];
  latestTag = "v2.0.0";
  releases = new Map([
    [latestTag, { html_url: `https://example.test/releases/${latestTag}` }],
  ]);
  api.pulls.list.mockImplementation(
    async (input: { base?: string; head?: string; state?: string }) => ({
      data: pulls.filter(
        (pull) =>
          (!input.base || pull.base.ref === input.base) &&
          (!input.head || `test:${pull.head.ref}` === input.head) &&
          (!input.state || pull.state === input.state),
      ),
    }),
  );
  api.pulls.create.mockImplementation(
    async (input: {
      base: string;
      head: string;
      title: string;
      body: string;
    }) => {
      const number = pulls.length + 1;
      const pull: Pull = {
        id: number,
        number,
        base: { ref: input.base },
        head: { ref: input.head },
        title: input.title,
        body: input.body,
        state: "open",
        html_url: `https://example.test/pull/${number}`,
      };
      pulls.push(pull);
      return { data: pull };
    },
  );
  api.pulls.update.mockImplementation(
    async ({
      pull_number,
      ...changes
    }: {
      pull_number: number;
      title?: string;
      body?: string;
      state?: "closed";
    }) => {
      const pull = pulls.find((candidate) => candidate.number === pull_number);
      if (!pull) throw new Error(`Unknown pull request ${pull_number}`);
      Object.assign(pull, changes);
      return { data: pull };
    },
  );
  api.issues.addLabels.mockResolvedValue({ data: [] });
  api.issues.createComment.mockResolvedValue({ data: {} });
  api.repos.getReleaseByTag.mockImplementation(
    async ({ tag }: { tag: string }) => {
      const release = releases.get(tag);
      if (!release)
        throw Object.assign(new Error("Not found"), { status: 404 });
      return { data: release };
    },
  );
  api.repos.createRelease.mockImplementation(
    async (input: { tag_name: string; make_latest: string }) => {
      const release = {
        html_url: `https://example.test/releases/${input.tag_name}`,
      };
      releases.set(input.tag_name, release);
      if (input.make_latest === "true") latestTag = input.tag_name;
      return { data: release };
    },
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("independent maintenance releases", () => {
  it.each([true, false])(
    "plans only the backported fix with a recorded baseline: %s",
    (recordBaseline) => {
      const { cwd, baseline, breaking, mainFeature, originalFix, backport } =
        setupRepo(recordBaseline);

      const plan = createReleasePlan(cwd);

      expect(plan).toMatchObject({
        currentVersion: "1.15.0",
        nextVersion: "1.15.1",
        releaseType: "patch",
        baselineSha: recordBaseline ? baseline : null,
      });
      const hashes = plan.commits.map((entry) => entry.hash);
      expect(hashes).toContain(backport);
      for (const excluded of [baseline, breaking, mainFeature, originalFix]) {
        expect(hashes).not.toContain(excluded);
      }
      expect(plan.commits.filter((entry) => entry.type === "fix")).toHaveLength(
        1,
      );
      git(cwd, "checkout", "main");
      expect(createReleasePlan(cwd).nextVersion).toBe("2.1.0");
    },
  );

  it("creates, updates, and closes release PRs without touching the other line", async () => {
    const { cwd, origin } = setupRepo();
    const main = await openRelease(cwd, "main");
    const mainHead = git(origin, "rev-parse", main.branch);
    const mainPull = structuredClone(pulls[0]);
    const maintenance = await openRelease(cwd, "1.x");

    expect(main).toMatchObject({
      branch: "versionary/release",
      version: "2.1.0",
    });
    expect(maintenance).toMatchObject({
      branch: "versionary/release-1.x",
      version: "1.15.1",
    });
    expect(pulls.map((pull) => [pull.base.ref, pull.head.ref])).toEqual([
      ["main", "versionary/release"],
      ["1.x", "versionary/release-1.x"],
    ]);
    expect(git(origin, "show", `${maintenance.branch}:CHANGELOG.md`)).toContain(
      "repair convergence",
    );
    expect(
      git(origin, "show", `${maintenance.branch}:CHANGELOG.md`),
    ).not.toContain("main-only");
    expect(
      git(origin, "show", `${maintenance.branch}:CHANGELOG.md`),
    ).not.toContain("2.0.0");

    git(cwd, "checkout", "1.x");
    write(cwd, "another-fix.txt", "Another repair.\n");
    commit(cwd, "fix: repair another maintenance bug");
    git(cwd, "push", "origin", "1.x");
    await openRelease(cwd, "1.x");
    expect(pulls).toHaveLength(2);
    expect(pulls[1].body).toContain("another maintenance bug");

    git(cwd, "checkout", "1.x");
    git(cwd, "merge", "--ff-only", maintenance.branch);
    git(cwd, "push", "origin", "1.x");
    expect(createReleasePlan(cwd).nextVersion).toBeNull();
    expect(await closeStaleReviewRequestIfExists(cwd)).toMatchObject({
      closed: true,
      number: pulls[1].number,
    });
    expect(pulls[1].state).toBe("closed");
    expect(pulls[0]).toEqual(mainPull);
    expect(git(origin, "rev-parse", main.branch)).toBe(mainHead);
    expect(api.pulls.list).toHaveBeenCalledWith(
      expect.objectContaining({
        base: "main",
        head: "test:versionary/release",
      }),
    );
    expect(api.pulls.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        base: "1.x",
        head: "test:versionary/release-1.x",
      }),
    );
  });

  it.each(["pr", "direct"] as const)(
    "retries a %s maintenance release without promoting it or moving its tag",
    async (mode) => {
      const { cwd, origin } = setupRepo(true, mode);
      const mainHead = git(origin, "rev-parse", "main");
      if (mode === "pr") {
        const prepared = await openRelease(cwd, "1.x");
        git(cwd, "checkout", "1.x");
        git(cwd, "merge", "--ff-only", prepared.branch);
        git(cwd, "push", "origin", "1.x");
      }
      const publish = () =>
        mode === "pr" ? runReleaseDetailed(cwd) : runDirectRelease(cwd);
      api.repos.createRelease.mockRejectedValueOnce(
        new Error("Temporary outage"),
      );
      await expect(publish()).rejects.toThrow("Temporary outage");
      const tagHead = git(origin, "rev-parse", "v1.15.1");

      expect(await publish()).toMatchObject({
        action: "release-published",
        releases: [
          { tag: "v1.15.1", tagStatus: "exists", metadataStatus: "created" },
        ],
      });
      expect(api.repos.createRelease).toHaveBeenCalledTimes(2);
      for (const [input] of api.repos.createRelease.mock.calls) {
        expect(input).toMatchObject({
          tag_name: "v1.15.1",
          make_latest: "false",
          draft: false,
        });
      }
      expect(await publish()).toMatchObject({
        action: "release-published",
        releases: [
          { tag: "v1.15.1", tagStatus: "exists", metadataStatus: "exists" },
        ],
      });
      expect(api.repos.createRelease).toHaveBeenCalledTimes(2);
      expect(latestTag).toBe("v2.0.0");
      expect(git(origin, "rev-parse", "v1.15.1")).toBe(tagHead);
      expect(git(origin, "rev-parse", "1.x")).toBe(tagHead);
      expect(git(origin, "rev-parse", "main")).toBe(mainHead);
      expect(readReleaseTargets(cwd)).toEqual([
        { path: ".", version: "1.15.1", tag: "v1.15.1" },
      ]);
      git(cwd, "checkout", "main");
      expect(readReleaseTargets(cwd)).toEqual([
        { path: ".", version: "2.0.0", tag: "v2.0.0" },
      ]);
    },
  );
});
