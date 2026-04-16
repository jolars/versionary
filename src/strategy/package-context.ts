import path from "node:path";
import type { VersionaryConfig, VersionaryPackage } from "../types/config.js";
import { resolveVersionStrategy } from "./resolve.js";
import type { VersionStrategy } from "./types.js";

function withVersionFile(
  config: VersionaryConfig,
  versionFile: string,
): VersionaryConfig {
  return {
    ...config,
    "version-file": versionFile,
  };
}

export function resolvePackageStrategyContext(
  rootConfig: VersionaryConfig,
  packagePath: string,
  packageConfig: VersionaryPackage,
): {
  strategy: VersionStrategy;
  config: VersionaryConfig;
  versionFile: string;
} {
  const packageReleaseType = packageConfig["release-type"];
  const baseConfig: VersionaryConfig = packageReleaseType
    ? {
        ...rootConfig,
        "release-type": packageReleaseType,
      }
    : { ...rootConfig };

  const baseStrategy = resolveVersionStrategy(baseConfig);
  if (!packageReleaseType) {
    const versionFile =
      packagePath === "."
        ? (baseConfig["version-file"] ??
          baseStrategy.getVersionFile(baseConfig))
        : baseStrategy.name === "simple"
          ? (baseConfig["version-file"] ??
            baseStrategy.getVersionFile(baseConfig))
          : path.posix.join(
              packagePath,
              baseStrategy.getVersionFile({
                ...baseConfig,
                "version-file": undefined,
              }),
            );
    const config = withVersionFile(
      {
        ...baseConfig,
        packages: packagePath === "." ? baseConfig.packages : undefined,
      },
      versionFile,
    );
    return {
      strategy: baseStrategy,
      config,
      versionFile,
    };
  }

  const packageVersionFile =
    packagePath === "."
      ? (baseConfig["version-file"] ?? baseStrategy.getVersionFile(baseConfig))
      : path.posix.join(
          packagePath,
          baseStrategy.getVersionFile({
            ...baseConfig,
            "version-file": undefined,
          }),
        );

  const config = withVersionFile(
    {
      ...baseConfig,
      packages: packagePath === "." ? baseConfig.packages : undefined,
    },
    packageVersionFile,
  );
  const strategy = resolveVersionStrategy(config);
  return {
    strategy,
    config,
    versionFile: packageVersionFile,
  };
}
