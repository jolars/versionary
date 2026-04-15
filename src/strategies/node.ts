import fs from "node:fs";
import path from "node:path";
import type { VersionaryConfig } from "../types/config.js";
import type { VersionStrategy } from "./types.js";

export const nodeVersionStrategy: VersionStrategy = {
  name: "node",
  getVersionFile(config: VersionaryConfig): string {
    return config["version-file"] ?? "version.txt";
  },
  readVersion(cwd: string, config: VersionaryConfig): string {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    return fs.readFileSync(versionPath, "utf8").trim();
  },
  writeVersion(cwd: string, config: VersionaryConfig, version: string): string[] {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    fs.writeFileSync(versionPath, `${version}\n`, "utf8");

    const updatedFiles = [versionFile];
    const packageJsonPath = path.join(cwd, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJsonRaw = fs.readFileSync(packageJsonPath, "utf8");
      const packageJson = JSON.parse(packageJsonRaw) as { version?: string };
      packageJson.version = version;
      fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
      updatedFiles.push("package.json");
    }

    return updatedFiles;
  },
};
