import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReleasePlan } from "../src/release/plan.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-release-as-test-"),
  );
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

function initRepo(): string {
  const cwd = makeTempDir();
  git(cwd, "init");
  git(cwd, "config", "user.name", "Test User");
  git(cwd, "config", "user.email", "test@example.com");
  write(cwd, "version.txt", "0.32.0\n");
  write(cwd, "versionary.jsonc", JSON.stringify({ version: 1 }));
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "chore: initial");
  git(cwd, "tag", "v0.32.0");
  return cwd;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("Release-As footer in plan", () => {
  it("graduates 0.x to a requested 1.0.0 with no breaking commit", () => {
    const cwd = initRepo();
    write(cwd, "feature.ts", "export const f = 1;\n");
    git(cwd, "add", ".");
    git(
      cwd,
      "commit",
      "-m",
      "chore: graduate to stable release",
      "-m",
      "Release-As: 1.0.0",
    );

    const plan = createReleasePlan(cwd);
    expect(plan.nextVersion).toBe("1.0.0");
    expect(plan.releaseType).toBe("major");
  });

  it("forces a release from an otherwise unreleasable window", () => {
    const cwd = initRepo();
    write(cwd, "docs.md", "# docs\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "docs: notes", "-m", "Release-As: 0.33.0");

    const plan = createReleasePlan(cwd);
    // docs alone would produce no release; the override forces one.
    expect(plan.nextVersion).toBe("0.33.0");
    expect(plan.releaseType).toBe("minor");
  });

  it("still bumps normally without a footer", () => {
    const cwd = initRepo();
    write(cwd, "feature.ts", "export const f = 1;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: add a feature");

    const plan = createReleasePlan(cwd);
    expect(plan.nextVersion).toBe("0.33.0");
    expect(plan.releaseType).toBe("minor");
  });

  it("propagates the override to the package entry", () => {
    const cwd = initRepo();
    write(cwd, "feature.ts", "export const f = 1;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: graduate", "-m", "Release-As: 1.0.0");

    const plan = createReleasePlan(cwd);
    const rootPackage = plan.packages?.find((pkg) => pkg.path === ".");
    // Single-package repos may report via top level or package entry; both
    // must agree on the pinned version when present.
    if (rootPackage) {
      expect(rootPackage.nextVersion).toBe("1.0.0");
      expect(rootPackage.bumpReason).toBe("release-as");
    }
    expect(plan.nextVersion).toBe("1.0.0");
  });
});
