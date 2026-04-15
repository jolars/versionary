import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareSimpleReleasePr } from "../src/app/release/pr.js";
import { readReleaseTargets } from "../src/app/release/state.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-pr-package-test-"),
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

describe("release PR package version update", () => {
  it("updates root package.json version for node release-type", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "package.json",
      JSON.stringify(
        { name: "demo", version: "1.0.0", private: true },
        null,
        2,
      ) + "\n",
    );
    write(
      cwd,
      "package-lock.json",
      JSON.stringify(
        {
          name: "demo",
          version: "1.0.0",
          lockfileVersion: 3,
          requires: true,
          packages: {
            "": { name: "demo", version: "1.0.0" },
          },
        },
        null,
        2,
      ) + "\n",
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "node",
        "review-mode": "direct",
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

    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    ) as { version: string };
    expect(pkg.version).toBe("1.1.0");

    const lock = JSON.parse(
      fs.readFileSync(path.join(cwd, "package-lock.json"), "utf8"),
    ) as {
      version: string;
      packages?: Record<string, { version?: string }>;
    };
    expect(lock.version).toBe("1.1.0");
    expect(lock.packages?.[""]?.version).toBe("1.1.0");
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
      JSON.stringify(
        { name: "demo", version: "1.0.0", private: true },
        null,
        2,
      ) + "\n",
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

    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    ) as { version: string };
    expect(pkg.version).toBe("1.0.0");
  });

  it("does not update package.json for rust release-type", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "demo-rust"', 'version = "1.0.0"', ""].join("\n"),
    );
    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "package.json",
      JSON.stringify(
        { name: "demo", version: "1.0.0", private: true },
        null,
        2,
      ) + "\n",
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "rust",
        "review-mode": "direct",
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

    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    ) as { version: string };
    expect(pkg.version).toBe("1.0.0");
  });

  it("stores monorepo release targets in baseline state", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
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

    const result = prepareSimpleReleasePr(cwd);
    expect(result.plan.packages).toHaveLength(2);
    const targets = readReleaseTargets(cwd);
    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.path).sort()).toEqual([
      "packages/a",
      "packages/b",
    ]);
  });

  it("updates package-specific version files for mixed release strategies", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "9.9.9\n");
    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "Cargo.toml",
      [
        "[package]",
        'name = "root-rust"',
        'version = "2.34.0"',
        "",
        "[dependencies]",
        'panache-parser = { path = "crates/panache-parser", version = "0.3.0" }',
        "",
      ].join("\n"),
    );
    write(
      cwd,
      "crates/panache-parser/Cargo.toml",
      ["[package]", 'name = "panache-parser"', 'version = "0.3.0"', ""].join(
        "\n",
      ),
    );
    write(
      cwd,
      "editors/code/package.json",
      JSON.stringify({ name: "panache-code", version: "2.34.0" }, null, 2) +
        "\n",
    );
    write(
      cwd,
      "editors/zed/Cargo.toml",
      ["[package]", 'name = "zed_panache"', 'version = "2.32.1"', ""].join(
        "\n",
      ),
    );
    write(cwd, "editors/zed/extension.toml", 'version = "2.32.1"\n');
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        "release-type": "rust",
        "version-file": "Cargo.toml",
        "changelog-file": "CHANGELOG.md",
        "monorepo-mode": "independent",
        packages: {
          ".": {},
          "crates/panache-parser": {
            "release-type": "rust",
          },
          "editors/code": {
            "release-type": "node",
          },
          "editors/zed": {
            "release-type": "rust",
            "extra-files": [
              {
                type: "toml",
                path: "extension.toml",
                jsonpath: "$.version",
              },
            ],
          },
        },
      }),
    );

    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v2.34.0");

    write(cwd, "crates/panache-parser/lib.rs", "pub fn parser() {}\n");
    write(cwd, "editors/code/src/index.ts", "export const x = 1;\n");
    write(cwd, "editors/zed/src/lib.rs", "pub fn zed() {}\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: update panache components");

    const result = prepareSimpleReleasePr(cwd);
    expect(result.plan.packages).toHaveLength(4);

    const rootCargo = fs.readFileSync(path.join(cwd, "Cargo.toml"), "utf8");
    const parserCargo = fs.readFileSync(
      path.join(cwd, "crates/panache-parser/Cargo.toml"),
      "utf8",
    );
    const codePackage = JSON.parse(
      fs.readFileSync(path.join(cwd, "editors/code/package.json"), "utf8"),
    ) as { version: string };
    const zedCargo = fs.readFileSync(
      path.join(cwd, "editors/zed/Cargo.toml"),
      "utf8",
    );
    const zedExtension = fs.readFileSync(
      path.join(cwd, "editors/zed/extension.toml"),
      "utf8",
    );

    expect(rootCargo).toContain('version = "2.35.0"');
    expect(rootCargo).toContain(
      'panache-parser = { path = "crates/panache-parser", version = "0.4.0" }',
    );
    expect(parserCargo).toContain('version = "0.4.0"');
    expect(codePackage.version).toBe("2.35.0");
    expect(zedCargo).toContain('version = "2.33.0"');
    expect(zedExtension).toContain('version = "2.33.0"');
  });

  it("propagates rust dependency updates into non-target workspace crates", () => {
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
      "crates/internal/Cargo.toml",
      [
        "[package]",
        'name = "internal-only"',
        'version = "0.0.1"',
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
    write(cwd, "crates/internal/src/lib.rs", "pub fn internal() {}\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v0.1.0");

    write(cwd, "crates/a/src/lib.rs", "pub fn a2() {}\n");
    git(cwd, "add", "crates/a/src/lib.rs");
    git(cwd, "commit", "-m", "feat: update crate a");

    const result = prepareSimpleReleasePr(cwd);
    expect(result.plan.packages).toHaveLength(2);

    const aManifest = fs.readFileSync(
      path.join(cwd, "crates/a/Cargo.toml"),
      "utf8",
    );
    const bManifest = fs.readFileSync(
      path.join(cwd, "crates/b/Cargo.toml"),
      "utf8",
    );
    const internalManifest = fs.readFileSync(
      path.join(cwd, "crates/internal/Cargo.toml"),
      "utf8",
    );

    expect(aManifest).toContain('version = "0.2.0"');
    expect(bManifest).toContain('version = "0.5.1"');
    expect(bManifest).toContain(
      'crate-a = { path = "../a", version = "0.2.0" }',
    );
    expect(internalManifest).toContain(
      'crate-a = { path = "../a", version = "0.2.0" }',
    );
    expect(internalManifest).toContain('version = "0.0.1"');
  });
});
