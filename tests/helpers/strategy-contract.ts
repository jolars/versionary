import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { VersionStrategy } from "../../src/strategy/types.js";
import type { VersionaryConfig } from "../../src/types/config.js";

interface StrategyContractFixture {
  files: Record<string, string>;
  expectedUpdatedFiles: string[];
  assertAfterWrite?: (cwd: string, nextVersion: string) => void;
  malformedFiles?: Record<string, string>;
  malformedReadError?: RegExp;
}

export interface VersionStrategyContractCase {
  name: string;
  strategy: VersionStrategy;
  config: VersionaryConfig;
  initialVersion: string;
  nextVersion: string;
  fixture: StrategyContractFixture;
}

const tempDirs: string[] = [];

function makeTempDir(name: string): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `versionary-strategy-${name}-`),
  );
  tempDirs.push(dir);
  return dir;
}

function writeFixture(cwd: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(cwd, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
}

export function cleanupStrategyContractTempDirs(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

export function defineVersionStrategyContractSuite(
  contractCase: VersionStrategyContractCase,
): void {
  describe(`${contractCase.name} strategy contract`, () => {
    it("reads version from its configured version source", () => {
      const cwd = makeTempDir(`${contractCase.name}-read`);
      writeFixture(cwd, contractCase.fixture.files);

      expect(contractCase.strategy.readVersion(cwd, contractCase.config)).toBe(
        contractCase.initialVersion,
      );
    });

    it("writes version and reports updated files", () => {
      const cwd = makeTempDir(`${contractCase.name}-write`);
      writeFixture(cwd, contractCase.fixture.files);

      const updatedFiles = contractCase.strategy.writeVersion(
        cwd,
        contractCase.config,
        contractCase.nextVersion,
      );
      expect(updatedFiles).toEqual(contractCase.fixture.expectedUpdatedFiles);
      expect(contractCase.strategy.readVersion(cwd, contractCase.config)).toBe(
        contractCase.nextVersion,
      );
      contractCase.fixture.assertAfterWrite?.(cwd, contractCase.nextVersion);
    });

    it("fails with actionable error when version source file is missing", () => {
      const cwd = makeTempDir(`${contractCase.name}-missing-file`);
      const versionFile = contractCase.strategy.getVersionFile(
        contractCase.config,
      );

      expect(() =>
        contractCase.strategy.readVersion(cwd, contractCase.config),
      ).toThrow(`Versionary requires ${versionFile} to exist.`);
    });

    if (
      contractCase.fixture.malformedFiles &&
      contractCase.fixture.malformedReadError
    ) {
      it("fails with actionable error when version source file is malformed", () => {
        const cwd = makeTempDir(`${contractCase.name}-malformed`);
        writeFixture(cwd, contractCase.fixture.malformedFiles ?? {});

        expect(() =>
          contractCase.strategy.readVersion(cwd, contractCase.config),
        ).toThrow(contractCase.fixture.malformedReadError);
      });
    }
  });
}
