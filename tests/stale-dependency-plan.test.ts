import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReleasePlan } from "../src/release/plan.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-stale-dependency-test-"),
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

function crateManifest(
  name: string,
  version: string,
  options: {
    dependencies?: Array<{ name: string; path: string; version: string }>;
    publish?: string;
  } = {},
): string {
  const lines = ["[package]", `name = "${name}"`, `version = "${version}"`];
  if (options.publish !== undefined) {
    lines.push(`publish = ${options.publish}`);
  }
  const dependencies = options.dependencies ?? [];
  if (dependencies.length > 0) {
    lines.push("", "[dependencies]");
    for (const dependency of dependencies) {
      lines.push(
        `${dependency.name} = { path = "${dependency.path}", version = "${dependency.version}" }`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * A Rust workspace mirroring the shape from the original report: a library
 * crate whose manifest can drift without a release, and a dependent crate that
 * carries a version requirement on it.
 */
function setupWorkspace(
  packagePaths: string[],
  manifests: Record<string, string>,
): string {
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
  for (const [manifestPath, contents] of Object.entries(manifests)) {
    write(cwd, manifestPath, contents);
  }
  write(
    cwd,
    "versionary.jsonc",
    JSON.stringify({
      version: 1,
      "release-type": "rust",
      "review-mode": "direct",
      "changelog-file": "CHANGELOG.md",
      "monorepo-mode": "independent",
      packages: Object.fromEntries(
        packagePaths.map((packagePath) => [
          packagePath,
          { "release-type": "rust" },
        ]),
      ),
    }),
  );
  for (const packagePath of packagePaths) {
    write(cwd, `${packagePath}/src/lib.rs`, "pub fn initial() {}\n");
  }
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "chore: initial");
  git(cwd, "tag", "v0.1.0");
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

describe("stale published dependency planning", () => {
  it("forces a patch bump on a changed dependency when a dependent releases", () => {
    const cwd = setupWorkspace(["crates/a", "crates/b"], {
      "crates/a/Cargo.toml": crateManifest("crate-a", "0.1.0"),
      "crates/b/Cargo.toml": crateManifest("crate-b", "0.5.0", {
        dependencies: [{ name: "crate-a", path: "../a", version: "0.1.0" }],
      }),
    });

    // `refactor` maps to no release type, so crate-a would not enter the plan
    // on commit analysis alone.
    write(cwd, "crates/a/src/lib.rs", "pub fn refactored() {}\n");
    git(cwd, "add", "crates/a/src/lib.rs");
    git(cwd, "commit", "-m", "refactor: rework crate a internals");

    write(cwd, "crates/b/src/lib.rs", "pub fn feature() {}\n");
    git(cwd, "add", "crates/b/src/lib.rs");
    git(cwd, "commit", "-m", "feat: add crate b feature");

    const plan = createReleasePlan(cwd);
    const a = plan.packages?.find((pkg) => pkg.path === "crates/a");
    const b = plan.packages?.find((pkg) => pkg.path === "crates/b");

    expect(a?.releaseType).toBe("patch");
    expect(a?.nextVersion).toBe("0.1.1");
    expect(a?.bumpReason).toBe("stale-dependency");
    expect(b?.nextVersion).toBe("0.6.0");
    expect(b?.dependencySourcePaths).toEqual(["crates/a"]);
  });

  it("leaves a changed dependency alone when no dependent releases", () => {
    const cwd = setupWorkspace(["crates/a", "crates/b", "crates/c"], {
      "crates/a/Cargo.toml": crateManifest("crate-a", "0.1.0"),
      "crates/b/Cargo.toml": crateManifest("crate-b", "0.5.0", {
        dependencies: [{ name: "crate-a", path: "../a", version: "0.1.0" }],
      }),
      "crates/c/Cargo.toml": crateManifest("crate-c", "0.3.0"),
    });

    write(cwd, "crates/a/src/lib.rs", "pub fn refactored() {}\n");
    git(cwd, "add", "crates/a/src/lib.rs");
    git(cwd, "commit", "-m", "refactor: rework crate a internals");

    // crate-c releases but does not depend on crate-a, so crate-a's staleness
    // is not observable from anything being published.
    write(cwd, "crates/c/src/lib.rs", "pub fn feature() {}\n");
    git(cwd, "add", "crates/c/src/lib.rs");
    git(cwd, "commit", "-m", "feat: add crate c feature");

    const plan = createReleasePlan(cwd);
    const a = plan.packages?.find((pkg) => pkg.path === "crates/a");
    const c = plan.packages?.find((pkg) => pkg.path === "crates/c");

    expect(a?.releaseType).toBeNull();
    expect(a?.nextVersion).toBeNull();
    expect(a?.bumpReason).toBeUndefined();
    expect(c?.nextVersion).toBe("0.4.0");
  });

  it("leaves an unchanged dependency alone when a dependent releases", () => {
    const cwd = setupWorkspace(["crates/a", "crates/b"], {
      "crates/a/Cargo.toml": crateManifest("crate-a", "0.1.0"),
      "crates/b/Cargo.toml": crateManifest("crate-b", "0.5.0", {
        dependencies: [{ name: "crate-a", path: "../a", version: "0.1.0" }],
      }),
    });

    write(cwd, "crates/b/src/lib.rs", "pub fn feature() {}\n");
    git(cwd, "add", "crates/b/src/lib.rs");
    git(cwd, "commit", "-m", "feat: add crate b feature");

    const plan = createReleasePlan(cwd);
    const a = plan.packages?.find((pkg) => pkg.path === "crates/a");

    expect(a?.nextVersion).toBeNull();
  });

  it("reaches a stale dependency through an unchanged intermediate crate", () => {
    const cwd = setupWorkspace(["crates/a", "crates/b", "crates/c"], {
      "crates/a/Cargo.toml": crateManifest("crate-a", "0.1.0"),
      "crates/b/Cargo.toml": crateManifest("crate-b", "0.5.0", {
        dependencies: [{ name: "crate-a", path: "../a", version: "0.1.0" }],
      }),
      "crates/c/Cargo.toml": crateManifest("crate-c", "0.3.0", {
        dependencies: [{ name: "crate-b", path: "../b", version: "0.5.0" }],
      }),
    });

    write(cwd, "crates/a/src/lib.rs", "pub fn refactored() {}\n");
    git(cwd, "add", "crates/a/src/lib.rs");
    git(cwd, "commit", "-m", "refactor: rework crate a internals");

    write(cwd, "crates/c/src/lib.rs", "pub fn feature() {}\n");
    git(cwd, "add", "crates/c/src/lib.rs");
    git(cwd, "commit", "-m", "feat: add crate c feature");

    const plan = createReleasePlan(cwd);
    const a = plan.packages?.find((pkg) => pkg.path === "crates/a");
    const b = plan.packages?.find((pkg) => pkg.path === "crates/b");
    const c = plan.packages?.find((pkg) => pkg.path === "crates/c");

    // crate-a is stale and reachable from the releasing crate-c, so it bumps;
    // crate-b then has to bump because its requirement on crate-a is rewritten.
    expect(a?.bumpReason).toBe("stale-dependency");
    expect(a?.nextVersion).toBe("0.1.1");
    expect(b?.bumpReason).toBe("dependency-propagation");
    expect(b?.nextVersion).toBe("0.5.1");
    expect(b?.dependencySourcePaths).toEqual(["crates/a"]);
    expect(c?.nextVersion).toBe("0.4.0");
    expect(c?.dependencySourcePaths).toEqual(["crates/b"]);
  });

  it("exempts crates that are not published", () => {
    const cwd = setupWorkspace(["crates/a", "crates/b"], {
      "crates/a/Cargo.toml": crateManifest("crate-a", "0.1.0", {
        publish: "false",
      }),
      "crates/b/Cargo.toml": crateManifest("crate-b", "0.5.0", {
        dependencies: [{ name: "crate-a", path: "../a", version: "0.1.0" }],
      }),
    });

    write(cwd, "crates/a/src/lib.rs", "pub fn refactored() {}\n");
    git(cwd, "add", "crates/a/src/lib.rs");
    git(cwd, "commit", "-m", "refactor: rework crate a internals");

    write(cwd, "crates/b/src/lib.rs", "pub fn feature() {}\n");
    git(cwd, "add", "crates/b/src/lib.rs");
    git(cwd, "commit", "-m", "feat: add crate b feature");

    const plan = createReleasePlan(cwd);
    const a = plan.packages?.find((pkg) => pkg.path === "crates/a");

    expect(a?.nextVersion).toBeNull();
  });

  it("does not force a bump for an unpublished releasing dependent", () => {
    const cwd = setupWorkspace(["crates/a", "crates/b"], {
      "crates/a/Cargo.toml": crateManifest("crate-a", "0.1.0"),
      "crates/b/Cargo.toml": crateManifest("crate-b", "0.5.0", {
        publish: "false",
        dependencies: [{ name: "crate-a", path: "../a", version: "0.1.0" }],
      }),
    });

    write(cwd, "crates/a/src/lib.rs", "pub fn refactored() {}\n");
    git(cwd, "add", "crates/a/src/lib.rs");
    git(cwd, "commit", "-m", "refactor: rework crate a internals");

    write(cwd, "crates/b/src/lib.rs", "pub fn feature() {}\n");
    git(cwd, "add", "crates/b/src/lib.rs");
    git(cwd, "commit", "-m", "feat: add crate b feature");

    const plan = createReleasePlan(cwd);
    const a = plan.packages?.find((pkg) => pkg.path === "crates/a");

    expect(a?.nextVersion).toBeNull();
  });

  it("keeps the direct release type when the package also has releasable commits", () => {
    const cwd = setupWorkspace(["crates/a", "crates/b"], {
      "crates/a/Cargo.toml": crateManifest("crate-a", "0.1.0"),
      "crates/b/Cargo.toml": crateManifest("crate-b", "0.5.0", {
        dependencies: [{ name: "crate-a", path: "../a", version: "0.1.0" }],
      }),
    });

    write(cwd, "crates/a/src/lib.rs", "pub fn added() {}\n");
    git(cwd, "add", "crates/a/src/lib.rs");
    git(cwd, "commit", "-m", "feat: add crate a feature");

    write(cwd, "crates/b/src/lib.rs", "pub fn feature() {}\n");
    git(cwd, "add", "crates/b/src/lib.rs");
    git(cwd, "commit", "-m", "feat: add crate b feature");

    const plan = createReleasePlan(cwd);
    const a = plan.packages?.find((pkg) => pkg.path === "crates/a");

    expect(a?.bumpReason).toBe("direct");
    expect(a?.nextVersion).toBe("0.2.0");
  });

  it("does not fire for strategies without version-pinned sibling dependencies", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");

    write(cwd, "version.txt", "1.0.0\n");
    write(cwd, "packages/a/version.txt", "1.0.0\n");
    write(cwd, "packages/b/version.txt", "1.0.0\n");
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
    git(cwd, "commit", "-m", "refactor: rework package a");

    write(cwd, "packages/b/index.ts", "export const b = 2;\n");
    git(cwd, "add", "packages/b/index.ts");
    git(cwd, "commit", "-m", "feat: add package b feature");

    const plan = createReleasePlan(cwd);
    const a = plan.packages?.find((pkg) => pkg.path === "packages/a");

    expect(a?.nextVersion).toBeNull();
  });
});
