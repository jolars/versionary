import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findConfigFile, loadConfig } from "../src/config/load-config.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("config loading", () => {
  it("prefers versionary.jsonc", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.jsonc"),
      "{\n  // comment\n  \"version\": 1\n}\n",
      "utf8",
    );
    fs.writeFileSync(path.join(dir, "versionary.config.toml"), "version = 1\n", "utf8");

    const found = findConfigFile(dir);
    expect(found?.format).toBe("jsonc");

    const loaded = loadConfig(dir);
    expect(loaded.config.version).toBe(1);
  });

  it("loads TOML config", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "versionary.toml"), "version = 1\n", "utf8");

    const loaded = loadConfig(dir);
    expect(loaded.format).toBe("toml");
    expect(loaded.config.version).toBe(1);
  });

  it("loads simple.releaseBranchPrefix", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        mode: "simple",
        simple: {
          releaseBranchPrefix: "release/please",
        },
      }),
      "utf8",
    );

    const loaded = loadConfig(dir);
    expect(loaded.config.simple?.releaseBranchPrefix).toBe("release/please");
  });

  it("normalizes release-please style plugin and bootstrap aliases", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.jsonc"),
      JSON.stringify({
        version: 1,
        mode: "simple",
        plugins: ["npm"],
        "bootstrap-sha": "abc123",
        "bump-minor-pre-major": true,
        "include-commit-authors": true,
        "release-type": "node",
      }),
      "utf8",
    );

    const loaded = loadConfig(dir);
    expect(loaded.config.plugins?.[0]?.name).toBe("npm");
    expect(loaded.config.history?.bootstrap?.sha).toBe("abc123");
    expect(loaded.config.defaults?.versioning?.bumpMinorPreMajor).toBe(true);
    expect(loaded.config.defaults?.changelog?.includeAuthors).toBe(true);
    expect(loaded.config.defaults?.strategy).toBe("node");
  });

  it("normalizes manifest-style packages object", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        mode: "simple",
        packages: {
          ".": {
            "exclude-paths": ["crates", "editors"],
          },
          "editors/zed": {
            "release-type": "rust",
            "package-name": "panache-zed",
            "extra-files": [{ type: "toml", path: "extension.toml", jsonpath: "$.version" }],
          },
        },
      }),
      "utf8",
    );

    const loaded = loadConfig(dir);
    expect(loaded.config.packages).toHaveLength(2);
    expect(loaded.config.packages?.[0]).toEqual({
      path: ".",
      excludePaths: ["crates", "editors"],
    });
    expect(loaded.config.packages?.[1]).toEqual({
      path: "editors/zed",
      strategy: "rust",
      packageName: "panache-zed",
      artifacts: [{ file: "extension.toml", format: "toml", path: "$.version" }],
    });
  });
});
