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
      '{\n  // comment\n  "version": 1\n}\n',
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      '{ "version": 1 }\n',
      "utf8",
    );

    const found = findConfigFile(dir);
    expect(found?.format).toBe("jsonc");

    const loaded = loadConfig(dir);
    expect(loaded.config.version).toBe(1);
  });

  it("loads release-branch from canonical config", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        "release-branch": "release/please",
      }),
      "utf8",
    );

    const loaded = loadConfig(dir);
    expect(loaded.config["release-branch"]).toBe("release/please");
  });

  it("loads manifest-style top-level knobs", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.jsonc"),
      JSON.stringify({
        version: 1,
        "bootstrap-sha": "abc123",
        "bump-minor-pre-major": true,
        "allow-stable-major": true,
        "include-commit-authors": true,
        "release-type": "node",
      }),
      "utf8",
    );

    const loaded = loadConfig(dir);
    expect(loaded.config["bootstrap-sha"]).toBe("abc123");
    expect(loaded.config["bump-minor-pre-major"]).toBe(true);
    expect(loaded.config["allow-stable-major"]).toBe(true);
    expect(loaded.config["include-commit-authors"]).toBe(true);
    expect(loaded.config["release-type"]).toBe("node");
  });

  it("loads manifest-style packages object", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        packages: {
          ".": {
            "exclude-paths": ["crates", "editors"],
          },
          "editors/zed": {
            "release-type": "rust",
            "package-name": "panache-zed",
            "extra-files": [
              { type: "toml", path: "extension.toml", jsonpath: "$.version" },
            ],
          },
        },
      }),
      "utf8",
    );

    const loaded = loadConfig(dir);
    expect(Object.keys(loaded.config.packages ?? {})).toHaveLength(2);
    expect(loaded.config.packages?.["."]).toEqual({
      "exclude-paths": ["crates", "editors"],
    });
    expect(loaded.config.packages?.["editors/zed"]).toEqual({
      "release-type": "rust",
      "package-name": "panache-zed",
      "extra-files": [
        { type: "toml", path: "extension.toml", jsonpath: "$.version" },
      ],
    });
  });

  it("validates artifact rules by type-specific required fields", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        packages: {
          ".": {
            "extra-files": [{ type: "json", path: "package.json" }],
          },
        },
      }),
      "utf8",
    );
    expect(() => loadConfig(dir)).toThrow(/json artifact rules require/i);

    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        packages: {
          ".": {
            "extra-files": [
              {
                type: "regex",
                path: "README.md",
                jsonpath: "$.version",
                pattern: "/v(\\d+\\.\\d+\\.\\d+)/",
              },
            ],
          },
        },
      }),
      "utf8",
    );
    expect(() => loadConfig(dir)).toThrow(
      /regex artifact rules do not support/i,
    );
  });

  it("rejects unknown top-level and package keys", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        unknown: true,
      }),
      "utf8",
    );
    expect(() => loadConfig(dir)).toThrow(/unrecognized key/i);

    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        packages: {
          ".": {
            unknown: true,
          },
        },
      }),
      "utf8",
    );
    expect(() => loadConfig(dir)).toThrow(/unrecognized key/i);
  });
});
