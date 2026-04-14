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

export interface VersionaryConfig {
  version: 1;
  history?: VersionaryHistory;
  monorepo?: VersionaryMonorepo;
  defaults?: VersionaryDefaults;
  packages?: VersionaryPackage[];
  plugins?: VersionaryPluginRef[];
}

export interface LoadedConfig {
  path: string;
  format: ConfigFileFormat;
  config: VersionaryConfig;
}
