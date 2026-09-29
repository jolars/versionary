import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createReleaseMetadata } = vi.hoisted(() => ({
  createReleaseMetadata: vi.fn(async (input: { tag: string }) => ({
    url: `https://example.test/releases/${input.tag}`,
    status: "created" as const,
  })),
}));

vi.mock("../src/scm/client.js", () => ({
  getScmClient: () => ({ provider: "github", createReleaseMetadata }),
}));

import { runDirectRelease } from "../src/release/direct.js";
import { prepareReleasePr } from "../src/release/pr.js";
import { runReleaseDetailed } from "../src/release/release.js";

const directories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(cwd: string, file: string, content: string): void {
  const target = path.join(cwd, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function setupRepo(
  mode: "pr" | "direct",
  latest: boolean | undefined,
  rootLatest: boolean | undefined,
  childLatest: boolean | undefined,
): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-latest-"),
  );
  directories.push(directory);
  const origin = path.join(directory, "origin");
  const cwd = path.join(directory, "work");
  fs.mkdirSync(origin);
  fs.mkdirSync(cwd);
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
      "release-type": "node",
      "review-mode": mode,
      "monorepo-mode": "independent",
      "release-latest": latest,
      packages: {
        ".": { "release-latest": rootLatest },
        "packages/child": { "release-latest": childLatest },
      },
    }),
  );
  for (const [packagePath, name] of [
    [".", "root"],
    ["packages/child", "child"],
  ]) {
    write(
      cwd,
      `${packagePath}/package.json`,
      JSON.stringify({ name, version: "1.0.0" }),
    );
  }
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "chore: initialize");
  git(cwd, "tag", "v1.0.0");
  git(cwd, "tag", "child-v1.0.0");
  write(cwd, "index.js", "export const fixed = true;\n");
  write(cwd, "packages/child/index.js", "export const fixed = true;\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "fix: repair both packages");
  git(cwd, "push", "origin", "main", "--tags");
  return cwd;
}

beforeEach(() => {
  vi.stubEnv("VERSIONARY_BASE_BRANCH", "main");
  vi.stubEnv("GITHUB_REF", "refs/heads/main");
});

afterEach(() => {
  createReleaseMetadata.mockClear();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.each(["pr", "direct"] as const)(
  "Latest policy in %s releases",
  (mode) => {
    it.each([
      {
        name: "existing defaults",
        latest: undefined,
        root: undefined,
        child: undefined,
        expected: ["true", "false"],
      },
      {
        name: "inherited false",
        latest: false,
        root: undefined,
        child: undefined,
        expected: ["false", "false"],
      },
      {
        name: "inherited true",
        latest: true,
        root: undefined,
        child: undefined,
        expected: ["true", "true"],
      },
      {
        name: "root false overrides true",
        latest: true,
        root: false,
        child: undefined,
        expected: ["false", "true"],
      },
      {
        name: "root true overrides false",
        latest: false,
        root: true,
        child: undefined,
        expected: ["true", "false"],
      },
      {
        name: "child false overrides true",
        latest: true,
        root: undefined,
        child: false,
        expected: ["true", "false"],
      },
      {
        name: "child true overrides false",
        latest: false,
        root: undefined,
        child: true,
        expected: ["false", "true"],
      },
    ])("publishes with $name", async ({ latest, root, child, expected }) => {
      const cwd = setupRepo(mode, latest, root, child);
      if (mode === "pr") {
        const prepared = prepareReleasePr(cwd);
        git(cwd, "checkout", "main");
        git(cwd, "merge", "--ff-only", prepared.branch);
        git(cwd, "push", "origin", "main");
      }

      const result = await (mode === "pr"
        ? runReleaseDetailed(cwd)
        : runDirectRelease(cwd));

      expect(result.action).toBe("release-published");
      expect(createReleaseMetadata).toHaveBeenCalledTimes(2);
      for (const [index, tag] of ["v1.0.1", "child-v1.0.1"].entries()) {
        expect(createReleaseMetadata).toHaveBeenCalledWith(
          expect.objectContaining({ tag, makeLatest: expected[index] }),
          expect.objectContaining({ cwd }),
        );
      }
    });
  },
);
