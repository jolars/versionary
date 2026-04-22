import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { latexVersionStrategy } from "../src/strategy/latex.js";
import type { StrategyVersionWriteContext } from "../src/strategy/types.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-latex-test-"));
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

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("latexVersionStrategy", () => {
  it("reads and writes version from build.lua", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "build.lua",
      ["uploadconfig = {", '  version = "1.2.2",', "}", ""].join("\n"),
    );

    expect(latexVersionStrategy.readVersion(cwd, { version: 1 })).toBe("1.2.2");
    const updatedFiles = latexVersionStrategy.writeVersion(
      cwd,
      { version: 1 },
      "1.2.3",
    );
    expect(updatedFiles).toEqual(["build.lua"]);
    expect(read(cwd, "build.lua")).toContain('version = "1.2.3"');
  });

  it("updates ProvidesPackage metadata using release commit date", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "build.lua",
      ["uploadconfig = {", '  version = "1.2.2",', "}", ""].join("\n"),
    );
    write(
      cwd,
      "src/beamerthememoloch.dtx",
      [
        "\\ProvidesPackage{beamerthememoloch}[2025-01-01 v1.2.2 Moloch theme]",
        "",
      ].join("\n"),
    );
    write(
      cwd,
      "src/beamerfontthememoloch.dtx",
      [
        "\\ProvidesPackage{beamerfontthememoloch}[2025-01-01 v1.2.2 Moloch font theme]",
        "",
      ].join("\n"),
    );

    const writes: StrategyVersionWriteContext[] = [
      { packagePath: ".", versionFile: "build.lua", version: "1.2.3" },
    ];
    const updated = latexVersionStrategy.finalizeVersionWrites?.(cwd, writes, {
      releaseCommitSha: "abc123",
      releaseDate: "2026-04-20",
    });
    expect(updated).toEqual([
      "src/beamerfontthememoloch.dtx",
      "src/beamerthememoloch.dtx",
    ]);
    expect(read(cwd, "src/beamerthememoloch.dtx")).toContain(
      "\\ProvidesPackage{beamerthememoloch}[2026-04-20 v1.2.3 Moloch theme]",
    );
    expect(read(cwd, "src/beamerfontthememoloch.dtx")).toContain(
      "\\ProvidesPackage{beamerfontthememoloch}[2026-04-20 v1.2.3 Moloch font theme]",
    );
  });

  it("updates ProvidesExplPackage metadata using release commit date", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "build.lua",
      ["uploadconfig = {", '  version = "1.2.2",', "}", ""].join("\n"),
    );
    write(
      cwd,
      "src/cvd.dtx",
      [
        "\\ProvidesExplPackage{cvd}{2025-01-01}{1.2.2}{Color vision deficiency simulation}",
        "",
      ].join("\n"),
    );

    const writes: StrategyVersionWriteContext[] = [
      { packagePath: ".", versionFile: "build.lua", version: "1.2.3" },
    ];
    const updated = latexVersionStrategy.finalizeVersionWrites?.(cwd, writes, {
      releaseCommitSha: "abc123",
      releaseDate: "2026-04-20",
    });
    expect(updated).toEqual(["src/cvd.dtx"]);
    expect(read(cwd, "src/cvd.dtx")).toContain(
      "\\ProvidesExplPackage{cvd}{2026-04-20}{1.2.3}{Color vision deficiency simulation}",
    );
  });

  it("throws actionable error when no dtx files exist", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "build.lua",
      ["uploadconfig = {", '  version = "1.2.2",', "}", ""].join("\n"),
    );
    const writes: StrategyVersionWriteContext[] = [
      { packagePath: ".", versionFile: "build.lua", version: "1.2.3" },
    ];
    expect(() =>
      latexVersionStrategy.finalizeVersionWrites?.(cwd, writes, {
        releaseCommitSha: "abc123",
        releaseDate: "2026-04-20",
      }),
    ).toThrow(/requires at least one \.dtx file/i);
  });

  it("throws actionable error when ProvidesPackage metadata is malformed", () => {
    const cwd = makeTempDir();
    write(
      cwd,
      "build.lua",
      ["uploadconfig = {", '  version = "1.2.2",', "}", ""].join("\n"),
    );
    write(
      cwd,
      "src/beamerthememoloch.dtx",
      "\\ProvidesPackage{beamerthememoloch}",
    );
    const writes: StrategyVersionWriteContext[] = [
      { packagePath: ".", versionFile: "build.lua", version: "1.2.3" },
    ];
    expect(() =>
      latexVersionStrategy.finalizeVersionWrites?.(cwd, writes, {
        releaseCommitSha: "abc123",
        releaseDate: "2026-04-20",
      }),
    ).toThrow(
      /must contain exactly one \\ProvidesPackage or \\ProvidesExplPackage metadata entry/i,
    );
  });
});
