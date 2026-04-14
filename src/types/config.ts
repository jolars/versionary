export type ConfigFileFormat = "jsonc" | "json" | "toml" | "js";

export interface VersionaryBootstrap {
  sha?: string;
  tag?: string;
}

export interface VersionaryHistory {
  bootstrap?: VersionaryBootstrap;
}

export interface VersionaryMonorepo {
  mode: "independent" | "fixed";
}

export interface VersionaryVersioningDefaults {
  bumpMinorPreMajor?: boolean;
}

export interface VersionaryChangelogDefaults {
  includeAuthors?: boolean;
}

export interface VersionaryCommitConventions {
  preset: "conventional" | "angular" | "custom";
}

export interface VersionaryDefaults {
  strategy?: string;
  versioning?: VersionaryVersioningDefaults;
  changelog?: VersionaryChangelogDefaults;
  commitConventions?: VersionaryCommitConventions;
}

export interface VersionaryArtifactRule {
  file: string;
  format: "json" | "toml" | "yaml" | "regex";
  path?: string;
  pattern?: string;
}

export interface VersionaryPackage {
  path: string;
  strategy?: string;
  packageName?: string;
  excludePaths?: string[];
  artifacts?: VersionaryArtifactRule[];
}

export interface VersionaryPluginRef {
  name: string;
  options?: Record<string, unknown>;
}

export type VersionaryLifecycle =
  | "plan"
  | "pr"
  | "release";

export type VersionaryPluginStep =
  | "verifyConditions"
  | "analyzeCommits"
  | "resolveReverts"
  | "verifyRelease"
  | "generateNotes"
  | "updateArtifacts"
  | "preparePr"
  | "publish"
  | "postRelease"
  | "success"
  | "fail";

export type VersionaryPluginMergeStrategy = "highest" | "concat" | "override" | "reduce";

export interface VersionaryPluginExecution {
  step: VersionaryPluginStep;
  lifecycle?: VersionaryLifecycle[];
  merge?: VersionaryPluginMergeStrategy;
}

export interface VersionaryPluginPresetRef {
  name: string;
}

export interface VersionaryPluginConfig {
  extends?: VersionaryPluginPresetRef[];
  globalOptions?: Record<string, unknown>;
  execution?: VersionaryPluginExecution[];
  plugins?: VersionaryPluginRef[];
}

export interface VersionaryReleaseFlow {
  mode: "direct" | "review";
}

export interface VersionaryConfig {
  version: 1;
  mode?: "simple" | "standard";
  releaseFlow?: VersionaryReleaseFlow;
  history?: VersionaryHistory;
  monorepo?: VersionaryMonorepo;
  defaults?: VersionaryDefaults;
  packages?: VersionaryPackage[];
  pluginConfig?: VersionaryPluginConfig;
  plugins?: VersionaryPluginRef[]; // compatibility alias; normalized into pluginConfig.plugins
  simple?: {
    versionFile?: string;
    changelogFile?: string;
    releaseBranchPrefix?: string;
    baselineShaFile?: string;
  };
}

export interface LoadedConfig {
  path: string;
  format: ConfigFileFormat;
  config: VersionaryConfig;
}
