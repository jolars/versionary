import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pythonVersionStrategy } from "../src/strategy/python.js";
import type { VersionaryConfig } from "../src/types/config.js";

const tempDirs: string[] = [];

function makeTempDir(suffix: string): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `versionary-python-${suffix}-`),
  );
  tempDirs.push(dir);
  return dir;
}

function writeFile(cwd: string, relative: string, content: string): void {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function readFile(cwd: string, relative: string): string {
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

const baseConfig: VersionaryConfig = {
  version: 1,
  "release-type": "python",
};

describe("pythonVersionStrategy pyproject.toml mode", () => {
  it("reads version from [project].version (PEP 621)", () => {
    const cwd = makeTempDir("read-pep621");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[project]", 'name = "demo"', 'version = "1.4.2"', ""].join("\n"),
    );
    expect(pythonVersionStrategy.readVersion(cwd, baseConfig)).toBe("1.4.2");
  });

  it("reads version from [tool.poetry].version when [project].version is absent", () => {
    const cwd = makeTempDir("read-poetry");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[tool.poetry]", 'name = "demo"', 'version = "0.5.0"', ""].join("\n"),
    );
    expect(pythonVersionStrategy.readVersion(cwd, baseConfig)).toBe("0.5.0");
  });

  it("prefers [project].version when both fields are present", () => {
    const cwd = makeTempDir("read-both");
    writeFile(
      cwd,
      "pyproject.toml",
      [
        "[project]",
        'name = "demo"',
        'version = "2.0.0"',
        "",
        "[tool.poetry]",
        'name = "demo"',
        'version = "1.9.9"',
        "",
      ].join("\n"),
    );
    expect(pythonVersionStrategy.readVersion(cwd, baseConfig)).toBe("2.0.0");
  });

  it("throws actionable error when neither version field exists", () => {
    const cwd = makeTempDir("read-missing");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[project]", 'name = "demo"', ""].join("\n"),
    );
    expect(() => pythonVersionStrategy.readVersion(cwd, baseConfig)).toThrow(
      /missing a valid "\[project\]\.version" or "\[tool\.poetry\]\.version"/i,
    );
  });

  it("throws actionable error when pyproject.toml has invalid TOML syntax", () => {
    const cwd = makeTempDir("read-invalid");
    writeFile(cwd, "pyproject.toml", "[project\nname = broken");
    expect(() => pythonVersionStrategy.readVersion(cwd, baseConfig)).toThrow(
      /Failed to parse pyproject\.toml/u,
    );
  });

  it("writes [project].version only when only [project] has a version", () => {
    const cwd = makeTempDir("write-pep621");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[project]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    const updated = pythonVersionStrategy.writeVersion(
      cwd,
      baseConfig,
      "1.1.0",
    );
    expect(updated).toEqual(["pyproject.toml"]);
    const content = readFile(cwd, "pyproject.toml");
    expect(content).toContain('version = "1.1.0"');
    expect(content).not.toContain('version = "1.0.0"');
  });

  it("writes [tool.poetry].version only when only Poetry has a version", () => {
    const cwd = makeTempDir("write-poetry");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[tool.poetry]", 'name = "demo"', 'version = "1.0.0"', ""].join("\n"),
    );
    pythonVersionStrategy.writeVersion(cwd, baseConfig, "1.1.0");
    expect(readFile(cwd, "pyproject.toml")).toContain('version = "1.1.0"');
  });

  it("writes both [project].version and [tool.poetry].version when both are present", () => {
    const cwd = makeTempDir("write-both");
    writeFile(
      cwd,
      "pyproject.toml",
      [
        "[project]",
        'name = "demo"',
        'version = "1.0.0"',
        "",
        "[tool.poetry]",
        'name = "demo"',
        'version = "1.0.0"',
        "",
      ].join("\n"),
    );
    pythonVersionStrategy.writeVersion(cwd, baseConfig, "2.0.0");
    const content = readFile(cwd, "pyproject.toml");
    expect(content.match(/version = "2\.0\.0"/gu)?.length).toBe(2);
    expect(content).not.toContain('version = "1.0.0"');
  });

  it("preserves comments and blank lines around the version line", () => {
    const cwd = makeTempDir("write-preserve");
    const original = [
      "# top-level comment",
      "[project]",
      "# project metadata",
      'name = "demo"',
      'version = "0.1.0"  # initial release',
      "",
      "[tool.something]",
      "enabled = true",
      "",
    ].join("\n");
    writeFile(cwd, "pyproject.toml", original);
    pythonVersionStrategy.writeVersion(cwd, baseConfig, "0.2.0");
    const content = readFile(cwd, "pyproject.toml");
    expect(content).toContain("# top-level comment");
    expect(content).toContain("# project metadata");
    expect(content).toContain('version = "0.2.0"  # initial release');
    expect(content).toContain("[tool.something]");
    expect(content).toContain("enabled = true");
  });

  it("throws actionable error when version-file is missing", () => {
    const cwd = makeTempDir("write-missing");
    expect(() =>
      pythonVersionStrategy.writeVersion(cwd, baseConfig, "1.0.0"),
    ).toThrow(/Versionary requires pyproject\.toml to exist/u);
  });
});

