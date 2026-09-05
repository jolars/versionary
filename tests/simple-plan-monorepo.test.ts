import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReleasePlan } from "../src/release/plan.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-monorepo-test-"),
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

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("simple monorepo planning", () => {
  it("creates independent package plans by path", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "monorepo-mode": "independent",
        packages: {
          "packages/a": {},
          "packages/b": {},
        },
      }),
    );
    write(cwd, "packages/a/index.ts", "export const a = 1;\n");
    write(cwd, "packages/b/index.ts", "export const b = 1;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    git(cwd, "add", "packages/a/index.ts");
    git(cwd, "commit", "-m", "feat: add package a feature");

    write(cwd, "packages/b/index.ts", "export const b = 2;\n");
    git(cwd, "add", "packages/b/index.ts");
    git(cwd, "commit", "-m", "fix: patch package b");

    const plan = createReleasePlan(cwd);
    expect(plan.packages).toHaveLength(2);
    const packageA = plan.packages?.find((pkg) => pkg.path === "packages/a");
    const packageB = plan.packages?.find((pkg) => pkg.path === "packages/b");
    expect(packageA?.releaseType).toBe("minor");
    expect(packageA?.nextVersion).toBe("1.1.0");
    expect(packageB?.releaseType).toBe("patch");
    expect(packageB?.nextVersion).toBe("1.0.1");
  });

  it("lets a package pre-major policy override the root across aliases", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "0.1.0\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "monorepo-mode": "independent",
        "allow-stable-major": true,
        packages: {
          "packages/a": {
            "bump-minor-pre-major": true,
          },
          "packages/b": {},
        },
      }),
    );
    write(cwd, "packages/a/index.ts", "export const a = 1;\n");
    write(cwd, "packages/b/index.ts", "export const b = 1;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v0.1.0");

    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    git(cwd, "add", "packages/a/index.ts");
    git(cwd, "commit", "-m", "feat!: break package a");

    write(cwd, "packages/b/index.ts", "export const b = 2;\n");
    git(cwd, "add", "packages/b/index.ts");
    git(cwd, "commit", "-m", "feat!: break package b");

    const plan = createReleasePlan(cwd);
    const packageA = plan.packages?.find((pkg) => pkg.path === "packages/a");
    const packageB = plan.packages?.find((pkg) => pkg.path === "packages/b");
    expect(packageA?.releaseType).toBe("major");
    expect(packageA?.nextVersion).toBe("0.2.0");
    expect(packageB?.releaseType).toBe("major");
    expect(packageB?.nextVersion).toBe("1.0.0");
  });

  it("uses one shared bump in fixed monorepo mode", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "2.0.0\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "monorepo-mode": "fixed",
        packages: {
          "packages/a": {},
          "packages/b": {},
        },
      }),
    );
    write(cwd, "packages/a/index.ts", "export const a = 1;\n");
    write(cwd, "packages/b/index.ts", "export const b = 1;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v2.0.0");

    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    git(cwd, "add", "packages/a/index.ts");
    git(cwd, "commit", "-m", "feat: add package a feature");

    write(cwd, "packages/b/index.ts", "export const b = 2;\n");
    git(cwd, "add", "packages/b/index.ts");
    git(cwd, "commit", "-m", "fix: patch package b");

    const plan = createReleasePlan(cwd);
    expect(plan.releaseType).toBe("minor");
    expect(plan.nextVersion).toBe("2.1.0");
    expect(plan.packages?.every((pkg) => pkg.releaseType === "minor")).toBe(
      true,
    );
    expect(plan.packages?.every((pkg) => pkg.nextVersion === "2.1.0")).toBe(
      true,
    );
  });

  it("uses only the root pre-major policy in fixed mode", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "0.4.2\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "monorepo-mode": "fixed",
        "bump-minor-pre-major": false,
        packages: {
          "packages/a": {
            "bump-minor-pre-major": true,
          },
          "packages/b": {},
        },
      }),
    );
    write(cwd, "packages/a/index.ts", "export const a = 1;\n");
    write(cwd, "packages/b/index.ts", "export const b = 1;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v0.4.2");

    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    git(cwd, "add", "packages/a/index.ts");
    git(cwd, "commit", "-m", "feat!: break package a");

    const plan = createReleasePlan(cwd);
    expect(plan.releaseType).toBe("major");
    expect(plan.nextVersion).toBe("1.0.0");
    expect(plan.packages?.every((pkg) => pkg.nextVersion === "1.0.0")).toBe(
      true,
    );
  });

  it("records dependencies added to a fixed-mode release", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(
      cwd,
      "crates/a-app/Cargo.toml",
      [
        "[package]",
        'name = "a-app"',
        'version = "1.0.0"',
        "",
        "[dependencies]",
        'z-core = { path = "../z-core", version = "1.0.0" }',
        "",
      ].join("\n"),
    );
    write(cwd, "crates/a-app/src/lib.rs", "pub fn app() {}\n");
    write(
      cwd,
      "crates/z-core/Cargo.toml",
      ["[package]", 'name = "z-core"', 'version = "1.0.0"', ""].join("\n"),
    );
    write(cwd, "crates/z-core/src/lib.rs", "pub fn core() {}\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "rust",
        "version-file": "Cargo.toml",
        "monorepo-mode": "fixed",
        packages: {
          "crates/a-app": {},
          "crates/z-core": {},
        },
      }),
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "crates/a-app/src/lib.rs", "pub fn app_v2() {}\n");
    git(cwd, "add", "crates/a-app/src/lib.rs");
    git(cwd, "commit", "-m", "feat: update app");

    const plan = createReleasePlan(cwd);
    const app = plan.packages?.find((pkg) => pkg.path === "crates/a-app");
    const core = plan.packages?.find((pkg) => pkg.path === "crates/z-core");
    expect(app?.nextVersion).toBe("1.1.0");
    expect(core?.nextVersion).toBe("1.1.0");
    expect(app?.dependencySourcePaths).toEqual(["crates/z-core"]);
  });

  it("auto-includes root for fixed-mode baseline without listing it in packages", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "2.0.0\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "monorepo-mode": "fixed",
        packages: {
          "packages/a": {},
          "packages/b": {},
        },
      }),
    );
    write(cwd, "packages/a/index.ts", "export const a = 1;\n");
    write(cwd, "packages/b/index.ts", "export const b = 1;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v2.0.0");

    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    git(cwd, "add", "packages/a/index.ts");
    git(cwd, "commit", "-m", "feat: add package a feature");

    const plan = createReleasePlan(cwd);
    expect(plan.currentVersion).toBe("2.0.0");
    expect(plan.nextVersion).toBe("2.1.0");
    expect(plan.packages?.find((pkg) => pkg.path === ".")).toBeUndefined();
  });

  it("uses per-package release tag as baseline when available", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "2.35.0\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "rust",
        "monorepo-mode": "independent",
        "version-file": "Cargo.toml",
        packages: {
          ".": {
            "exclude-paths": ["editors"],
          },
          "editors/code": {
            "release-type": "node",
            "package-name": "panache-code",
          },
        },
      }),
    );
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "root"', 'version = "2.35.0"', ""].join("\n"),
    );
    write(
      cwd,
      "editors/code/package.json",
      `${JSON.stringify(
        { name: "panache-code", version: "2.34.2", private: true },
        null,
        2,
      )}\n`,
    );
    write(cwd, "editors/code/src/index.ts", "export const v = 1;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v2.35.0");
    write(
      cwd,
      ".versionary-manifest.json",
      `${JSON.stringify(
        {
          "manifest-version": 1,
          "baseline-sha": "deadbeef",
          "release-targets": [
            { path: ".", version: "2.35.0", tag: "v2.35.0" },
            {
              path: "editors/code",
              version: "2.34.2",
              tag: "panache-code-v2.34.2",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    write(cwd, "editors/code/src/index.ts", "export const v = 2;\n");
    git(cwd, "add", "editors/code/src/index.ts");
    git(cwd, "commit", "-m", "fix(editors): trigger patch bump");
    git(cwd, "tag", "panache-code-v2.34.2");

    const plan = createReleasePlan(cwd);
    const editorsCode = plan.packages?.find(
      (pkg) => pkg.path === "editors/code",
    );
    expect(editorsCode?.releaseType).toBeNull();
    expect(editorsCode?.nextVersion).toBeNull();
    expect(editorsCode?.commits).toHaveLength(0);
  });

  it("falls back to latest tag when bootstrap-sha is stale", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "bootstrap-sha": "deadbeef",
        packages: {
          ".": {},
        },
      }),
    );
    write(cwd, "src/index.ts", "export const ok = true;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: first release commit");
    git(cwd, "tag", "v1.1.0");

    write(cwd, "src/index.ts", "export const ok = false;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: second release commit");

    const plan = createReleasePlan(cwd);
    expect(plan.releaseType).toBe("patch");
    expect(plan.nextVersion).toBe("1.0.1");
    expect(plan.commits).toHaveLength(1);
    expect(plan.commits[0]?.subject).toBe("fix: second release commit");
  });

  it("supports both pre-major policy aliases", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "0.4.2\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
      }),
    );
    write(cwd, "src/index.ts", "export const ok = true;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v0.4.2");

    write(cwd, "src/index.ts", "export const ok = false;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "feat!: breaking change");

    const defaultPlan = createReleasePlan(cwd);
    expect(defaultPlan.releaseType).toBe("major");
    expect(defaultPlan.nextVersion).toBe("0.5.0");

    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "bump-minor-pre-major": false,
      }),
    );
    expect(createReleasePlan(cwd).nextVersion).toBe("1.0.0");

    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "bump-minor-pre-major": true,
      }),
    );
    expect(createReleasePlan(cwd).nextVersion).toBe("0.5.0");

    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "allow-stable-major": true,
      }),
    );
    expect(createReleasePlan(cwd).nextVersion).toBe("1.0.0");

    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "allow-stable-major": false,
      }),
    );
    expect(createReleasePlan(cwd).nextVersion).toBe("0.5.0");
  });

  it("respects package exclude-paths when collecting commits", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "monorepo-mode": "independent",
        packages: {
          "packages/a": {
            "exclude-paths": ["generated"],
          },
        },
      }),
    );
    write(cwd, "packages/a/index.ts", "export const a = 1;\n");
    write(cwd, "packages/a/generated/data.json", '{ "ok": true }\n');
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "packages/a/generated/data.json", '{ "ok": false }\n');
    git(cwd, "add", "packages/a/generated/data.json");
    git(cwd, "commit", "-m", "feat: generated update");

    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    git(cwd, "add", "packages/a/index.ts");
    git(cwd, "commit", "-m", "fix: package source update");

    const plan = createReleasePlan(cwd);
    const packageA = plan.packages?.find((pkg) => pkg.path === "packages/a");
    expect(packageA?.releaseType).toBe("patch");
    expect(packageA?.commits.map((commit) => commit.subject)).toEqual([
      "fix: package source update",
    ]);
  });

  it("unions top-level exclude-paths with per-package exclude-paths", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "monorepo-mode": "independent",
        "exclude-paths": ["docs"],
        packages: {
          "packages/a": {
            "exclude-paths": ["generated"],
          },
        },
      }),
    );
    write(cwd, "packages/a/index.ts", "export const a = 1;\n");
    write(cwd, "packages/a/docs/readme.md", "# docs\n");
    write(cwd, "packages/a/generated/data.json", '{ "ok": true }\n');
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    // Excluded by the top-level list.
    write(cwd, "packages/a/docs/readme.md", "# docs updated\n");
    git(cwd, "add", "packages/a/docs/readme.md");
    git(cwd, "commit", "-m", "feat: docs update");

    // Excluded by the package's own list.
    write(cwd, "packages/a/generated/data.json", '{ "ok": false }\n');
    git(cwd, "add", "packages/a/generated/data.json");
    git(cwd, "commit", "-m", "feat: generated update");

    write(cwd, "packages/a/index.ts", "export const a = 2;\n");
    git(cwd, "add", "packages/a/index.ts");
    git(cwd, "commit", "-m", "fix: package source update");

    const plan = createReleasePlan(cwd);
    const packageA = plan.packages?.find((pkg) => pkg.path === "packages/a");
    expect(packageA?.releaseType).toBe("patch");
    expect(packageA?.commits.map((commit) => commit.subject)).toEqual([
      "fix: package source update",
    ]);
  });

  it("applies top-level exclude-paths to a single-package repository", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "exclude-paths": ["docs"],
      }),
    );
    write(cwd, "src/index.ts", "export const a = 1;\n");
    write(cwd, "docs/readme.md", "# docs\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "docs/readme.md", "# docs updated\n");
    git(cwd, "add", "docs/readme.md");
    git(cwd, "commit", "-m", "feat: docs update");

    write(cwd, "src/index.ts", "export const a = 2;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "fix: source update");

    const plan = createReleasePlan(cwd);
    expect(plan.releaseType).toBe("patch");
    expect(plan.commits.map((commit) => commit.subject)).toEqual([
      "fix: source update",
    ]);
  });

  it("marks dependent rust packages for patch bumps on dependency propagation", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "Cargo.toml",
      [
        "[package]",
        'name = "workspace-root"',
        'version = "0.1.0"',
        "",
        "[workspace]",
        'members = ["crates/*"]',
        "",
      ].join("\n"),
    );
    write(
      cwd,
      "crates/a/Cargo.toml",
      ["[package]", 'name = "crate-a"', 'version = "0.1.0"', ""].join("\n"),
    );
    write(
      cwd,
      "crates/b/Cargo.toml",
      [
        "[package]",
        'name = "crate-b"',
        'version = "0.5.0"',
        "",
        "[dependencies]",
        'crate-a = { path = "../a", version = "0.1.0" }',
        "",
      ].join("\n"),
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "rust",
        "review-mode": "direct",
        "changelog-file": "CHANGELOG.md",
        "monorepo-mode": "independent",
        packages: {
          "crates/a": {
            "release-type": "rust",
          },
          "crates/b": {
            "release-type": "rust",
          },
        },
      }),
    );
    write(cwd, "crates/a/src/lib.rs", "pub fn a() {}\n");
    write(cwd, "crates/b/src/lib.rs", "pub fn b() {}\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v0.1.0");

    write(cwd, "crates/a/src/lib.rs", "pub fn a2() {}\n");
    git(cwd, "add", "crates/a/src/lib.rs");
    git(cwd, "commit", "-m", "feat: update crate a");

    const plan = createReleasePlan(cwd);
    const a = plan.packages?.find((pkg) => pkg.path === "crates/a");
    const b = plan.packages?.find((pkg) => pkg.path === "crates/b");

    expect(a?.releaseType).toBe("minor");
    expect(a?.nextVersion).toBe("0.2.0");
    expect(b?.releaseType).toBe("patch");
    expect(b?.nextVersion).toBe("0.5.1");
  });

  it("does not mark cross-strategy packages for dependency propagation", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "Cargo.toml",
      [
        "[package]",
        'name = "workspace-root"',
        'version = "2.35.0"',
        "",
        "[workspace]",
        'members = ["crates/*"]',
        "",
      ].join("\n"),
    );
    write(
      cwd,
      "crates/core/Cargo.toml",
      ["[package]", 'name = "panache-core"', 'version = "2.35.0"', ""].join(
        "\n",
      ),
    );
    write(
      cwd,
      "editors/zed/Cargo.toml",
      ["[package]", 'name = "zed_panache"', 'version = "2.35.0"', ""].join(
        "\n",
      ),
    );
    write(cwd, "editors/zed/extension.toml", 'version = "2.35.0"\n');
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "rust",
        "review-mode": "direct",
        "changelog-file": "CHANGELOG.md",
        "monorepo-mode": "independent",
        packages: {
          ".": {
            "exclude-paths": ["editors"],
          },
          "crates/core": {
            "release-type": "rust",
          },
          "editors/zed": {
            "release-type": "rust",
            "package-name": "panache-zed",
            "extra-files": [
              {
                type: "toml",
                path: "extension.toml",
                "field-path": "$.version",
              },
            ],
          },
        },
      }),
    );
    write(cwd, "crates/core/src/lib.rs", "pub fn core() {}\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v2.35.0");

    write(cwd, "crates/core/src/lib.rs", "pub fn core_v2() {}\n");
    git(cwd, "add", "crates/core/src/lib.rs");
    git(cwd, "commit", "-m", "feat: update core");

    const plan = createReleasePlan(cwd);
    const zed = plan.packages?.find((pkg) => pkg.path === "editors/zed");
    expect(zed?.releaseType).toBeNull();
    expect(zed?.nextVersion).toBeNull();
  });

  it("bumps follower when followed source bumps", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "root"', 'version = "1.0.0"', ""].join("\n"),
    );
    write(
      cwd,
      "editors/code/package.json",
      `${JSON.stringify(
        { name: "panache-code", version: "1.0.0", private: true },
        null,
        2,
      )}\n`,
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "rust",
        "version-file": "Cargo.toml",
        "monorepo-mode": "independent",
        "allow-stable-major": true,
        packages: {
          ".": {
            "exclude-paths": ["editors"],
          },
          "editors/code": {
            "release-type": "node",
            "package-name": "panache-code",
            follows: ["."],
          },
        },
      }),
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "src/lib.rs", "pub fn root_v2() {}\n");
    git(cwd, "add", "src/lib.rs");
    git(cwd, "commit", "-m", "feat: add root feature");

    const plan = createReleasePlan(cwd);
    const root = plan.packages?.find((pkg) => pkg.path === ".");
    const editor = plan.packages?.find((pkg) => pkg.path === "editors/code");
    expect(root?.releaseType).toBe("minor");
    expect(root?.nextVersion).toBe("1.1.0");
    expect(editor?.releaseType).toBe("minor");
    expect(editor?.nextVersion).toBe("1.1.0");
    expect(editor?.bumpReason).toBe("follows");
    expect(editor?.dependencySourcePaths).toEqual(["."]);
    expect(editor?.commits).toHaveLength(0);
  });

  it("leaves follower untouched when followed source does not bump", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "root"', 'version = "1.0.0"', ""].join("\n"),
    );
    write(
      cwd,
      "editors/code/package.json",
      `${JSON.stringify(
        { name: "panache-code", version: "1.0.0", private: true },
        null,
        2,
      )}\n`,
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "rust",
        "version-file": "Cargo.toml",
        "monorepo-mode": "independent",
        "allow-stable-major": true,
        packages: {
          ".": {
            "exclude-paths": ["editors"],
          },
          "editors/code": {
            "release-type": "node",
            "package-name": "panache-code",
            follows: ["."],
          },
        },
      }),
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    const plan = createReleasePlan(cwd);
    const root = plan.packages?.find((pkg) => pkg.path === ".");
    const editor = plan.packages?.find((pkg) => pkg.path === "editors/code");
    expect(root?.nextVersion).toBeNull();
    expect(editor?.nextVersion).toBeNull();
    expect(editor?.bumpReason).toBeUndefined();
  });

  it("keeps follower's stronger own bump but lists source in dependencies", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "root"', 'version = "1.0.0"', ""].join("\n"),
    );
    write(
      cwd,
      "editors/code/package.json",
      `${JSON.stringify(
        { name: "panache-code", version: "1.0.0", private: true },
        null,
        2,
      )}\n`,
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "rust",
        "version-file": "Cargo.toml",
        "monorepo-mode": "independent",
        "allow-stable-major": true,
        packages: {
          ".": {
            "exclude-paths": ["editors"],
          },
          "editors/code": {
            "release-type": "node",
            "package-name": "panache-code",
            follows: ["."],
          },
        },
      }),
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "src/lib.rs", "pub fn root_v2() {}\n");
    git(cwd, "add", "src/lib.rs");
    git(cwd, "commit", "-m", "fix: small root fix");

    write(cwd, "editors/code/src/index.ts", "export const v = 1;\n");
    git(cwd, "add", "editors/code/src/index.ts");
    git(cwd, "commit", "-m", "feat(editors): editor feature");

    const plan = createReleasePlan(cwd);
    const editor = plan.packages?.find((pkg) => pkg.path === "editors/code");
    expect(editor?.releaseType).toBe("minor");
    expect(editor?.nextVersion).toBe("1.1.0");
    expect(editor?.bumpReason).toBe("direct");
    expect(editor?.dependencySourcePaths).toEqual(["."]);
  });

  it("upgrades follower's bump when source bumps stronger than own", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "root"', 'version = "1.0.0"', ""].join("\n"),
    );
    write(
      cwd,
      "editors/code/package.json",
      `${JSON.stringify(
        { name: "panache-code", version: "1.0.0", private: true },
        null,
        2,
      )}\n`,
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "rust",
        "version-file": "Cargo.toml",
        "monorepo-mode": "independent",
        "allow-stable-major": true,
        packages: {
          ".": {
            "exclude-paths": ["editors"],
          },
          "editors/code": {
            "release-type": "node",
            "package-name": "panache-code",
            follows: ["."],
          },
        },
      }),
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "src/lib.rs", "pub fn root_v2() {}\n");
    git(cwd, "add", "src/lib.rs");
    git(cwd, "commit", "-m", "feat!: breaking root change");

    write(cwd, "editors/code/src/index.ts", "export const v = 1;\n");
    git(cwd, "add", "editors/code/src/index.ts");
    git(cwd, "commit", "-m", "fix(editors): tiny editor fix");

    const plan = createReleasePlan(cwd);
    const editor = plan.packages?.find((pkg) => pkg.path === "editors/code");
    expect(editor?.releaseType).toBe("major");
    expect(editor?.nextVersion).toBe("2.0.0");
    expect(editor?.bumpReason).toBe("follows");
  });

  it("takes the strongest bump across multiple followed sources", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "root"', 'version = "1.0.0"', ""].join("\n"),
    );
    write(
      cwd,
      "packages/a/package.json",
      `${JSON.stringify(
        { name: "pkg-a", version: "1.0.0", private: true },
        null,
        2,
      )}\n`,
    );
    write(
      cwd,
      "packages/b/package.json",
      `${JSON.stringify(
        { name: "pkg-b", version: "1.0.0", private: true },
        null,
        2,
      )}\n`,
    );
    write(
      cwd,
      "packages/follower/package.json",
      `${JSON.stringify(
        { name: "pkg-follower", version: "1.0.0", private: true },
        null,
        2,
      )}\n`,
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "rust",
        "version-file": "Cargo.toml",
        "monorepo-mode": "independent",
        "allow-stable-major": true,
        packages: {
          ".": {
            "exclude-paths": ["packages"],
          },
          "packages/a": { "release-type": "node" },
          "packages/b": { "release-type": "node" },
          "packages/follower": {
            "release-type": "node",
            follows: ["packages/a", "packages/b"],
          },
        },
      }),
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "packages/a/index.ts", "export const a = 1;\n");
    git(cwd, "add", "packages/a/index.ts");
    git(cwd, "commit", "-m", "fix: patch a");

    write(cwd, "packages/b/index.ts", "export const b = 1;\n");
    git(cwd, "add", "packages/b/index.ts");
    git(cwd, "commit", "-m", "feat: minor b feature");

    const plan = createReleasePlan(cwd);
    const follower = plan.packages?.find(
      (pkg) => pkg.path === "packages/follower",
    );
    expect(follower?.releaseType).toBe("minor");
    expect(follower?.nextVersion).toBe("1.1.0");
    expect(follower?.bumpReason).toBe("follows");
    expect(follower?.dependencySourcePaths).toEqual([
      "packages/a",
      "packages/b",
    ]);
  });

  it("excludes nested paths for root package commit collection", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "2.35.0\n");
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "workspace-root"', 'version = "2.35.0"', ""].join(
        "\n",
      ),
    );
    write(
      cwd,
      "editors/zed/Cargo.toml",
      ["[package]", 'name = "zed_panache"', 'version = "2.35.0"', ""].join(
        "\n",
      ),
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "rust",
        "version-file": "Cargo.toml",
        "monorepo-mode": "independent",
        packages: {
          ".": {
            "exclude-paths": ["editors/zed"],
          },
          "editors/zed": {
            "release-type": "rust",
          },
        },
      }),
    );
    write(cwd, "editors/zed/src/lib.rs", "pub fn zed() {}\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v2.35.0");

    write(cwd, "editors/zed/src/lib.rs", "pub fn zed_v2() {}\n");
    git(cwd, "add", "editors/zed/src/lib.rs");
    git(cwd, "commit", "-m", "feat: zed-only feature");

    const plan = createReleasePlan(cwd);
    const root = plan.packages?.find((pkg) => pkg.path === ".");
    const zed = plan.packages?.find((pkg) => pkg.path === "editors/zed");

    expect(root?.releaseType).toBeNull();
    expect(root?.nextVersion).toBeNull();
    expect(zed?.releaseType).toBe("minor");
    expect(zed?.nextVersion).toBe("2.36.0");
  });
});
