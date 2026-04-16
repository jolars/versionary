import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readBaselineSha,
  readReleaseTargets,
  writeBaselineSha,
} from "../src/app/release/state.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-state-test-"));
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

describe("simple baseline state", () => {
  it("reads null when state file missing", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({ version: 1 }),
      "utf8",
    );
    expect(readBaselineSha(dir)).toBeNull();
  });

  it("writes and reads baseline sha", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({ version: 1 }),
      "utf8",
    );
    writeBaselineSha(dir, "abc123");
    expect(readBaselineSha(dir)).toBe("abc123");
    const manifestPath = path.join(dir, ".versionary-manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      "manifest-version"?: number;
    };
    expect(manifest["manifest-version"]).toBe(1);
  });

  it("throws on unsupported manifest-version", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({ version: 1 }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, ".versionary-manifest.json"),
      JSON.stringify({ "manifest-version": 2, "baseline-sha": "abc123" }),
      "utf8",
    );
    expect(() => readBaselineSha(dir)).toThrow(/Unsupported manifest-version/i);
  });

  it("retains prior release-targets when writing partial updates", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({ version: 1 }),
      "utf8",
    );
    writeBaselineSha(dir, "aaa111", [
      { path: ".", version: "2.35.0", tag: "v2.35.0" },
      {
        path: "crates/panache-parser",
        version: "0.3.1",
        tag: "panache-parser-v0.3.1",
      },
      { path: "editors/zed", version: "2.34.1", tag: "panache-zed-v2.34.1" },
    ]);

    writeBaselineSha(dir, "bbb222", [
      {
        path: "editors/code",
        version: "2.34.2",
        tag: "panache-code-v2.34.2",
      },
    ]);

    const targets = readReleaseTargets(dir);
    expect(targets).toEqual([
      { path: ".", version: "2.35.0", tag: "v2.35.0" },
      {
        path: "crates/panache-parser",
        version: "0.3.1",
        tag: "panache-parser-v0.3.1",
      },
      {
        path: "editors/code",
        version: "2.34.2",
        tag: "panache-code-v2.34.2",
      },
      { path: "editors/zed", version: "2.34.1", tag: "panache-zed-v2.34.1" },
    ]);
    expect(readBaselineSha(dir)).toBe("bbb222");
  });
});
