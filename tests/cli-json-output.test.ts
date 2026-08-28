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
  it.each([
    "ci: repair release workflow",
    "fix(ci): repair release workflow",
    "feat: land queued work",
  ])("recovers an untagged pending version after %s", (followUpMessage) => {
    const { cwd } = setupRepoWithOrigin("versionary-cli-pending-release");
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const cliEntry = path.join(repoRoot, "src", "cli", "index.ts");

    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({ version: 1, "review-mode": "direct" }),
    );
    write(cwd, "version.txt", "1.2.0\n");
    write(cwd, "CHANGELOG.md", "# Changelog\n\n## 1.2.0\n\n- Added.\n");
    write(
      cwd,
      ".versionary-manifest.json",
      `${JSON.stringify(
        {
          "manifest-version": 1,
          "baseline-sha": "0000000000000000000000000000000000000000",
          "release-targets": [{ path: ".", version: "1.2.0", tag: "v1.2.0" }],
          "pending-release-targets": [
            { path: ".", version: "1.2.0", tag: "v1.2.0" },
          ],
        },
        null,
        2,
      )}\n`,
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore(release): v1.2.0");
    git(cwd, "branch", "-M", "main");
    write(cwd, ".github/workflows/ci.yml", "fixed: true\n");
    git(cwd, "add", ".github/workflows/ci.yml");
    git(cwd, "commit", "-m", followUpMessage);
    const correctedHead = git(cwd, "rev-parse", "HEAD");
    git(cwd, "push", "-u", "origin", "main");

    const dryRunOutput = execFileSync(
      tsx,
      [cliEntry, "run", "--json", "--dry-run"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GITHUB_REPOSITORY: "jolars/versionary",
        },
      },
    ).trim();
    const dryRun = JSON.parse(dryRunOutput) as {
      action: string;
      targets?: { tag: string; version: string }[];
    };
    expect(dryRun.action).toBe("pr-dry-run");
    expect(dryRun.targets).toEqual([{ tag: "v1.2.0", version: "1.2.0" }]);
    expect(git(cwd, "branch", "--list", "versionary/release")).toBe("");

    const output = execFileSync(tsx, [cliEntry, "run", "--json"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "jolars/versionary",
      },
    }).trim();
    const parsed = JSON.parse(output) as {
      action: string;
      branch?: string;
      title?: string;
    };

    expect(parsed.action).toBe("pr-prepared");
    expect(parsed.branch).toBe("versionary/release");
    expect(parsed.title).toBe("chore(release): v1.2.0");
    expect(git(cwd, "show", "-s", "--format=%P", "HEAD")).toBe(correctedHead);
    expect(fs.readFileSync(path.join(cwd, "version.txt"), "utf8")).toBe(
      "1.2.0\n",
    );

    git(cwd, "checkout", "main");
    const repeatedOutput = execFileSync(tsx, [cliEntry, "run", "--json"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "jolars/versionary",
      },
    }).trim();
    const repeated = JSON.parse(repeatedOutput) as {
      action: string;
      title?: string;
    };
    expect(repeated.action).toBe("pr-up-to-date");
    expect(repeated.title).toBe("chore(release): v1.2.0");
  });

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

  it("prints one dry-run review result per independent package", () => {
    const cwd = makeTempDir("versionary-cli-json-separate-prs-");
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const cliEntry = path.join(repoRoot, "src", "cli", "index.ts");

    git(cwd, "init", "-b", "main");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "separate-release-prs": true,
        packages: {
          "packages/a": { "release-type": "simple" },
          "packages/b": { "release-type": "simple" },
        },
      }),
    );
    for (const name of ["a", "b"]) {
      write(cwd, `packages/${name}/version.txt`, "1.0.0\n");
      write(cwd, `packages/${name}/CHANGELOG.md`, "# Changelog\n");
      write(cwd, `packages/${name}/index.ts`, `export const ${name} = 1;\n`);
    }
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initialize");
    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: improve a");
    write(cwd, "packages/b/index.ts", "export const b = 2;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: repair b");

    const output = execFileSync(tsx, [cliEntry, "run", "--json", "--dry-run"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const parsed = JSON.parse(output) as {
      action: string;
      branch?: string;
      reviewRequests?: Array<{
        packagePaths: string[];
        branch: string;
        status: string;
      }>;
    };

    expect(parsed.action).toBe("pr-dry-run");
    expect(
      parsed.reviewRequests?.map((request) => request.packagePaths),
    ).toEqual([["packages/a"], ["packages/b"]]);
    expect(
      parsed.reviewRequests?.every((request) => request.status === "dry-run"),
    ).toBe(true);
    expect(parsed.branch).toBe(parsed.reviewRequests?.[0]?.branch);
    expect(git(cwd, "branch", "--list", "versionary/release*")).toBe("");
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

  it("exposes a dependency-first release target handoff", () => {
    const cwd = makeTempDir("versionary-cli-json-release-targets-");
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const cliEntry = path.join(repoRoot, "src", "cli", "index.ts");

    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "separate-release-prs": true,
        packages: {
          "packages/a": { "release-type": "simple" },
          "packages/b": { "release-type": "simple" },
        },
      }),
    );
    for (const name of ["a", "b"]) {
      write(cwd, `packages/${name}/version.txt`, "1.1.0\n");
      write(cwd, `packages/${name}/CHANGELOG.md`, "# Changelog\n");
    }
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initialize");
    const baselineSha = git(cwd, "rev-parse", "HEAD");
    const branch = "versionary/release-a-111111111111";
    for (const target of [
      {
        path: "packages/a",
        version: "1.1.0",
        tag: "a-v1.1.0",
        dependencies: ["packages/b"],
      },
      { path: "packages/b", version: "1.1.0", tag: "b-v1.1.0" },
    ]) {
      write(
        cwd,
        `.versionary-manifest.json.d/${target.path.endsWith("a") ? "a" : "b"}.json`,
        `${JSON.stringify({
          "manifest-version": 1,
          path: target.path,
          "baseline-sha": baselineSha,
          "release-target": target,
          "release-branch": branch,
        })}\n`,
      );
    }
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore(release): a-v1.1.0 (+1 more)");

    const output = execFileSync(tsx, [cliEntry, "run", "--json", "--dry-run"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const parsed = JSON.parse(output) as {
      tagNames: string[];
      releaseTargets: Array<{
        path: string;
        dependencies: string[];
      }>;
    };

    expect(parsed.tagNames).toEqual(["a-v1.1.0", "b-v1.1.0"]);
    expect(parsed.releaseTargets).toEqual([
      {
        path: "packages/b",
        version: "1.1.0",
        tag: "b-v1.1.0",
        dependencies: [],
      },
      {
        path: "packages/a",
        version: "1.1.0",
        tag: "a-v1.1.0",
        dependencies: ["packages/b"],
      },
    ]);
  });

  it("detects a merged package release from its sidecar state", () => {
    const cwd = makeTempDir("versionary-cli-json-package-release-");
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const cliEntry = path.join(repoRoot, "src", "cli", "index.ts");

    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "separate-release-prs": true,
        packages: { "packages/a": { "release-type": "simple" } },
      }),
    );
    write(cwd, "packages/a/version.txt", "1.1.0\n");
    write(cwd, "packages/a/CHANGELOG.md", "# Changelog\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initialize");
    write(
      cwd,
      ".versionary-manifest.json.d/a.json",
      `${JSON.stringify({
        "manifest-version": 1,
        path: "packages/a",
        "baseline-sha": git(cwd, "rev-parse", "HEAD"),
        "release-target": {
          path: "packages/a",
          version: "1.1.0",
          tag: "a-v1.1.0",
        },
        "release-branch": "versionary/release-a-111111111111",
      })}\n`,
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "Merge package release PR");

    const output = execFileSync(tsx, [cliEntry, "run", "--json", "--dry-run"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const parsed = JSON.parse(output) as {
      action: string;
      tagNames: string[];
    };

    expect(parsed.action).toBe("release-dry-run");
    expect(parsed.tagNames).toEqual(["a-v1.1.0"]);
  });

  it("does not fall back to a root release after a package tag exists", () => {
    const cwd = makeTempDir("versionary-cli-json-tagged-package-");
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const cliEntry = path.join(repoRoot, "src", "cli", "index.ts");

    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "separate-release-prs": true,
        packages: { "packages/a": { "release-type": "simple" } },
      }),
    );
    write(cwd, "packages/a/version.txt", "1.1.0\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initialize");
    write(
      cwd,
      ".versionary-manifest.json.d/a.json",
      `${JSON.stringify({
        "manifest-version": 1,
        path: "packages/a",
        "baseline-sha": "0000000000000000000000000000000000000000",
        "release-target": {
          path: "packages/a",
          version: "1.1.0",
          tag: "a-v1.1.0",
        },
        "release-branch": "versionary/release-a-111111111111",
      })}\n`,
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "Merge package release PR");
    git(cwd, "tag", "a-v1.1.0");

    const output = execFileSync(tsx, [cliEntry, "run", "--json", "--dry-run"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const parsed = JSON.parse(output) as { action: string; message: string };

    expect(parsed.action).toBe("release-skipped");
    expect(parsed.message).toContain("No untagged package release targets");
  });

  it("replays an already published legacy release instead of tagging the root", () => {
    const cwd = makeTempDir("versionary-cli-json-legacy-rerun-");
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const cliEntry = path.join(repoRoot, "src", "cli", "index.ts");

    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        packages: { "packages/a": { "release-type": "simple" } },
      }),
    );
    write(cwd, "version.txt", "9.9.9\n");
    write(cwd, "packages/a/version.txt", "1.1.0\n");
    write(
      cwd,
      ".versionary-manifest.json",
      `${JSON.stringify({
        "manifest-version": 1,
        "baseline-sha": "0000000000000000000000000000000000000000",
        "release-targets": [
          { path: "packages/a", version: "1.1.0", tag: "a-v1.1.0" },
        ],
        "pending-release-targets": [
          { path: "packages/a", version: "1.1.0", tag: "a-v1.1.0" },
        ],
      })}\n`,
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore(release): a-v1.1.0");
    git(cwd, "tag", "a-v1.1.0");

    const output = execFileSync(tsx, [cliEntry, "run", "--json", "--dry-run"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const parsed = JSON.parse(output) as {
      action: string;
      tagNames: string[];
    };

    expect(parsed.action).toBe("release-dry-run");
    expect(parsed.tagNames).toEqual(["a-v1.1.0"]);
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