describe("pythonVersionStrategy source-file mode", () => {
  const sourceConfig: VersionaryConfig = {
    version: 1,
    "release-type": "python",
    "version-file": "src/demo/__init__.py",
  };

  it("reads __version__ with double quotes", () => {
    const cwd = makeTempDir("source-double");
    writeFile(
      cwd,
      "src/demo/__init__.py",
      ['"""docstring"""', '__version__ = "1.2.3"', ""].join("\n"),
    );
    expect(pythonVersionStrategy.readVersion(cwd, sourceConfig)).toBe("1.2.3");
  });

  it("reads __version__ with single quotes", () => {
    const cwd = makeTempDir("source-single");
    writeFile(
      cwd,
      "src/demo/__init__.py",
      ["__version__ = '0.9.0'", ""].join("\n"),
    );
    expect(pythonVersionStrategy.readVersion(cwd, sourceConfig)).toBe("0.9.0");
  });

  it("preserves the original quote style when writing", () => {
    const cwd = makeTempDir("source-quote-preserve");
    writeFile(
      cwd,
      "src/demo/__init__.py",
      ["__version__ = '0.1.0'", ""].join("\n"),
    );
    pythonVersionStrategy.writeVersion(cwd, sourceConfig, "0.2.0");
    expect(readFile(cwd, "src/demo/__init__.py")).toContain(
      "__version__ = '0.2.0'",
    );
  });

  it("preserves trailing comments when writing", () => {
    const cwd = makeTempDir("source-comment");
    writeFile(
      cwd,
      "src/demo/__init__.py",
      ['__version__ = "1.0.0"  # bumped by versionary', ""].join("\n"),
    );
    pythonVersionStrategy.writeVersion(cwd, sourceConfig, "1.1.0");
    expect(readFile(cwd, "src/demo/__init__.py")).toContain(
      '__version__ = "1.1.0"  # bumped by versionary',
    );
  });

  it("throws actionable error when __version__ assignment is missing", () => {
    const cwd = makeTempDir("source-missing");
    writeFile(
      cwd,
      "src/demo/__init__.py",
      ['"""no version here"""', ""].join("\n"),
    );
    expect(() => pythonVersionStrategy.readVersion(cwd, sourceConfig)).toThrow(
      /missing a valid `__version__/u,
    );
  });
});

describe("pythonVersionStrategy readPackageName", () => {
  it("returns [project].name from pyproject.toml", () => {
    const cwd = makeTempDir("name-pep621");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[project]", 'name = "demo-pep621"', 'version = "1.0.0"', ""].join("\n"),
    );
    expect(pythonVersionStrategy.readPackageName?.(cwd, baseConfig)).toBe(
      "demo-pep621",
    );
  });

  it("falls back to [tool.poetry].name when [project].name is absent", () => {
    const cwd = makeTempDir("name-poetry");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[tool.poetry]", 'name = "demo-poetry"', 'version = "1.0.0"', ""].join(
        "\n",
      ),
    );
    expect(pythonVersionStrategy.readPackageName?.(cwd, baseConfig)).toBe(
      "demo-poetry",
    );
  });

  it("returns null when pyproject.toml is missing (e.g. source-file mode without manifest)", () => {
    const cwd = makeTempDir("name-no-pyproject");
    writeFile(cwd, "src/demo/__init__.py", '__version__ = "1.0.0"\n');
    expect(
      pythonVersionStrategy.readPackageName?.(cwd, {
        version: 1,
        "release-type": "python",
        "version-file": "src/demo/__init__.py",
      }),
    ).toBeNull();
  });

  it("returns null when pyproject.toml has neither name field", () => {
    const cwd = makeTempDir("name-empty");
    writeFile(
      cwd,
      "pyproject.toml",
      ["[project]", 'version = "1.0.0"', ""].join("\n"),
    );
    expect(pythonVersionStrategy.readPackageName?.(cwd, baseConfig)).toBeNull();
  });
});

const skipShellTests = process.platform === "win32";

describe.skipIf(skipShellTests)(
  "pythonVersionStrategy finalizeVersionWrites",
  () => {
    function withShimmedPath(
      cwd: string,
      shims: ReadonlyArray<{ name: string; recordPath: string }>,
    ): { restore: () => void; shimDir: string } {
      const shimDir = path.join(cwd, ".bin-shim");
      fs.mkdirSync(shimDir, { recursive: true });
      for (const shim of shims) {
        const scriptPath = path.join(shimDir, shim.name);
        const recordEscaped = shim.recordPath.replace(/'/gu, "'\\''");
        fs.writeFileSync(
          scriptPath,
          `#!/usr/bin/env bash\nprintf '%s ' "$(pwd)" >> '${recordEscaped}'\nprintf '%s\\n' "$@" >> '${recordEscaped}'\nexit 0\n`,
          "utf8",
        );
        fs.chmodSync(scriptPath, 0o755);
      }
      const previous = process.env.PATH;
      process.env.PATH = `${shimDir}${path.delimiter}${previous ?? ""}`;
      return {
        shimDir,
        restore: () => {
          process.env.PATH = previous;
        },
      };
    }

    it("returns empty array when no lockfiles are present", () => {
      const cwd = makeTempDir("finalize-empty");
      const result = pythonVersionStrategy.finalizeVersionWrites?.(cwd, [], {
        releaseCommitSha: "abc",
        releaseDate: "2026-05-07",
      });
      expect(result).toEqual([]);
    });

    it("invokes poetry/uv/pdm for each present lockfile and returns sorted paths", () => {
      const cwd = makeTempDir("finalize-all");
      writeFile(cwd, "poetry.lock", "stub\n");
      writeFile(cwd, "uv.lock", "stub\n");
      writeFile(cwd, "pdm.lock", "stub\n");
      const recordPath = path.join(cwd, "invocations.log");
      const { restore } = withShimmedPath(cwd, [
        { name: "poetry", recordPath },
        { name: "uv", recordPath },
        { name: "pdm", recordPath },
      ]);
      try {
        const result = pythonVersionStrategy.finalizeVersionWrites?.(cwd, [], {
          releaseCommitSha: "abc",
          releaseDate: "2026-05-07",
        });
        expect(result).toEqual(["pdm.lock", "poetry.lock", "uv.lock"]);
        const log = fs.readFileSync(recordPath, "utf8");
        expect(log).toContain("lock");
        expect(log).toContain("--no-update");
        expect(log).toContain("--update-reuse");
      } finally {
        restore();
      }
    });

    it("only invokes managers whose lockfiles exist", () => {
      const cwd = makeTempDir("finalize-uv-only");
      writeFile(cwd, "uv.lock", "stub\n");
      const recordPath = path.join(cwd, "invocations.log");
      const { restore } = withShimmedPath(cwd, [{ name: "uv", recordPath }]);
      try {
        const result = pythonVersionStrategy.finalizeVersionWrites?.(cwd, [], {
          releaseCommitSha: "abc",
          releaseDate: "2026-05-07",
        });
        expect(result).toEqual(["uv.lock"]);
      } finally {
        restore();
      }
    });

    it("throws actionable error when lockfile exists but tool is not on PATH", () => {
      const cwd = makeTempDir("finalize-missing-tool");
      writeFile(cwd, "uv.lock", "stub\n");
      const previous = process.env.PATH;
      process.env.PATH = makeTempDir("finalize-empty-path");
      try {
        expect(() =>
          pythonVersionStrategy.finalizeVersionWrites?.(cwd, [], {
            releaseCommitSha: "abc",
            releaseDate: "2026-05-07",
          }),
        ).toThrow(/Failed to refresh uv\.lock.*uv is on PATH/u);
      } finally {
        process.env.PATH = previous;
      }
    });
  },
);
