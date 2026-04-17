import { describe, expect, it } from "vitest";
import {
  extractClosingReferencesFromNotes,
  resolveTargetChangelogFile,
} from "../src/release/release.js";
import type { VersionaryConfig } from "../src/types/config.js";

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
