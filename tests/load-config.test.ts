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
});
