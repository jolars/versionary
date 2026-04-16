export type ConfigFileFormat = "jsonc" | "json" | "toml" | "js";

export interface VersionaryArtifactRule {
  type: "json" | "toml" | "yaml" | "regex";
  path: string;
  "field-path"?: string;
  jsonpath?: string;
  pattern?: string;
}

export interface VersionaryPackage {
  "release-type"?: string;
  "package-name"?: string;
  "exclude-paths"?: string[];
  "extra-files"?: VersionaryArtifactRule[];
}

export interface VersionaryConfig {
  version: 1;
  "review-mode"?: "direct" | "review";
  "version-file"?: string;
  "changelog-file"?: string;
  "release-branch"?: string;
  "baseline-file"?: string;
  "bootstrap-sha"?: string;
  "monorepo-mode"?: "independent" | "fixed";
  "bump-minor-pre-major"?: boolean;
  "allow-stable-major"?: boolean;
  "include-commit-authors"?: boolean;
  "release-type"?: string;
  packages?: Record<string, VersionaryPackage>;
  plugins?: string[];
}

export interface LoadedConfig {
  path: string;
  format: ConfigFileFormat;
  config: VersionaryConfig;
}
