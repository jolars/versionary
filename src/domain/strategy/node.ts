import fs from "node:fs";
import path from "node:path";
import type { VersionaryConfig } from "../../types/config.js";
import type { VersionStrategy } from "./types.js";

interface NodePackageJson {
  version?: string;
  [key: string]: unknown;
}

interface NpmLockfileLike {
  version?: string;
  packages?: Record<string, { version?: string }>;
  [key: string]: unknown;
}

function readJsonFile<T>(targetPath: string): T {
  return JSON.parse(fs.readFileSync(targetPath, "utf8")) as T;
}

function writeJsonFile(targetPath: string, value: unknown): void {
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function updateNodeLockfileVersion(cwd: string, version: string): string[] {
  const updated: string[] = [];
  for (const lockfile of ["package-lock.json", "npm-shrinkwrap.json"]) {
    const lockfilePath = path.join(cwd, lockfile);
    if (!fs.existsSync(lockfilePath)) {
      continue;
    }
    const parsed = readJsonFile<NpmLockfileLike>(lockfilePath);
    parsed.version = version;
    if (parsed.packages?.[""]) {
      parsed.packages[""].version = version;
    }
    writeJsonFile(lockfilePath, parsed);
    updated.push(lockfile);
  }
  return updated;
}

export const nodeVersionStrategy: VersionStrategy = {
  name: "node",
  getVersionFile(config: VersionaryConfig): string {
    return config["version-file"] ?? "package.json";
  },
  readVersion(cwd: string, config: VersionaryConfig): string {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    const packageJson = readJsonFile<NodePackageJson>(versionPath);
    if (!packageJson.version || typeof packageJson.version !== "string") {
      throw new Error(
        `${versionFile} is missing a valid "version" field required by release-type "node".`,
      );
    }
    return packageJson.version.trim();
  },
  writeVersion(
    cwd: string,
    config: VersionaryConfig,
    version: string,
  ): string[] {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }

    const packageJson = readJsonFile<NodePackageJson>(versionPath);
    if (!packageJson.version || typeof packageJson.version !== "string") {
      throw new Error(
        `${versionFile} is missing a valid "version" field required by release-type "node".`,
      );
    }
    packageJson.version = version;
    writeJsonFile(versionPath, packageJson);

    const updatedFiles = [
      versionFile,
      ...updateNodeLockfileVersion(cwd, version),
    ];
    return updatedFiles;
  },
};
