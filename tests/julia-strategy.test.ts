import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { juliaVersionStrategy } from "../src/strategy/julia.js";
import type { VersionaryConfig } from "../src/types/config.js";

const config: VersionaryConfig = { version: 1, "release-type": "julia" };

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-julia-test-"));
  tempDirs.push(dir);
  return dir;
}

function write(cwd: string, relative: string, content: string): void {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function projectToml(version: string): string {
  return [
    'name = "Demo"',
    'uuid = "7876af07-990d-54b4-ab0e-23690620f79a"',
    'authors = ["Octavia <octavia@example.com>"]',
    `version = "${version}"`,
    "",
    "[deps]",
    'JSON = "682c06a0-de6a-54ab-a142-c8b1cf79cde6"',
    "",
    "[compat]",
    'julia = "1.6"',
    "",
  ].join("\n");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("juliaVersionStrategy", () => {
  it("defaults version-file to Project.toml", () => {
    expect(juliaVersionStrategy.getVersionFile(config)).toBe("Project.toml");
  });

  it("reads the root version from Project.toml", () => {
    const cwd = makeTempDir();
    write(cwd, "Project.toml", projectToml("0.1.0"));
    expect(juliaVersionStrategy.readVersion(cwd, config)).toBe("0.1.0");
  });

  it("updates the root version while leaving sections untouched", () => {
    const cwd = makeTempDir();
    write(cwd, "Project.toml", projectToml("0.1.0"));
    const updatedFiles = juliaVersionStrategy.writeVersion(
      cwd,
      config,
      "0.2.0",
    );
    expect(updatedFiles).toEqual(["Project.toml"]);
    const next = fs.readFileSync(path.join(cwd, "Project.toml"), "utf8");
    expect(next).toContain('version = "0.2.0"');
    expect(next).toContain('JSON = "682c06a0-de6a-54ab-a142-c8b1cf79cde6"');
    expect(next).toContain('julia = "1.6"');
    expect(juliaVersionStrategy.readVersion(cwd, config)).toBe("0.2.0");
  });

  it("does not treat a version key inside a section as the root version", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "Project.toml",
      [
        'name = "Demo"',
        'version = "0.1.0"',
        "",
        "[extras]",
        'version = "9.9.9"',
        "",
      ].join("\n"),
    );
    juliaVersionStrategy.writeVersion(cwd, config, "0.2.0");
    const next = fs.readFileSync(path.join(cwd, "Project.toml"), "utf8");
    expect(next).toContain('version = "0.2.0"');
    expect(next).toContain('version = "9.9.9"');
    expect(juliaVersionStrategy.readVersion(cwd, config)).toBe("0.2.0");
  });

  it("reads the package name from the root name field", () => {
    const cwd = makeTempDir();
    write(cwd, "Project.toml", projectToml("0.1.0"));
    expect(juliaVersionStrategy.readPackageName?.(cwd, config)).toBe("Demo");
  });

  it("throws when Project.toml is missing", () => {
    const cwd = makeTempDir();
    expect(() => juliaVersionStrategy.readVersion(cwd, config)).toThrow(
      "Versionary requires Project.toml to exist.",
    );
  });

  it("throws an actionable error when the root version is missing", () => {
    const cwd = makeTempDir();
    write(cwd, "Project.toml", ['name = "Demo"', "", "[deps]", ""].join("\n"));
    expect(() => juliaVersionStrategy.readVersion(cwd, config)).toThrow(
      /missing a valid root "version" field/i,
    );
  });

  it("reports no validation error when Project.toml is absent", () => {
    const cwd = makeTempDir();
    expect(juliaVersionStrategy.validateProject?.(cwd, config)).toBeNull();
  });
});
