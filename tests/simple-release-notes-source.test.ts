import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractClosingReferencesFromNotes,
  resolveTargetChangelogFile,
  resolveTargetPackageName,
} from "../src/release/release.js";
import type { VersionaryConfig } from "../src/types/config.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-release-name-"),
  );
  tempDirs.push(dir);
  return dir;
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

describe("release notes changelog source", () => {
  it("uses root changelog for root target", () => {
    const config: VersionaryConfig = {
      version: 1,
      "changelog-file": "CHANGELOG.md",
      packages: {
        "packages/a": {
          "changelog-file": "CHANGELOG.md",
        },
      },
    };

    expect(resolveTargetChangelogFile(config, "CHANGELOG.md", ".")).toBe(
      "CHANGELOG.md",
    );
  });

  it("uses package changelog for package target when configured", () => {
    const config: VersionaryConfig = {
      version: 1,
      "changelog-file": "CHANGELOG.md",
      packages: {
        "editors/zed": {
          "changelog-file": "CHANGELOG.md",
        },
      },
    };

    expect(
      resolveTargetChangelogFile(config, "CHANGELOG.md", "editors/zed"),
    ).toBe("editors/zed/CHANGELOG.md");
  });

  it("defaults package target to package CHANGELOG.md when package changelog-file is not set", () => {
    const config: VersionaryConfig = {
      version: 1,
      "changelog-file": "CHANGELOG.md",
      packages: {
        "packages/a": {},
      },
    };

    expect(
      resolveTargetChangelogFile(config, "CHANGELOG.md", "packages/a"),
    ).toBe("packages/a/CHANGELOG.md");
  });

  it("reads the real package name for the root target via the node strategy", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "package.json",
      `${JSON.stringify({ name: "panache", version: "2.49.0" }, null, 2)}\n`,
    );
    const config: VersionaryConfig = {
      version: 1,
      "release-type": "node",
    };

    expect(resolveTargetPackageName(cwd, config, ".")).toBe("panache");
  });

  it("reads the real package name for a sub-package target", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "packages/formatter/package.json",
      `${JSON.stringify({ name: "panache-formatter", version: "0.7.0" }, null, 2)}\n`,
    );
    const config: VersionaryConfig = {
      version: 1,
      "release-type": "node",
      packages: {
        "packages/formatter": {},
      },
    };

    expect(resolveTargetPackageName(cwd, config, "packages/formatter")).toBe(
      "panache-formatter",
    );
  });

  it("prefers the explicit package-name override", () => {
    const cwd = makeTempDir();
    write(cwd, "version.txt", "1.0.0\n");
    const config: VersionaryConfig = {
      version: 1,
      packages: {
        ".": {
          "package-name": "custom",
        },
      },
    };

    expect(resolveTargetPackageName(cwd, config, ".")).toBe("custom");
  });

  it("returns undefined when the strategy cannot resolve a name", () => {
    const cwd = makeTempDir();
    write(cwd, "version.txt", "1.0.0\n");
    const config: VersionaryConfig = {
      version: 1,
    };

    expect(resolveTargetPackageName(cwd, config, ".")).toBeUndefined();
  });

  it("extracts closing issue and pull request references from release notes", () => {
    const notes = [
      "### Bug Fixes",
      "- parser fix ([`abc1234`](https://github.com/o/r/commit/abc1234)), closes [#171](https://github.com/o/r/issues/171)",
      "- include PR, fixes #172",
      "",
    ].join("\n");
    expect(extractClosingReferencesFromNotes(notes)).toEqual([171, 172]);
  });
});
