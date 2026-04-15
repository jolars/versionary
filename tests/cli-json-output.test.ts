import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

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

describe("cli run --json", () => {
  it("prints machine-readable noop result when no releasable commits exist", () => {
    const cwd = makeTempDir("versionary-cli-json-");
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const cliEntry = path.join(repoRoot, "src", "cli", "index.ts");

    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(cwd, "versionary.jsonc", JSON.stringify({ version: 1 }));
    write(cwd, "version.txt", "0.1.0\n");
    write(cwd, "README.md", "# temp\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: init");

    const output = execFileSync(tsx, [cliEntry, "run", "--json"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    const parsed = JSON.parse(output) as {
      action: string;
      releaseCreated: boolean;
      tagNames: string[];
      message: string;
    };

    expect(parsed.action).toBe("noop");
    expect(parsed.releaseCreated).toBe(false);
    expect(parsed.tagNames).toEqual([]);
    expect(parsed.message).toContain("No releasable commits found");
  });
});
