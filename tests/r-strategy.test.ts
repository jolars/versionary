import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rVersionStrategy } from "../src/strategy/r.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-r-desc-test-"));
  tempDirs.push(dir);
  return dir;
}

function write(cwd: string, relative: string, content: string): void {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("rVersionStrategy", () => {
  it("reads Version from DESCRIPTION", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "DESCRIPTION",
      ["Package: demo", "Type: Package", "Version: 0.1.0", ""].join("\n"),
    );
    const version = rVersionStrategy.readVersion(cwd, {
      version: 1,
      "release-type": "r",
    });
    expect(version).toBe("0.1.0");
  });

  it("updates Version in DESCRIPTION", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "DESCRIPTION",
      ["Package: demo", "Type: Package", "Version: 0.1.0", ""].join("\n"),
    );
    const updatedFiles = rVersionStrategy.writeVersion(
      cwd,
      {
        version: 1,
        "release-type": "r",
      },
      "0.2.0",
    );
    expect(updatedFiles).toEqual(["DESCRIPTION"]);
    const next = fs.readFileSync(path.join(cwd, "DESCRIPTION"), "utf8");
    expect(next).toContain("Version: 0.2.0");
  });

  it("throws actionable error when DESCRIPTION has no Version", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "DESCRIPTION",
      ["Package: demo", "Type: Package", ""].join("\n"),
    );
    expect(() =>
      rVersionStrategy.readVersion(cwd, {
        version: 1,
        "release-type": "r",
      }),
    ).toThrow(/Version:/i);
  });

  it("reads package name from DESCRIPTION Package field", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "DESCRIPTION",
      ["Package: panache", "Type: Package", "Version: 0.1.0", ""].join("\n"),
    );
    const packageName = rVersionStrategy.readPackageName?.(cwd, {
      version: 1,
      "release-type": "r",
    });
    expect(packageName).toBe("panache");
  });
});
