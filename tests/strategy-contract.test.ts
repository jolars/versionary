import fs from "node:fs";
import path from "node:path";
import { afterEach, expect } from "vitest";
import { nodeVersionStrategy } from "../src/strategy/node.js";
import { rVersionStrategy } from "../src/strategy/r.js";
import { rustVersionStrategy } from "../src/strategy/rust.js";
import { simpleVersionStrategy } from "../src/strategy/simple.js";
import {
  cleanupStrategyContractTempDirs,
  defineVersionStrategyContractSuite,
} from "./helpers/strategy-contract.js";

afterEach(() => {
  cleanupStrategyContractTempDirs();
});

defineVersionStrategyContractSuite({
  name: "simple",
  strategy: simpleVersionStrategy,
  config: { version: 1 },
  initialVersion: "1.2.3",
  nextVersion: "2.0.0",
  fixture: {
    files: {
      "version.txt": "1.2.3\n",
    },
    expectedUpdatedFiles: ["version.txt"],
  },
});

defineVersionStrategyContractSuite({
  name: "node",
  strategy: nodeVersionStrategy,
  config: { version: 1, "release-type": "node" },
  initialVersion: "1.2.3",
  nextVersion: "2.0.0",
  fixture: {
    files: {
      "package.json": `${JSON.stringify(
        { name: "demo", version: "1.2.3", private: true },
        null,
        2,
      )}\n`,
      "package-lock.json": `${JSON.stringify(
        {
          name: "demo",
          version: "1.2.3",
          lockfileVersion: 3,
          requires: true,
          packages: {
            "": { name: "demo", version: "1.2.3" },
          },
        },
        null,
        2,
      )}\n`,
    },
    expectedUpdatedFiles: ["package.json", "package-lock.json"],
    assertAfterWrite: (cwd, nextVersion) => {
      const lock = JSON.parse(
        fs.readFileSync(path.join(cwd, "package-lock.json"), "utf8"),
      ) as {
        version?: string;
        packages?: Record<string, { version?: string }>;
      };
      expect(lock.version).toBe(nextVersion);
      expect(lock.packages?.[""]?.version).toBe(nextVersion);
    },
    malformedFiles: {
      "package.json": `${JSON.stringify({ name: "demo", private: true }, null, 2)}\n`,
    },
    malformedReadError: /missing a valid "version" field/i,
  },
});

defineVersionStrategyContractSuite({
  name: "r",
  strategy: rVersionStrategy,
  config: { version: 1, "release-type": "r" },
  initialVersion: "0.1.0",
  nextVersion: "0.2.0",
  fixture: {
    files: {
      DESCRIPTION: [
        "Package: demo",
        "Type: Package",
        "Version: 0.1.0",
        "",
      ].join("\n"),
    },
    expectedUpdatedFiles: ["DESCRIPTION"],
    malformedFiles: {
      DESCRIPTION: ["Package: demo", "Type: Package", ""].join("\n"),
    },
    malformedReadError: /missing a valid "Version:" field/i,
  },
});

defineVersionStrategyContractSuite({
  name: "rust",
  strategy: rustVersionStrategy,
  config: { version: 1, "release-type": "rust" },
  initialVersion: "0.9.0",
  nextVersion: "1.0.0",
  fixture: {
    files: {
      "Cargo.toml": [
        "[package]",
        'name = "demo-rust"',
        'version = "0.9.0"',
        "",
      ].join("\n"),
    },
    expectedUpdatedFiles: ["Cargo.toml"],
    malformedFiles: {
      "Cargo.toml": ["[package]", 'name = "demo-rust"', ""].join("\n"),
    },
    malformedReadError: /missing \[package\]\.version/i,
    assertAfterWrite: (cwd, nextVersion) => {
      const cargoToml = fs.readFileSync(path.join(cwd, "Cargo.toml"), "utf8");
      expect(cargoToml).toContain(`version = "${nextVersion}"`);
    },
  },
});
