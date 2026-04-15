import fs from "node:fs";
import path from "node:path";
import type { VersionaryConfig } from "../../types/config.js";
import type { VersionStrategy } from "./types.js";

export const simpleVersionStrategy: VersionStrategy = {
  name: "simple",
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
  writeVersion(
    cwd: string,
    config: VersionaryConfig,
    version: string,
  ): string[] {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    fs.writeFileSync(versionPath, `${version}\n`, "utf8");
    return [versionFile];
  },
};
