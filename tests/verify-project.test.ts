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
    fs.writeFileSync(path.join(dir, "version.txt"), "0.1.0\n", "utf8");
    fs.mkdirSync(path.join(dir, "crates"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        packages: { crates: {} },
      }),
      "utf8",
    );

    const result = verifyProject(dir);
    expect(result.ok).toBe(true);
    expect(result.checks.every((check) => check.category)).toBe(true);
  });

  it("fails when package path is missing", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "version.txt"), "0.1.0\n", "utf8");
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        packages: { "does-not-exist": {} },
      }),
      "utf8",
    );

    const result = verifyProject(dir);
    expect(result.ok).toBe(false);
    expect(
      result.checks.some((c) => c.name.includes("does-not-exist") && !c.ok),
    ).toBe(true);
    const failedPathCheck = result.checks.find(
      (c) => c.name === "package-path:does-not-exist" && !c.ok,
    );
    expect(failedPathCheck?.remediation).toContain("remove/rename");
  });

  it("fails when version file is missing", () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
      }),
      "utf8",
    );

    const result = verifyProject(dir);
    expect(result.ok).toBe(false);
    expect(
      result.checks.some((c) => c.name.includes("version-file") && !c.ok),
    ).toBe(true);
    const failedVersionCheck = result.checks.find(
      (c) => c.name === "version-file:version.txt" && !c.ok,
    );
    expect(failedVersionCheck?.remediation).toContain("Create version.txt");
  });

  it("expects package.json for release-type node", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "version.txt"), "0.1.0\n", "utf8");
    fs.writeFileSync(
      path.join(dir, "versionary.json"),
      JSON.stringify({
        version: 1,
        "release-type": "node",
      }),
      "utf8",
    );

    const result = verifyProject(dir);
    expect(result.ok).toBe(false);
    expect(
      result.checks.some((c) => c.name === "version-file:package.json"),
    ).toBe(true);
  });
});
