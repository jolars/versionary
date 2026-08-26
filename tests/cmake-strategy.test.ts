import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cmakeVersionStrategy } from "../src/strategy/cmake.js";
import type { VersionaryConfig } from "../src/types/config.js";

const config: VersionaryConfig = { version: 1, "release-type": "cmake" };
const tempDirs: string[] = [];

function makeProject(content: string): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-cmake-"));
  tempDirs.push(cwd);
  fs.writeFileSync(path.join(cwd, "CMakeLists.txt"), content, "utf8");
  return cwd;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cmakeVersionStrategy", () => {
  it("handles multiline declarations, comments, keyword ordering, and command casing", () => {
    const original = [
      "PROJECT(",
      "  slope # The release target.",
      "  LANGUAGES CXX",
      "  # Keep the version in this declaration.",
      "  VERSION 6.5.0.1",
      ")",
      "",
    ].join("\n");
    const cwd = makeProject(original);

    expect(cmakeVersionStrategy.readVersion(cwd, config)).toBe("6.5.0.1");
    expect(cmakeVersionStrategy.readPackageName?.(cwd, config)).toBe("slope");

    expect(cmakeVersionStrategy.writeVersion(cwd, config, "6.6.0")).toEqual([
      "CMakeLists.txt",
    ]);
    expect(fs.readFileSync(path.join(cwd, "CMakeLists.txt"), "utf8")).toBe(
      original.replace("VERSION 6.5.0.1", "VERSION 6.6.0"),
    );
  });

  it("ignores commented-out declarations and VERSION text in strings", () => {
    const cwd = makeProject(
      [
        "# project(fake VERSION 1.0.0)",
        "#[=[",
        "project(also_fake VERSION 2.0.0)",
        "]=]",
        'message("project(quoted VERSION 3.0.0)")',
        "project(real VERSION 4.0.0 LANGUAGES C)",
        "",
      ].join("\n"),
    );

    expect(cmakeVersionStrategy.readVersion(cwd, config)).toBe("4.0.0");
    expect(cmakeVersionStrategy.readPackageName?.(cwd, config)).toBe("real");
  });

  it("supports a configured CMake file", () => {
    const cwd = makeProject("project(root VERSION 1.0.0)\n");
    fs.writeFileSync(
      path.join(cwd, "ProjectVersion.cmake"),
      "project(nested VERSION 2.3.4)\n",
      "utf8",
    );
    const customConfig: VersionaryConfig = {
      ...config,
      "version-file": "ProjectVersion.cmake",
    };

    expect(cmakeVersionStrategy.readVersion(cwd, customConfig)).toBe("2.3.4");
    expect(cmakeVersionStrategy.readPackageName?.(cwd, customConfig)).toBe(
      "nested",
    );
    expect(
      cmakeVersionStrategy.writeVersion(cwd, customConfig, "2.4.0"),
    ).toEqual(["ProjectVersion.cmake"]);
    expect(cmakeVersionStrategy.readVersion(cwd, customConfig)).toBe("2.4.0");
    expect(fs.readFileSync(path.join(cwd, "CMakeLists.txt"), "utf8")).toBe(
      "project(root VERSION 1.0.0)\n",
    );
  });

  it("preserves quotes around a literal version", () => {
    const cwd = makeProject('project(demo VERSION "1.2.3")\n');

    cmakeVersionStrategy.writeVersion(cwd, config, "1.3.0");

    expect(fs.readFileSync(path.join(cwd, "CMakeLists.txt"), "utf8")).toBe(
      'project(demo VERSION "1.3.0")\n',
    );
  });

  it("rejects variable-based versions", () => {
    const cwd = makeProject(
      `set(PROJECT_VERSION 1.2.3)\nproject(demo VERSION ${"$"}{PROJECT_VERSION})\n`,
    );

    expect(() => cmakeVersionStrategy.readVersion(cwd, config)).toThrow(
      /literal VERSION argument/i,
    );
  });

  it("rejects prerelease and build versions when writing", () => {
    const cwd = makeProject("project(demo VERSION 1.2.3)\n");

    expect(() =>
      cmakeVersionStrategy.writeVersion(cwd, config, "2.0.0-rc.1"),
    ).toThrow(/cannot write version/i);
    expect(() =>
      cmakeVersionStrategy.writeVersion(cwd, config, "2.0.0+build.1"),
    ).toThrow(/cannot write version/i);
  });

  it("rejects multiple version-bearing project declarations", () => {
    const cwd = makeProject(
      [
        "project(first VERSION 1.0.0)",
        "project(second VERSION 2.0.0)",
        "",
      ].join("\n"),
    );

    expect(() => cmakeVersionStrategy.readVersion(cwd, config)).toThrow(
      /exactly one project\(\).*VERSION/i,
    );
  });

  it("reports parser failures through strategy validation", () => {
    const validCwd = makeProject("project(demo VERSION 1.2.3)\n");
    const invalidCwd = makeProject("project(demo LANGUAGES CXX)\n");

    expect(cmakeVersionStrategy.validateProject?.(validCwd, config)).toBeNull();
    expect(cmakeVersionStrategy.validateProject?.(invalidCwd, config)).toMatch(
      /literal VERSION argument/i,
    );
  });

  it("returns null when the project name is not a literal", () => {
    const cwd = makeProject(`project(${"$"}{PROJECT_NAME} VERSION 1.2.3)\n`);

    expect(cmakeVersionStrategy.readPackageName?.(cwd, config)).toBeNull();
  });
});
