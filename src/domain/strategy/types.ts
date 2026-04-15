import type { VersionaryConfig } from "../../types/config.js";

export interface VersionStrategy {
  name: string;
  getVersionFile(config: VersionaryConfig): string;
  readVersion(cwd: string, config: VersionaryConfig): string;
  writeVersion(
    cwd: string,
    config: VersionaryConfig,
    version: string,
  ): string[];
}
