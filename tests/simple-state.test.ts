import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBaselineSha, writeBaselineSha } from "../src/simple/state.js";

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
    fs.writeFileSync(path.join(dir, "versionary.json"), JSON.stringify({ version: 1 }), "utf8");
    expect(readBaselineSha(dir)).toBeNull();
  });

  it("writes and reads baseline sha", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "versionary.json"), JSON.stringify({ version: 1 }), "utf8");
    writeBaselineSha(dir, "abc123");
    expect(readBaselineSha(dir)).toBe("abc123");
    const manifestPath = path.join(dir, ".versionary-manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
  });
});
