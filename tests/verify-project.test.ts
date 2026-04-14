import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyProject } from "../src/verify/verify-project.js";

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

describe("verifyProject", () => {
  it("passes when package paths exist", () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "crates"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        packages: [{ path: "crates" }],
      }),
      "utf8",
    );

    const result = verifyProject(dir);
    expect(result.ok).toBe(true);
  });

  it("fails when package path is missing", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        packages: [{ path: "does-not-exist" }],
      }),
      "utf8",
    );

    const result = verifyProject(dir);
    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => c.name.includes("does-not-exist") && !c.ok)).toBe(true);
  });
});
