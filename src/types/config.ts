export type ConfigFileFormat = "jsonc" | "json" | "toml" | "js";
export type VersionaryChangelogFormat = "markdown-changelog" | "r-news";
export type ReleaseReferenceCommentsMode = "off" | "best-effort" | "strict";

export interface VersionaryArtifactRule {
  type: "json" | "toml" | "yaml" | "nix" | "regex";
  path: string;
  "field-path"?: string;
  pattern?: string;
  replacement?: string;
  "expected-matches"?: number;
}

export interface VersionaryPackage {
  "release-type"?: string | string[];
  "package-name"?: string;
  "changelog-file"?: string;
  "changelog-format"?: VersionaryChangelogFormat;
  "bump-minor-pre-major"?: boolean;
  "allow-stable-major"?: boolean;
  "exclude-paths"?: string[];
  "extra-files"?: VersionaryArtifactRule[];
  follows?: string[];
}

export interface VersionaryConfig {
  version: 1;
  "review-mode"?: "direct" | "pr";
  "version-file"?: string;
  "changelog-file"?: string;
  "changelog-format"?: VersionaryChangelogFormat;
  "release-draft"?: boolean;
  "release-reference-comments"?: ReleaseReferenceCommentsMode;
  "release-branch"?: string;
  "separate-release-prs"?: boolean;
  "baseline-file"?: string;
  "bootstrap-sha"?: string;
  "monorepo-mode"?: "independent" | "fixed";
  "bump-minor-pre-major"?: boolean;
  "allow-stable-major"?: boolean;
  "include-commit-authors"?: boolean;
  "exclude-paths"?: string[];
  "release-type"?: string | string[];
  packages?: Record<string, VersionaryPackage>;
}

export interface LoadedConfig {
  path: string;
  format: ConfigFileFormat;
  config: VersionaryConfig;
}
