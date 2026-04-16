import type { VersionaryConfig } from "../types/config.js";

export interface StrategyPackagePlanContext {
  packagePath: string;
  versionFile: string;
  currentVersion: string;
  nextVersion: string | null;
}

export interface StrategyVersionWriteContext {
  packagePath: string;
  versionFile: string;
  version: string;
}

export interface VersionStrategy {
  name: string;
  getVersionFile(config: VersionaryConfig): string;
  readVersion(cwd: string, config: VersionaryConfig): string;
  writeVersion(
    cwd: string,
    config: VersionaryConfig,
    version: string,
  ): string[];
  readPackageName?(cwd: string, config: VersionaryConfig): string | null;
  propagateDependentPatchImpacts?(
    cwd: string,
    packages: StrategyPackagePlanContext[],
  ): string[];
  finalizeVersionWrites?(
    cwd: string,
    writes: StrategyVersionWriteContext[],
  ): string[];
}
