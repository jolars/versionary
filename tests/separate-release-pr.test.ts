import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareReleasePr,
  prepareSeparateReleasePrs,
} from "../src/release/pr.js";
import {
  getPackageStateDirectory,
  writePackageReleaseState,
} from "../src/release/state.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-separate-pr-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(cwd: string, relativePath: string, content: string): void {
  const target = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("separate release PR preparation", () => {
  it("prepares unrelated packages on separate branches without moving the caller", () => {
    const cwd = makeTempDir();
    git(cwd, "init", "-b", "main");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "simple",
        "monorepo-mode": "independent",
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
    git(cwd, "commit", "-m", "chore: initial");
    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: improve a");
    write(cwd, "packages/b/index.ts", "export const b = 2;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: repair b");
    const baseSha = git(cwd, "rev-parse", "HEAD");

    const prepared = prepareSeparateReleasePrs(cwd);

    expect(prepared.map((result) => result.packagePaths)).toEqual([
      ["packages/a"],
      ["packages/b"],
    ]);
    expect(git(cwd, "branch", "--show-current")).toBe("main");
    expect(git(cwd, "rev-parse", "HEAD")).toBe(baseSha);
    expect(git(cwd, "status", "--short")).toBe("");
    expect(new Set(prepared.map((result) => result.branch)).size).toBe(2);

    for (const result of prepared) {
      const packagePath = result.packagePaths[0];
      expect(packagePath).toBeDefined();
      const changed = git(
        cwd,
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        result.branch,
      ).split("\n");
      expect(changed).toContain(`${packagePath}/version.txt`);
      expect(changed).toContain(`${packagePath}/CHANGELOG.md`);
      expect(
        changed.some((file) =>
          file.startsWith(
            `${path.relative(cwd, getPackageStateDirectory(cwd))}/`,
          ),
        ),
      ).toBe(true);
      const otherPath =
        packagePath === "packages/a" ? "packages/b" : "packages/a";
      expect(changed.some((file) => file.startsWith(`${otherPath}/`))).toBe(
        false,
      );
    }
  });

  it("keeps follower packages in one atomic release cohort", () => {
    const cwd = makeTempDir();
    git(cwd, "init", "-b", "main");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "simple",
        "separate-release-prs": true,
        packages: {
          "packages/a": { "release-type": "simple" },
          "packages/b": {
            "release-type": "simple",
            follows: ["packages/a"],
          },
        },
      }),
    );
    for (const name of ["a", "b"]) {
      write(cwd, `packages/${name}/version.txt`, "1.0.0\n");
      write(cwd, `packages/${name}/CHANGELOG.md`, "# Changelog\n");
      write(cwd, `packages/${name}/index.ts`, `export const ${name} = 1;\n`);
    }
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: improve a");

    const prepared = prepareSeparateReleasePrs(cwd);

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.packagePaths).toEqual(["packages/a", "packages/b"]);
    expect(prepared[0]?.targets.map((target) => target.path)).toEqual([
      "packages/a",
      "packages/b",
    ]);
    const changed = git(
      cwd,
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      prepared[0]?.branch ?? "",
    ).split("\n");
    expect(changed).toContain("packages/a/version.txt");
    expect(changed).toContain("packages/b/version.txt");
  });

  it("groups packages whose strategies update one shared file", () => {
    const cwd = makeTempDir();
    git(cwd, "init", "-b", "main");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "node",
        "separate-release-prs": true,
        packages: {
          "packages/a": {},
          "packages/b": {},
        },
      }),
    );
    write(
      cwd,
      "package-lock.json",
      `${JSON.stringify({
        name: "workspace",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: { "": { name: "workspace", version: "1.0.0" } },
      })}\n`,
    );
    for (const name of ["a", "b"]) {
      write(
        cwd,
        `packages/${name}/package.json`,
        `${JSON.stringify({ name, version: "1.0.0" })}\n`,
      );
      write(cwd, `packages/${name}/CHANGELOG.md`, "# Changelog\n");
      write(cwd, `packages/${name}/index.ts`, `export const ${name} = 1;\n`);
    }
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    write(cwd, "packages/b/index.ts", "export const b = 2;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: update both packages");

    const prepared = prepareSeparateReleasePrs(cwd);

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.packagePaths).toEqual(["packages/a", "packages/b"]);
    expect(
      git(
        cwd,
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        prepared[0]?.branch ?? "",
      ).split("\n"),
    ).toContain("package-lock.json");
  });

  it("rejects duplicate release tags across separate cohorts", () => {
    const cwd = makeTempDir();
    git(cwd, "init", "-b", "main");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "simple",
        "separate-release-prs": true,
        packages: {
          "packages/a": {
            "release-type": "simple",
            "package-name": "shared",
          },
          "packages/b": {
            "release-type": "simple",
            "package-name": "shared",
          },
        },
      }),
    );
    for (const name of ["a", "b"]) {
      write(cwd, `packages/${name}/version.txt`, "1.0.0\n");
      write(cwd, `packages/${name}/CHANGELOG.md`, "# Changelog\n");
      write(cwd, `packages/${name}/index.ts`, `export const ${name} = 1;\n`);
    }
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    write(cwd, "packages/b/index.ts", "export const b = 2;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: update both packages");

    expect(() => prepareSeparateReleasePrs(cwd, { "dry-run": true })).toThrow(
      'Duplicate release tag "shared-v1.0.1" for packages "packages/a" and "packages/b".',
    );
  });

  it("preserves r-news formatting in a separate package release", () => {
    const cwd = makeTempDir();
    git(cwd, "init", "-b", "main");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "simple",
        "separate-release-prs": true,
        packages: {
          "packages/demo": { "release-type": "r" },
        },
      }),
    );
    write(
      cwd,
      "packages/demo/DESCRIPTION",
      ["Package: demo", "Type: Package", "Version: 1.1.0", ""].join("\n"),
    );
    write(
      cwd,
      "packages/demo/NEWS.md",
      [
        "# demo (development version)",
        "",
        "A hand-written highlight.",
        "",
        "# demo 1.1",
        "",
        "## Features",
        "",
        "- Initial release.",
        "",
      ].join("\n"),
    );
    write(cwd, "packages/demo/R/main.R", "main <- function() TRUE\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "demo-v1.1.0");
    write(cwd, "packages/demo/R/main.R", "main <- function() FALSE\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: improve demo");

    const [prepared] = prepareSeparateReleasePrs(cwd);
    const news = git(cwd, "show", `${prepared?.branch}:packages/demo/NEWS.md`);

    expect(news).toContain("# demo 1.2");
    expect(news).toContain("## Features");
    expect(news).toContain("A hand-written highlight.");
    expect(news).not.toContain("# Changelog");
    expect(news).not.toContain("# demo (development version)");
  });

  it("commits updated package sidecars after disabling separate release PRs", () => {
    const cwd = makeTempDir();
    git(cwd, "init", "-b", "main");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    const separateConfig = {
      version: 1,
      "release-type": "simple",
      "separate-release-prs": true,
      packages: {
        "packages/a": {
          "release-type": "simple",
          "package-name": "a",
        },
      },
    };
    write(cwd, "versionary.jsonc", JSON.stringify(separateConfig));
    write(cwd, "packages/a/version.txt", "1.0.0\n");
    write(cwd, "packages/a/CHANGELOG.md", "# Changelog\n");
    write(cwd, "packages/a/index.ts", "export const a = 1;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    const baselineSha = git(cwd, "rev-parse", "HEAD");
    git(cwd, "tag", "a-v1.0.0");
    writePackageReleaseState(
      cwd,
      baselineSha,
      [{ path: "packages/a", version: "1.0.0", tag: "a-v1.0.0" }],
      "versionary/release-a-111111111111",
    );
    git(cwd, "add", ".versionary-manifest.json.d");
    git(cwd, "commit", "-m", "chore: retain package release state");

    const { "separate-release-prs": _, ...legacyConfig } = separateConfig;
    write(cwd, "versionary.jsonc", JSON.stringify(legacyConfig));
    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: repair a");

    prepareReleasePr(cwd);

    const stateDirectory = path.relative(cwd, getPackageStateDirectory(cwd));
    const [stateFile] = fs.readdirSync(getPackageStateDirectory(cwd));
    expect(stateFile).toBeDefined();
    const statePath = path.posix.join(stateDirectory, stateFile ?? "");
    const committedState = JSON.parse(
      git(cwd, "show", `HEAD:${statePath}`),
    ) as { "release-target": { version: string; tag: string } };
    expect(committedState["release-target"]).toMatchObject({
      version: "1.0.1",
      tag: "a-v1.0.1",
    });
    expect(git(cwd, "status", "--short")).toBe("");
  });
});
