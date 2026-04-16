import fs from "node:fs";
import path from "node:path";
import type { VersionaryConfig } from "../types/config.js";
import type { VersionStrategy } from "./types.js";

function readDescriptionVersion(content: string, versionFile: string): string {
  const match = content.match(/^Version:\s*(.+)\s*$/mu);
  if (!match?.[1]) {
    throw new Error(
      `${versionFile} is missing a valid "Version:" field required by release-type "r".`,
    );
  }
  return match[1].trim();
}

function writeDescriptionVersion(
  content: string,
  versionFile: string,
  version: string,
): string {
  if (!/^Version:\s*/mu.test(content)) {
    throw new Error(
      `${versionFile} is missing a valid "Version:" field required by release-type "r".`,
    );
  }
  return content.replace(/^Version:\s*.*$/mu, `Version: ${version}`);
}

export const rVersionStrategy: VersionStrategy = {
  name: "r",
  getVersionFile(config: VersionaryConfig): string {
    return config["version-file"] ?? "DESCRIPTION";
  },
  readVersion(cwd: string, config: VersionaryConfig): string {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    return readDescriptionVersion(
      fs.readFileSync(versionPath, "utf8"),
      versionFile,
    );
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
    const existing = fs.readFileSync(versionPath, "utf8");
    const updated = writeDescriptionVersion(existing, versionFile, version);
    fs.writeFileSync(versionPath, updated, "utf8");
    return [versionFile];
  },
  readPackageName(cwd: string, config: VersionaryConfig): string | null {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    const content = fs.readFileSync(versionPath, "utf8");
    const match = content.match(/^Package:\s*(.+)\s*$/mu);
    if (!match?.[1]) {
      return null;
    }
    const name = match[1].trim();
    return name.length > 0 ? name : null;
  },
};
