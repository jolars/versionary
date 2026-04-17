import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prependChangelog } from "../src/release/changelog.js";
import { prepareSimpleReleasePr } from "../src/release/pr.js";
import { readReleaseTargets } from "../src/release/state.js";

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

function writeExecutable(cwd: string, relative: string, content: string): void {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { encoding: "utf8", mode: 0o755 });
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
  it("preserves # Changelog heading when prepending markdown sections", () => {
    const cwd = makeTempDir();
    write(cwd, "CHANGELOG.md", "# Changelog\n\n");

    prependChangelog(
      cwd,
      "CHANGELOG.md",
      "## 1.0.1 (2026-04-16)\n\n### Bug Fixes\n- fix bug",
      "markdown-changelog",
    );

    const output = fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8");
    expect(output.startsWith("# Changelog\n\n")).toBe(true);
  });

  it("updates root package.json version for node release-type", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "package.json",
      `${JSON.stringify(
        { name: "demo", version: "1.0.0", private: true },
        null,
        2,
      )}\n`,
    );
    write(
      cwd,
      "package-lock.json",
      `${JSON.stringify(
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
      )}\n`,
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
    const releaseMessage = git(cwd, "log", "-1", "--pretty=%B");
    expect(releaseMessage).toContain("chore(release): v1.1.0");
    expect(releaseMessage).toContain("Versionary-Release: true");

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
      `${JSON.stringify(
        { name: "demo", version: "1.0.0", private: true },
        null,
        2,
      )}\n`,
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
      `${JSON.stringify(
        { name: "demo", version: "1.0.0", private: true },
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
    const releaseMessage = git(cwd, "log", "-1", "--pretty=%B");
    expect(releaseMessage).toContain(
      "chore(release): packages-a-v1.1.0 (+1 more)",
    );
    const targets = readReleaseTargets(cwd);
    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.path).sort()).toEqual([
      "packages/a",
      "packages/b",
    ]);
    expect(targets.map((target) => target.tag).sort()).toEqual([
      "packages-a-v1.1.0",
      "packages-b-v1.0.1",
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
                "field-path": "$.version",
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
    const targets = readReleaseTargets(cwd);

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
    expect(targets.map((target) => target.tag).sort()).toEqual([
      "panache-code-v2.35.0",
      "panache-parser-v0.4.0",
      "v2.35.0",
      "zed_panache-v2.33.0",
    ]);
  });

  it("uses package-name override for non-root release target tags", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "root"', 'version = "1.0.0"', ""].join("\n"),
    );
    write(
      cwd,
      "crates/parser/Cargo.toml",
      ["[package]", 'name = "parser-core"', 'version = "0.1.0"', ""].join("\n"),
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        "release-type": "rust",
        "version-file": "Cargo.toml",
        "changelog-file": "CHANGELOG.md",
        packages: {
          ".": {},
          "crates/parser": {
            "release-type": "rust",
            "package-name": "panache-parser",
          },
        },
      }),
    );
    write(cwd, "crates/parser/src/lib.rs", "pub fn parser() {}\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");
    write(cwd, "crates/parser/src/lib.rs", "pub fn parser_v2() {}\n");
    git(cwd, "add", "crates/parser/src/lib.rs");
    git(cwd, "commit", "-m", "feat: update parser");

    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/panache";
      prepareSimpleReleasePr(cwd);
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }
    const targets = readReleaseTargets(cwd);
    expect(targets.map((target) => target.tag).sort()).toEqual([
      "panache-parser-v0.2.0",
      "v1.1.0",
    ]);
  });

  it("uses package-local rust crate name when package release-type is inherited", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "panache"', 'version = "2.34.0"', ""].join("\n"),
    );
    write(
      cwd,
      "crates/panache-parser/Cargo.toml",
      ["[package]", 'name = "panache-parser"', 'version = "2.34.0"', ""].join(
        "\n",
      ),
    );
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
          "crates/panache-parser": {},
        },
      }),
    );
    write(cwd, "crates/panache-parser/src/lib.rs", "pub fn parser() {}\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v2.34.0");
    write(cwd, "crates/panache-parser/src/lib.rs", "pub fn parser_v2() {}\n");
    git(cwd, "add", "crates/panache-parser/src/lib.rs");
    git(cwd, "commit", "-m", "feat: update parser");

    prepareSimpleReleasePr(cwd);
    const targets = readReleaseTargets(cwd);
    expect(targets.map((target) => target.tag).sort()).toEqual([
      "panache-parser-v2.35.0",
      "v2.35.0",
    ]);
  });

  it("throws when resolved release target tags collide", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "a/package.json",
      `${JSON.stringify({ name: "shared", version: "1.0.0" })}\n`,
    );
    write(
      cwd,
      "b/package.json",
      `${JSON.stringify({ name: "shared", version: "1.0.0" })}\n`,
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        "monorepo-mode": "independent",
        packages: {
          a: { "release-type": "node" },
          b: { "release-type": "node" },
        },
      }),
    );
    write(cwd, "a/src/index.ts", "export const a = 1;\n");
    write(cwd, "b/src/index.ts", "export const b = 1;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");
    write(cwd, "a/src/index.ts", "export const a = 2;\n");
    git(cwd, "add", "a/src/index.ts");
    git(cwd, "commit", "-m", "feat: update a");
    write(cwd, "b/src/index.ts", "export const b = 2;\n");
    git(cwd, "add", "b/src/index.ts");
    git(cwd, "commit", "-m", "feat: update b");

    expect(() => prepareSimpleReleasePr(cwd)).toThrow(
      /Duplicate release tag "shared-v1\.1\.0"/,
    );
  });

  it("updates Cargo.lock when rust versions change and cargo is available", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    write(cwd, "Cargo.lock", "old-lock\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        "release-type": "rust",
        "changelog-file": "CHANGELOG.md",
      }),
    );
    write(cwd, "src/lib.rs", "pub fn demo() {}\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");
    write(cwd, "src/lib.rs", "pub fn demo2() {}\n");
    git(cwd, "add", "src/lib.rs");
    git(cwd, "commit", "-m", "feat: demo");

    const fakeBin = path.join(cwd, ".fake-bin");
    writeExecutable(
      cwd,
      ".fake-bin/cargo",
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'if [ "$1" = "generate-lockfile" ]; then',
        '  printf "new-lock\\n" > "$PWD/Cargo.lock"',
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
    );
    const prevPath = process.env.PATH ?? "";
    process.env.PATH = `${fakeBin}:${prevPath}`;
    try {
      prepareSimpleReleasePr(cwd);
    } finally {
      process.env.PATH = prevPath;
    }

    const lock = fs.readFileSync(path.join(cwd, "Cargo.lock"), "utf8");
    expect(lock).toBe("new-lock\n");
  });

  it("throws actionable error when Cargo.lock exists but cargo is unavailable", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    write(cwd, "Cargo.lock", "lock\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        "release-type": "rust",
        "changelog-file": "CHANGELOG.md",
      }),
    );
    write(cwd, "src/lib.rs", "pub fn demo() {}\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");
    write(cwd, "src/lib.rs", "pub fn demo2() {}\n");
    git(cwd, "add", "src/lib.rs");
    git(cwd, "commit", "-m", "feat: demo");

    const fakeBin = path.join(cwd, ".fake-bin");
    writeExecutable(
      cwd,
      ".fake-bin/cargo",
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "echo 'cargo not available' >&2",
        "exit 127",
        "",
      ].join("\n"),
    );
    const prevPath = process.env.PATH ?? "";
    process.env.PATH = `${fakeBin}:${prevPath}`;
    try {
      expect(() => prepareSimpleReleasePr(cwd)).toThrow(
        /Failed to refresh .*Cargo\.lock/i,
      );
    } finally {
      process.env.PATH = prevPath;
    }
  });

  it("refreshes nested Cargo.lock files in package directories", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "Cargo.toml",
      [
        "[workspace]",
        'members = ["crates/*", "editors/*"]',
        "",
        "[workspace.package]",
        'version = "1.0.0"',
        "",
      ].join("\n"),
    );
    write(
      cwd,
      "crates/panache-wasm/Cargo.toml",
      ["[package]", 'name = "panache-wasm"', 'version = "1.0.0"', ""].join(
        "\n",
      ),
    );
    write(cwd, "crates/panache-wasm/Cargo.lock", "old-wasm-lock\n");
    write(
      cwd,
      "editors/zed/Cargo.toml",
      ["[package]", 'name = "zed_panache"', 'version = "1.0.0"', ""].join("\n"),
    );
    write(cwd, "editors/zed/Cargo.lock", "old-zed-lock\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        "release-type": "rust",
        "changelog-file": "CHANGELOG.md",
        packages: {
          "crates/panache-wasm": { "release-type": "rust" },
          "editors/zed": { "release-type": "rust" },
        },
      }),
    );
    write(cwd, "crates/panache-wasm/src/lib.rs", "pub fn wasm() {}\n");
    write(cwd, "editors/zed/src/lib.rs", "pub fn zed() {}\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");
    write(cwd, "crates/panache-wasm/src/lib.rs", "pub fn wasm_v2() {}\n");
    git(cwd, "add", "crates/panache-wasm/src/lib.rs");
    git(cwd, "commit", "-m", "feat: update wasm crate");

    const fakeBin = path.join(cwd, ".fake-bin");
    writeExecutable(
      cwd,
      ".fake-bin/cargo",
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'if [ "$1" = "generate-lockfile" ]; then',
        '  printf "new-lock\\n" > "$PWD/Cargo.lock"',
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
    );
    const prevPath = process.env.PATH ?? "";
    process.env.PATH = `${fakeBin}:${prevPath}`;
    try {
      prepareSimpleReleasePr(cwd);
    } finally {
      process.env.PATH = prevPath;
    }

    const wasmLock = fs.readFileSync(
      path.join(cwd, "crates/panache-wasm/Cargo.lock"),
      "utf8",
    );
    const zedLock = fs.readFileSync(
      path.join(cwd, "editors/zed/Cargo.lock"),
      "utf8",
    );
    expect(wasmLock).toBe("new-lock\n");
    expect(zedLock).toBe("new-lock\n");
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

  it("supports package targets that inherit rust version from workspace.package", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "Cargo.toml",
      [
        "[workspace]",
        'members = ["crates/*"]',
        "",
        "[workspace.package]",
        'version = "0.8.0"',
        "",
      ].join("\n"),
    );
    write(
      cwd,
      "crates/core/Cargo.toml",
      ["[package]", 'name = "crate-core"', "version.workspace = true", ""].join(
        "\n",
      ),
    );
    write(
      cwd,
      "crates/util/Cargo.toml",
      [
        "[package]",
        'name = "crate-util"',
        "version.workspace = true",
        "",
        "[dependencies]",
        'crate-core = { path = "../core", version = "0.8.0" }',
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
          "crates/core": {
            "release-type": "rust",
          },
        },
      }),
    );
    write(cwd, "crates/core/src/lib.rs", "pub fn core() {}\n");
    write(cwd, "crates/util/src/lib.rs", "pub fn util() {}\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v0.8.0");

    write(cwd, "crates/core/src/lib.rs", "pub fn core_v2() {}\n");
    git(cwd, "add", "crates/core/src/lib.rs");
    git(cwd, "commit", "-m", "feat: update crate core");

    const result = prepareSimpleReleasePr(cwd);
    expect(result.plan.packages).toHaveLength(1);

    const workspaceManifest = fs.readFileSync(
      path.join(cwd, "Cargo.toml"),
      "utf8",
    );
    const coreManifest = fs.readFileSync(
      path.join(cwd, "crates/core/Cargo.toml"),
      "utf8",
    );
    const utilManifest = fs.readFileSync(
      path.join(cwd, "crates/util/Cargo.toml"),
      "utf8",
    );

    expect(workspaceManifest).toContain('version = "0.9.0"');
    expect(coreManifest).toContain("version.workspace = true");
    expect(utilManifest).toContain(
      'crate-core = { path = "../core", version = "0.9.0" }',
    );
  });

  it("updates package changelogs when package changelog-file is configured", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "editors/code/package.json",
      `${JSON.stringify({ name: "panache-code", version: "2.34.0" }, null, 2)}\n`,
    );
    write(cwd, "editors/code/CHANGELOG.md", "# Changelog\n\n");
    write(cwd, "editors/code/src/index.ts", "export const value = 1;\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        "changelog-file": "CHANGELOG.md",
        packages: {
          "editors/code": {
            "release-type": "node",
            "package-name": "panache-code",
            "changelog-file": "CHANGELOG.md",
          },
        },
      }),
    );

    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "panache-code-v2.34.0");
    write(cwd, "editors/code/src/index.ts", "export const value = 2;\n");
    git(cwd, "add", "editors/code/src/index.ts");
    git(cwd, "commit", "-m", "feat: add editor enhancement");

    prepareSimpleReleasePr(cwd);

    const rootChangelog = fs.readFileSync(
      path.join(cwd, "CHANGELOG.md"),
      "utf8",
    );
    const packageChangelog = fs.readFileSync(
      path.join(cwd, "editors/code/CHANGELOG.md"),
      "utf8",
    );
    expect(rootChangelog).toContain("## [2.35.0]");
    expect(packageChangelog).toContain(
      "/compare/panache-code-v2.34.0...panache-code-v2.35.0",
    );
    expect(packageChangelog).toContain("### Features");
    expect(packageChangelog).toContain("- add editor enhancement");
  });

  it("updates package changelogs using defaults when package changelog-file is not configured", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "crates/parser/Cargo.toml",
      ["[package]", 'name = "panache-parser"', 'version = "0.4.0"', ""].join(
        "\n",
      ),
    );
    write(cwd, "crates/parser/CHANGELOG.md", "# Changelog\n\n");
    write(cwd, "crates/parser/src/lib.rs", "pub fn parse() {}\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        "release-type": "rust",
        "changelog-file": "CHANGELOG.md",
        packages: {
          "crates/parser": {},
        },
      }),
    );

    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "panache-parser-v0.4.0");
    write(cwd, "crates/parser/src/lib.rs", "pub fn parse_v2() {}\n");
    git(cwd, "add", "crates/parser/src/lib.rs");
    git(cwd, "commit", "-m", "fix(parser): avoid panic");

    prepareSimpleReleasePr(cwd);

    const rootChangelog = fs.readFileSync(
      path.join(cwd, "CHANGELOG.md"),
      "utf8",
    );
    const packageChangelog = fs.readFileSync(
      path.join(cwd, "crates/parser/CHANGELOG.md"),
      "utf8",
    );
    expect(rootChangelog).toContain("## [0.4.1]");
    expect(packageChangelog).toContain(
      "/compare/panache-parser-v0.4.0...panache-parser-v0.4.1",
    );
    expect(packageChangelog).toContain("### Bug Fixes");
    expect(packageChangelog).toContain("avoid panic");
  });
});
