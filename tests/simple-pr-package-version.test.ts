import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { prepareSimpleReleasePr } from "../src/simple/pr.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-pr-package-test-"));
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

describe("release PR package version update", () => {
  it("updates root package.json version for node release-type", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "package.json",
      JSON.stringify({ name: "demo", version: "1.0.0", private: true }, null, 2) + "\n",
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "node",
        "review-mode": "direct",
        "version-file": "version.txt",
        "changelog-file": "CHANGELOG.md",
      }),
    );

    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "src/index.ts", "export const value = 1;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "feat: add value");

    const result = prepareSimpleReleasePr(cwd);
    expect(result.version).toBe("1.1.0");

    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe("1.1.0");
  });

  it("does not update package.json for simple strategy by default", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "package.json",
      JSON.stringify({ name: "demo", version: "1.0.0", private: true }, null, 2) + "\n",
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        "version-file": "version.txt",
        "changelog-file": "CHANGELOG.md",
      }),
    );

    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "src/index.ts", "export const value = 1;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "feat: add value");

    const result = prepareSimpleReleasePr(cwd);
    expect(result.version).toBe("1.1.0");

    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe("1.0.0");
  });
});
