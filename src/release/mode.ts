import type { VersionaryConfig } from "../types/config.js";

export function resolveTargetReleaseMode(
  config: VersionaryConfig,
  packagePath: string,
): "versionary" | "external" {
  return (
    config.packages?.[packagePath]?.["release-mode"] ??
    config["release-mode"] ??
    "versionary"
  );
}

export function hasExternalReleaseMode(config: VersionaryConfig): boolean {
  return (
    Object.keys(config.packages ?? {}).length > 0
      ? Object.keys(config.packages ?? {})
      : ["."]
  ).some(
    (packagePath) =>
      resolveTargetReleaseMode(config, packagePath) === "external",
  );
}

export function hasManagedReleaseMode(config: VersionaryConfig): boolean {
  return (
    Object.keys(config.packages ?? {}).length > 0
      ? Object.keys(config.packages ?? {})
      : ["."]
  ).some(
    (packagePath) =>
      resolveTargetReleaseMode(config, packagePath) === "versionary",
  );
}
