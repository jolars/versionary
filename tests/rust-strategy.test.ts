import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyRustWorkspaceDependencyUpdates,
  detectRustDependencyImpact,
  rustVersionStrategy,
} from "../src/domain/strategy/rust.js";

const tempDirs: string[] = [];
let sandboxCounter = 0;
const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "rust");
const sandboxRoot = path.join(
  process.cwd(),
  "tests",
  ".sandbox",
  "rust-strategy",
);

function makeTempDir(prefix = "manual"): string {
  sandboxCounter += 1;
  const dir = path.join(
    sandboxRoot,
    `${prefix}-${String(sandboxCounter).padStart(3, "0")}`,
  );
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.push(dir);
  return dir;
}

function write(cwd: string, relative: string, content: string): void {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function read(cwd: string, relative: string): string {
  return fs.readFileSync(path.join(cwd, relative), "utf8");
}

function useFixture(relative: string): string {
  const source = path.join(fixtureRoot, relative);
  const cwd = makeTempDir(`fixture-${relative.replaceAll("/", "-")}`);
  fs.cpSync(source, cwd, { recursive: true });
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

describe("rustVersionStrategy", () => {
  it("reads [package].version from Cargo.toml", () => {
    const cwd = useFixture("root-crate");

    const version = rustVersionStrategy.readVersion(cwd, {
      version: 1,
      "release-type": "rust",
    });
    expect(version).toBe("1.2.3");
  });

  it("writes [package].version in Cargo.toml deterministically", () => {
    const cwd = makeTempDir("root-inline");
    write(
      cwd,
      "Cargo.toml",
      [
        "[package]",
        'name = "demo"',
        'version = "1.2.3" # keep comment',
        "",
        "[dependencies]",
        'serde = "1"',
        "",
      ].join("\n"),
    );

    const updatedFiles = rustVersionStrategy.writeVersion(
      cwd,
      {
        version: 1,
        "release-type": "rust",
      },
      "2.0.0",
    );

    expect(updatedFiles).toEqual(["Cargo.toml"]);
    expect(fs.readFileSync(path.join(cwd, "Cargo.toml"), "utf8")).toBe(
      [
        "[package]",
        'name = "demo"',
        'version = "2.0.0" # keep comment',
        "",
        "[dependencies]",
        'serde = "1"',
        "",
      ].join("\n"),
    );
  });

  it("throws actionable error when [package].version is missing", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "Cargo.toml",
      [
        "[package]",
        'name = "demo"',
        "",
        "[dependencies]",
        'serde = "1"',
        "",
      ].join("\n"),
    );

    expect(() =>
      rustVersionStrategy.readVersion(cwd, {
        version: 1,
        "release-type": "rust",
      }),
    ).toThrow(/missing \[package\]\.version/i);
  });

  it("throws actionable error when [package].version is invalid", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "demo"', "version = 1", ""].join("\n"),
    );

    expect(() =>
      rustVersionStrategy.readVersion(cwd, {
        version: 1,
        "release-type": "rust",
      }),
    ).toThrow(/invalid \[package\]\.version/i);
  });

  it("throws actionable error when Cargo.toml has invalid syntax", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "Cargo.toml",
      ["[package", 'name = "demo"', 'version = "1.2.3"', ""].join("\n"),
    );

    expect(() =>
      rustVersionStrategy.readVersion(cwd, {
        version: 1,
        "release-type": "rust",
      }),
    ).toThrow(/failed to parse Cargo\.toml/i);
  });

  it("discovers workspace members deterministically and updates only Cargo.toml files", () => {
    const cwd = useFixture("workspace-panache-like");

    const updatedFiles = rustVersionStrategy.writeVersion(
      cwd,
      {
        version: 1,
        "release-type": "rust",
      },
      "1.2.3",
    );

    expect(updatedFiles).toEqual([
      "crates/core/Cargo.toml",
      "crates/util/Cargo.toml",
    ]);
    expect(read(cwd, "crates/core/Cargo.toml")).toContain('version = "1.2.3"');
    expect(read(cwd, "crates/util/Cargo.toml")).toContain('version = "1.2.3"');
    expect(JSON.parse(read(cwd, "apps/web/package.json")).version).toBe(
      "3.4.5",
    );
    expect(JSON.parse(read(cwd, "packages/ui/package.json")).version).toBe(
      "2.0.0",
    );
  });

  it("supports workspace glob members and resolves manifests in stable order", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "Cargo.toml",
      ["[workspace]", 'members = ["crates/*"]', ""].join("\n"),
    );
    write(
      cwd,
      "crates/zeta/Cargo.toml",
      ["[package]", 'name = "zeta"', 'version = "0.1.0"', ""].join("\n"),
    );
    write(
      cwd,
      "crates/alpha/Cargo.toml",
      ["[package]", 'name = "alpha"', 'version = "0.1.0"', ""].join("\n"),
    );

    const updatedFiles = rustVersionStrategy.writeVersion(
      cwd,
      {
        version: 1,
        "release-type": "rust",
      },
      "0.2.0",
    );

    expect(updatedFiles).toEqual([
      "crates/alpha/Cargo.toml",
      "crates/zeta/Cargo.toml",
    ]);
  });

  it("propagates internal crate dependency bumps across dependency tables", () => {
    const cwd = useFixture("workspace-panache-like");

    const updatedFiles = rustVersionStrategy.writeVersion(
      cwd,
      {
        version: 1,
        "release-type": "rust",
      },
      "0.2.0",
    );

    expect(updatedFiles).toEqual([
      "crates/core/Cargo.toml",
      "crates/util/Cargo.toml",
    ]);

    const coreManifest = read(cwd, "crates/core/Cargo.toml");
    const utilManifest = read(cwd, "crates/util/Cargo.toml");

    expect(coreManifest).toContain('version = "0.2.0"');
    expect(coreManifest).toContain('util-lib = "0.2.0"');
    expect(coreManifest).toContain('serde = "1"');
    expect(utilManifest).toContain('version = "0.2.0"');
    expect(utilManifest).toContain(
      'core-lib = { version = "0.2.0", features = ["std"] }',
    );
    expect(utilManifest).toContain('core-lib = "0.2.0"');
    expect(utilManifest).toContain(
      'core-lib = { version = "0.2.0", optional = true }',
    );
    expect(utilManifest).toContain(
      'core-lib = { version = "0.2.0", default-features = false }',
    );
    expect(utilManifest).toContain('reqwest = "0.12"');
  });

  it("bumps root crate in mixed workspace and keeps external deps unchanged", () => {
    const cwd = makeTempDir("root-workspace");
    write(
      cwd,
      "Cargo.toml",
      [
        "[package]",
        'name = "workspace-root"',
        'version = "0.4.0"',
        "",
        "[workspace]",
        'members = ["crates/*", "apps/*"]',
        "",
        "[dependencies]",
        'member-lib = "0.4.0"',
        'serde = "1"',
        "",
      ].join("\n"),
    );
    write(
      cwd,
      "crates/member/Cargo.toml",
      ["[package]", 'name = "member-lib"', 'version = "0.4.0"', ""].join("\n"),
    );
    write(
      cwd,
      "apps/web/package.json",
      '{ "name": "web", "version": "5.0.0" }\n',
    );

    const updatedFiles = rustVersionStrategy.writeVersion(
      cwd,
      {
        version: 1,
        "release-type": "rust",
      },
      "0.5.0",
    );

    expect(updatedFiles).toEqual(["Cargo.toml", "crates/member/Cargo.toml"]);
    const rootManifest = read(cwd, "Cargo.toml");
    expect(rootManifest).toContain('version = "0.5.0"');
    expect(rootManifest).toContain('member-lib = "0.5.0"');
    expect(rootManifest).toContain('serde = "1"');
    expect(JSON.parse(read(cwd, "apps/web/package.json")).version).toBe(
      "5.0.0",
    );
  });

  it("throws actionable error when rust version-file is not Cargo.toml", () => {
    const cwd = makeTempDir();
    write(cwd, "package.json", '{ "name": "web", "version": "1.0.0" }\n');

    expect(() =>
      rustVersionStrategy.readVersion(cwd, {
        version: 1,
        "release-type": "rust",
        "version-file": "package.json",
      }),
    ).toThrow(/requires "version-file" to point to a Cargo\.toml manifest/i);
  });

  it("throws actionable error when configured Cargo.toml is not a crate manifest", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "Cargo.toml",
      ["[workspace]", 'members = ["apps/web"]', ""].join("\n"),
    );
    write(
      cwd,
      "apps/web/package.json",
      '{ "name": "web", "version": "1.0.0" }\n',
    );

    expect(() =>
      rustVersionStrategy.readVersion(cwd, {
        version: 1,
        "release-type": "rust",
      }),
    ).toThrow(/is not a Rust crate manifest/i);
  });

  it("updates internal dependency versions for targeted package releases", () => {
    const cwd = useFixture("workspace-panache-like");

    const updatedFiles = applyRustWorkspaceDependencyUpdates(cwd, {
      "crates/core/Cargo.toml": "0.3.0",
      "crates/util/Cargo.toml": "0.2.0",
    });

    expect(updatedFiles).toEqual([
      "crates/core/Cargo.toml",
      "crates/util/Cargo.toml",
    ]);
    const coreManifest = read(cwd, "crates/core/Cargo.toml");
    const utilManifest = read(cwd, "crates/util/Cargo.toml");
    expect(coreManifest).toContain('util-lib = "0.2.0"');
    expect(utilManifest).toContain(
      'core-lib = { version = "0.3.0", features = ["std"] }',
    );
    expect(utilManifest).toContain('core-lib = "0.3.0"');
  });

  it("detects dependency impact for candidate manifests", () => {
    const cwd = useFixture("workspace-panache-like");

    const impacted = detectRustDependencyImpact(
      cwd,
      {
        "crates/core/Cargo.toml": "0.3.0",
      },
      ["crates/core/Cargo.toml", "crates/util/Cargo.toml"],
    );

    expect(impacted).toEqual(["crates/util/Cargo.toml"]);
  });
});
