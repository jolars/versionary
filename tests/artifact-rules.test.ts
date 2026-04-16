import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyConfiguredArtifactRules } from "../src/release/artifact-rules.js";
import type { SimplePlan } from "../src/release/plan.js";
import type { VersionaryConfig } from "../src/types/config.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-artifacts-test-"),
  );
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

function basePlan(pathName = "pkg", nextVersion = "1.2.3"): SimplePlan {
  return {
    mode: "simple",
    releaseType: "minor",
    currentVersion: "1.2.2",
    nextVersion,
    versionFile: "version.txt",
    changelogFile: "CHANGELOG.md",
    releaseBranchPrefix: "versionary/release",
    baselineSha: null,
    commits: [],
    packages: [
      {
        path: pathName,
        releaseType: "minor",
        currentVersion: "1.2.2",
        nextVersion,
        commits: [],
      },
    ],
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("artifact rules", () => {
  it("updates json/toml/yaml and regex targets", () => {
    const cwd = makeTempDir();
    write(cwd, "pkg/meta.json", '{\n  "version": "1.2.2"\n}\n');
    write(cwd, "pkg/config.toml", 'version = "1.2.2"\n');
    write(cwd, "pkg/config.yaml", "version: 1.2.2\n");
    write(cwd, "pkg/README.md", "Current version: v1.2.2\n");

    const config: VersionaryConfig = {
      version: 1,
      packages: {
        pkg: {
          "extra-files": [
            { type: "json", path: "meta.json", "field-path": "$.version" },
            { type: "toml", path: "config.toml", "field-path": "$.version" },
            { type: "yaml", path: "config.yaml", "field-path": "$.version" },
            {
              type: "regex",
              path: "README.md",
              pattern: "/v(\\d+\\.\\d+\\.\\d+)/",
            },
          ],
        },
      },
    };

    const updated = applyConfiguredArtifactRules(cwd, config, basePlan());
    expect(updated).toEqual([
      "pkg/config.toml",
      "pkg/config.yaml",
      "pkg/meta.json",
      "pkg/README.md",
    ]);
    expect(read(cwd, "pkg/meta.json")).toContain('"version": "1.2.3"');
    expect(read(cwd, "pkg/config.toml")).toContain('version = "1.2.3"');
    expect(read(cwd, "pkg/config.yaml")).toContain("version: 1.2.3");
    expect(read(cwd, "pkg/README.md")).toContain("v1.2.3");
  });

  it("preserves unrelated TOML formatting when updating top-level version", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "pkg/extension.toml",
      [
        'authors = ["Johan Larsson <johan@jolars.co>"]',
        'languages = ["Markdown", "Quarto", "RMarkdown"]',
        'version = "1.2.2"',
        "",
      ].join("\n"),
    );
    const config: VersionaryConfig = {
      version: 1,
      packages: {
        pkg: {
          "extra-files": [
            { type: "toml", path: "extension.toml", "field-path": "$.version" },
          ],
        },
      },
    };

    applyConfiguredArtifactRules(cwd, config, basePlan());
    const updated = read(cwd, "pkg/extension.toml");
    expect(updated).toContain('authors = ["Johan Larsson <johan@jolars.co>"]');
    expect(updated).toContain(
      'languages = ["Markdown", "Quarto", "RMarkdown"]',
    );
    expect(updated).toContain('version = "1.2.3"');
  });

  it("supports deprecated jsonpath alias for field-path", () => {
    const cwd = makeTempDir();
    write(cwd, "pkg/meta.json", '{\n  "version": "1.2.2"\n}\n');
    const config: VersionaryConfig = {
      version: 1,
      packages: {
        pkg: {
          "extra-files": [
            { type: "json", path: "meta.json", jsonpath: "$.version" },
          ],
        },
      },
    };

    applyConfiguredArtifactRules(cwd, config, basePlan());
    expect(read(cwd, "pkg/meta.json")).toContain('"version": "1.2.3"');
  });

  it("throws actionable errors on invalid paths and matches", () => {
    const cwd = makeTempDir();
    write(cwd, "pkg/file.txt", "v1.2.2 v1.2.2");

    const config: VersionaryConfig = {
      version: 1,
      packages: {
        pkg: {
          "extra-files": [
            {
              type: "regex",
              path: "missing.txt",
              pattern: "/v(\\d+\\.\\d+\\.\\d+)/",
            },
          ],
        },
      },
    };

    expect(() => applyConfiguredArtifactRules(cwd, config, basePlan())).toThrow(
      /Artifact rule target missing/,
    );

    const config2: VersionaryConfig = {
      version: 1,
      packages: {
        pkg: {
          "extra-files": [
            {
              type: "regex",
              path: "file.txt",
              pattern: "/v(\\d+\\.\\d+\\.\\d+)/",
            },
          ],
        },
      },
    };

    expect(() =>
      applyConfiguredArtifactRules(cwd, config2, basePlan()),
    ).toThrow(/must match exactly one occurrence/);
  });
});
