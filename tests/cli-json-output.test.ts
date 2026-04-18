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

function setupRepoWithOrigin(prefix: string): { cwd: string; origin: string } {
  const origin = makeTempDir(`${prefix}-origin-`);
  git(origin, "init", "--bare");

  const cwd = makeTempDir(`${prefix}-work-`);
  git(cwd, "init");
  git(cwd, "config", "user.name", "Test User");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "remote", "add", "origin", origin);
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

  it("prints machine-readable dry-run PR result without side effects", () => {
    const cwd = makeTempDir("versionary-cli-json-dry-pr-");
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
    write(cwd, "src/index.ts", "export const x = 1;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "feat: add value");

    const output = execFileSync(tsx, [cliEntry, "run", "--json", "--dry-run"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const parsed = JSON.parse(output) as {
      action: string;
      branch?: string;
      releaseCreated: boolean;
    };
    expect(parsed.action).toBe("pr-dry-run");
    expect(parsed.branch).toBe("versionary/release");
    expect(parsed.releaseCreated).toBe(false);

    expect(git(cwd, "branch", "--list", "versionary/release")).toBe("");
    expect(git(cwd, "status", "--short")).toBe("");
  });

  it("prints machine-readable dry-run release result without side effects", () => {
    const cwd = makeTempDir("versionary-cli-json-dry-release-");
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const cliEntry = path.join(repoRoot, "src", "cli", "index.ts");

    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(cwd, "versionary.jsonc", JSON.stringify({ version: 1 }));
    write(cwd, "version.txt", "1.2.3\n");
    write(cwd, "README.md", "# temp\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore(release): v1.2.3");

    const output = execFileSync(tsx, [cliEntry, "run", "--json", "--dry-run"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const parsed = JSON.parse(output) as {
      action: string;
      tagNames: string[];
      releaseCreated: boolean;
    };
    expect(parsed.action).toBe("release-dry-run");
    expect(parsed.tagNames).toEqual(["v1.2.3"]);
    expect(parsed.releaseCreated).toBe(false);
    expect(git(cwd, "tag", "--list")).toBe("");
  });

  it("prints machine-readable up-to-date PR result on repeated run", () => {
    const { cwd } = setupRepoWithOrigin("versionary-cli-json-up-to-date");
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const cliEntry = path.join(repoRoot, "src", "cli", "index.ts");

    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({ version: 1, "review-mode": "direct" }),
    );
    write(cwd, "version.txt", "0.1.0\n");
    write(cwd, "README.md", "# temp\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: init");
    git(cwd, "branch", "-M", "main");
    git(cwd, "push", "-u", "origin", "main");

    write(cwd, "src/index.ts", "export const x = 1;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "feat: add value");

    const firstOutput = execFileSync(tsx, [cliEntry, "run", "--json"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "jolars/versionary",
      },
    }).trim();
    const firstParsed = JSON.parse(firstOutput) as {
      action: string;
      branch?: string;
    };
    expect(firstParsed.action).toBe("pr-prepared");
    expect(firstParsed.branch).toBe("versionary/release");
    git(cwd, "checkout", "main");

    const secondOutput = execFileSync(tsx, [cliEntry, "run", "--json"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "jolars/versionary",
      },
    }).trim();
    const secondParsed = JSON.parse(secondOutput) as {
      action: string;
      message: string;
      branch?: string;
    };
    expect(secondParsed.action).toBe("pr-up-to-date");
    expect(secondParsed.branch).toBe("versionary/release");
    expect(secondParsed.message).toContain("already up to date");
  });
});
