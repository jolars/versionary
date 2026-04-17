import { describe, expect, it } from "vitest";
import { resolveTargetChangelogFile } from "../src/release/release.js";
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
});
