import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compositeVersionStrategy } from "../src/strategy/composite.js";
import { nodeVersionStrategy } from "../src/strategy/node.js";
import { pythonVersionStrategy } from "../src/strategy/python.js";
import { rustVersionStrategy } from "../src/strategy/rust.js";
import { simpleVersionStrategy } from "../src/strategy/simple.js";
import type {
  StrategyPackagePlanContext,
  VersionStrategy,
} from "../src/strategy/types.js";
import type { VersionaryConfig } from "../src/types/config.js";

const tempDirs: string[] = [];

function makeTempDir(suffix: string): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `versionary-composite-${suffix}-`),
  );
  tempDirs.push(dir);
  return dir;
}

function writeFile(cwd: string, relative: string, content: string): void {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function readFile(cwd: string, relative: string): string {
  return fs.readFileSync(path.join(cwd, relative), "utf8");
}

function cargoOnPath(): boolean {
  try {
    execFileSync("cargo", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

const baseConfig: VersionaryConfig = {
  version: 1,
  "release-type": ["python", "rust"],
};

describe("compositeVersionStrategy", () => {
  it("returns the inner strategy unchanged when given a single-element list", () => {
    expect(compositeVersionStrategy([pythonVersionStrategy])).toBe(
      pythonVersionStrategy,
    );
  });

  it("throws when constructed with no strategies", () => {
    expect(() => compositeVersionStrategy([])).toThrow(
      /at least one strategy/u,
    );
  });

  it("joins strategy names with '+'", () => {
    const composite = compositeVersionStrategy([
      pythonVersionStrategy,
      rustVersionStrategy,
    ]);
    expect(composite.name).toBe("python+rust");
  });

  it("getVersionFile returns the primary's version file", () => {
    const composite = compositeVersionStrategy([
      pythonVersionStrategy,
      rustVersionStrategy,
    ]);
    expect(composite.getVersionFile(baseConfig)).toBe("pyproject.toml");
  });

  it("readVersion delegates to the primary", () => {
    const composite = compositeVersionStrategy([
      pythonVersionStrategy,
      rustVersionStrategy,
    ]);
    const cwd = makeTempDir("read-primary");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[project]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    writeFile(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "demo"', 'version = "9.9.9"', ""].join("\n"),
    );
    expect(composite.readVersion(cwd, baseConfig)).toBe("1.0.0");
  });

  it("writeVersion fans out to every strategy and returns sorted, deduped paths", () => {
    const composite = compositeVersionStrategy([
      pythonVersionStrategy,
      rustVersionStrategy,
    ]);
    const cwd = makeTempDir("write-fanout");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[project]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    writeFile(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    const updated = composite.writeVersion(cwd, baseConfig, "1.1.0");
    expect(updated).toEqual(["Cargo.toml", "pyproject.toml"]);
    expect(readFile(cwd, "pyproject.toml")).toContain('version = "1.1.0"');
    expect(readFile(cwd, "Cargo.toml")).toContain('version = "1.1.0"');
  });

  it("scopes config['version-file'] to the primary; secondaries use their defaults", () => {
    const composite = compositeVersionStrategy([
      pythonVersionStrategy,
      rustVersionStrategy,
    ]);
    const cwd = makeTempDir("write-version-file-scope");
    writeFile(
      cwd,
      "src/demo/__init__.py",
      ['__version__ = "1.0.0"', ""].join("\n"),
    );
    writeFile(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    const updated = composite.writeVersion(
      cwd,
      {
        version: 1,
        "release-type": ["python", "rust"],
        "version-file": "src/demo/__init__.py",
      },
      "2.0.0",
    );
    expect(updated).toEqual(["Cargo.toml", "src/demo/__init__.py"]);
    expect(readFile(cwd, "src/demo/__init__.py")).toContain(
      '__version__ = "2.0.0"',
    );
    expect(readFile(cwd, "Cargo.toml")).toContain('version = "2.0.0"');
  });

  it("readPackageName uses the primary strategy", () => {
    const composite = compositeVersionStrategy([
      pythonVersionStrategy,
      rustVersionStrategy,
    ]);
    const cwd = makeTempDir("name-primary");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[project]", 'name = "demo-py"', 'version = "1.0.0"', ""].join("\n"),
    );
    writeFile(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "demo-rs"', 'version = "1.0.0"', ""].join("\n"),
    );
    expect(composite.readPackageName?.(cwd, baseConfig)).toBe("demo-py");
  });

  it("validateProject combines errors from every strategy", () => {
    const composite = compositeVersionStrategy([
      pythonVersionStrategy,
      rustVersionStrategy,
    ]);
    const cwd = makeTempDir("validate-combined");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[project]", 'name = "demo"', ""].join("\n"),
    );
    writeFile(cwd, "Cargo.toml", ["[package]", 'name = "demo"', ""].join("\n"));
    const result = composite.validateProject?.(cwd, baseConfig);
    expect(result).toMatch(/\[project\]\.version/u);
    expect(result).toMatch(/\[package\]\.version/u);
    expect((result ?? "").split("\n").length).toBeGreaterThanOrEqual(2);
  });

  it("validateProject returns null when no strategy reports an error", () => {
    const composite = compositeVersionStrategy([
      pythonVersionStrategy,
      rustVersionStrategy,
    ]);
    const cwd = makeTempDir("validate-clean");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[project]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    writeFile(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    expect(composite.validateProject?.(cwd, baseConfig)).toBeNull();
  });

  it("getDefaultChangelogFormat takes from the primary", () => {
    const stubMarkdown: VersionStrategy = {
      name: "stub-md",
      getVersionFile: () => "version.txt",
      readVersion: () => "0.0.0",
      writeVersion: () => [],
      getDefaultChangelogFormat: () => "markdown-changelog",
    };
    const stubRNews: VersionStrategy = {
      name: "stub-rnews",
      getVersionFile: () => "DESCRIPTION",
      readVersion: () => "0.0.0",
      writeVersion: () => [],
      getDefaultChangelogFormat: () => "r-news",
    };
    expect(
      compositeVersionStrategy([
        stubRNews,
        stubMarkdown,
      ]).getDefaultChangelogFormat?.(),
    ).toBe("r-news");
    expect(
      compositeVersionStrategy([
        stubMarkdown,
        stubRNews,
      ]).getDefaultChangelogFormat?.(),
    ).toBe("markdown-changelog");
  });

  it("propagateDependentPatchImpacts unions across strategies", () => {
    const stubA: VersionStrategy = {
      name: "stub-a",
      getVersionFile: () => "a.txt",
      readVersion: () => "0.0.0",
      writeVersion: () => [],
      propagateDependentPatchImpacts: () => ["pkg-a", "shared"],
    };
    const stubB: VersionStrategy = {
      name: "stub-b",
      getVersionFile: () => "b.txt",
      readVersion: () => "0.0.0",
      writeVersion: () => [],
      propagateDependentPatchImpacts: () => ["pkg-b", "shared"],
    };
    const composite = compositeVersionStrategy([stubA, stubB]);
    const packages: StrategyPackagePlanContext[] = [];
    expect(
      composite.propagateDependentPatchImpacts?.("/tmp", packages),
    ).toEqual(["pkg-a", "pkg-b", "shared"]);
  });

  it("rust.propagateDependentPatchImpacts ignores non-Cargo.toml versionFiles when used as a secondary", () => {
    const cwd = makeTempDir("rust-secondary-propagate");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[project]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    writeFile(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    const packages: StrategyPackagePlanContext[] = [
      {
        packagePath: ".",
        versionFile: "pyproject.toml",
        currentVersion: "1.0.0",
        nextVersion: "1.1.0",
      },
    ];
    expect(() =>
      rustVersionStrategy.propagateDependentPatchImpacts?.(cwd, packages),
    ).not.toThrow();
    expect(
      rustVersionStrategy.propagateDependentPatchImpacts?.(cwd, packages),
    ).toEqual([]);
  });

  it("does not expose optional hooks the underlying strategies do not implement", () => {
    const composite = compositeVersionStrategy([
      simpleVersionStrategy,
      simpleVersionStrategy,
    ]);
    expect(composite.readPackageName).toBeUndefined();
    expect(composite.getDefaultChangelogFormat).toBeUndefined();
    expect(composite.propagateDependentPatchImpacts).toBeUndefined();
    expect(composite.isPublishable).toBeUndefined();
    expect(composite.finalizeVersionWrites).toBeUndefined();
  });

  it("node.isPublishable reads the private flag from package.json", () => {
    const cwd = makeTempDir("node-publishable");
    writeFile(cwd, "package.json", '{ "name": "demo", "version": "1.0.0" }\n');
    writeFile(
      cwd,
      "apps/web/package.json",
      '{ "name": "web", "version": "1.0.0", "private": true }\n',
    );
    const check = (versionFile: string) =>
      nodeVersionStrategy.isPublishable?.(cwd, {
        packagePath: ".",
        versionFile,
        currentVersion: "1.0.0",
        nextVersion: null,
      });

    expect(check("package.json")).toBe(true);
    expect(check("apps/web/package.json")).toBe(false);
    // A version file node does not own carries no opinion.
    expect(check("Cargo.toml")).toBeUndefined();
  });

  it("isPublishable counts a package as published if any facet publishes it", () => {
    const cwd = makeTempDir("composite-publishable");
    writeFile(
      cwd,
      "package.json",
      '{ "name": "demo", "version": "1.0.0", "private": true }\n',
    );
    writeFile(
      cwd,
      "Cargo.toml",
      ["[package]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    const composite = compositeVersionStrategy([
      nodeVersionStrategy,
      rustVersionStrategy,
    ]);

    // node says no for package.json, rust abstains; the reverse holds for
    // Cargo.toml, where rust says yes.
    expect(
      composite.isPublishable?.(cwd, {
        packagePath: ".",
        versionFile: "package.json",
        currentVersion: "1.0.0",
        nextVersion: null,
      }),
    ).toBe(false);
    expect(
      composite.isPublishable?.(cwd, {
        packagePath: ".",
        versionFile: "Cargo.toml",
        currentVersion: "1.0.0",
        nextVersion: null,
      }),
    ).toBe(true);
  });

  it.runIf(cargoOnPath())(
    "PyO3-style cwd: writes pyproject.toml, Cargo.toml, and refreshes Cargo.lock",
    () => {
      const composite = compositeVersionStrategy([
        pythonVersionStrategy,
        rustVersionStrategy,
      ]);
      const cwd = makeTempDir("pyo3-end-to-end");
      writeFile(
        cwd,
        "pyproject.toml",
        [
          "[build-system]",
          'requires = ["maturin>=1.13,<2.0"]',
          'build-backend = "maturin"',
          "",
          "[project]",
          'name = "demo"',
          'version = "0.0.1"',
          "",
        ].join("\n"),
      );
      writeFile(
        cwd,
        "Cargo.toml",
        [
          "[package]",
          'name = "demo"',
          'version = "0.0.1"',
          'edition = "2021"',
          "",
          "[dependencies]",
          "",
        ].join("\n"),
      );
      writeFile(cwd, "src/lib.rs", "// stub\n");
      execFileSync("cargo", ["generate-lockfile"], { cwd, stdio: "ignore" });

      const updatedFromWrite = composite.writeVersion(cwd, baseConfig, "0.1.0");
      expect(updatedFromWrite).toContain("pyproject.toml");
      expect(updatedFromWrite).toContain("Cargo.toml");
      expect(readFile(cwd, "pyproject.toml")).toContain('version = "0.1.0"');
      expect(readFile(cwd, "Cargo.toml")).toContain('version = "0.1.0"');

      const finalized = composite.finalizeVersionWrites?.(
        cwd,
        [
          { packagePath: ".", versionFile: "pyproject.toml", version: "0.1.0" },
          { packagePath: ".", versionFile: "Cargo.toml", version: "0.1.0" },
        ],
        { releaseCommitSha: "abc", releaseDate: "2026-05-07" },
      );
      expect(finalized).toContain("Cargo.lock");
      expect(readFile(cwd, "Cargo.lock")).toContain("0.1.0");
    },
  );
});
