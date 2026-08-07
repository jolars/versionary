import type {
  VersionaryChangelogFormat,
  VersionaryConfig,
} from "../types/config.js";

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

export interface StrategyFinalizeContext {
  releaseCommitSha: string;
  releaseDate: string;
}

export interface VersionStrategy {
  name: string;
  getVersionFile(config: VersionaryConfig): string;
  getDefaultChangelogFormat?(): VersionaryChangelogFormat;
  readVersion(cwd: string, config: VersionaryConfig): string;
  writeVersion(
    cwd: string,
    config: VersionaryConfig,
    version: string,
  ): string[];
  validateProject?(cwd: string, config: VersionaryConfig): string | null;
  readPackageName?(cwd: string, config: VersionaryConfig): string | null;
  /**
   * Whether this package is published to a registry. A package that never
   * reaches a registry cannot leave a stale published copy behind, so release
   * planning exempts it from published-dependency freshness enforcement.
   *
   * Returns `undefined` to abstain, which a strategy must do for a version
   * file it does not recognize — otherwise, composed with another strategy, it
   * would outvote the one that actually owns the manifest. Strategies that
   * omit this hook entirely are assumed to publish everything.
   */
  isPublishable?(
    cwd: string,
    pkg: StrategyPackagePlanContext,
  ): boolean | undefined;
  propagateDependentPatchImpacts?(
    cwd: string,
    packages: StrategyPackagePlanContext[],
  ): string[];
  finalizeVersionWrites?(
    cwd: string,
    writes: StrategyVersionWriteContext[],
    context: StrategyFinalizeContext,
  ): string[];
}
