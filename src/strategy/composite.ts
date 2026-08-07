import type { VersionaryConfig } from "../types/config.js";
import type {
  StrategyFinalizeContext,
  StrategyPackagePlanContext,
  StrategyVersionWriteContext,
  VersionStrategy,
} from "./types.js";

function configForSecondary(config: VersionaryConfig): VersionaryConfig {
  if (config["version-file"] === undefined) {
    return config;
  }
  const { "version-file": _omit, ...rest } = config;
  return rest;
}

function dedupedSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function compositeVersionStrategy(
  strategies: readonly VersionStrategy[],
): VersionStrategy {
  if (strategies.length === 0) {
    throw new Error("compositeVersionStrategy requires at least one strategy.");
  }
  if (strategies.length === 1) {
    const only = strategies[0];
    if (!only) {
      throw new Error(
        "compositeVersionStrategy requires at least one strategy.",
      );
    }
    return only;
  }

  const primary = strategies[0];
  const secondaries = strategies.slice(1);
  if (!primary) {
    throw new Error("compositeVersionStrategy requires at least one strategy.");
  }

  const composite: VersionStrategy = {
    name: strategies.map((strategy) => strategy.name).join("+"),
    getVersionFile(config: VersionaryConfig): string {
      return primary.getVersionFile(config);
    },
    readVersion(cwd: string, config: VersionaryConfig): string {
      return primary.readVersion(cwd, config);
    },
    writeVersion(
      cwd: string,
      config: VersionaryConfig,
      version: string,
    ): string[] {
      const updated: string[] = [];
      updated.push(...primary.writeVersion(cwd, config, version));
      const secondaryConfig = configForSecondary(config);
      for (const secondary of secondaries) {
        updated.push(...secondary.writeVersion(cwd, secondaryConfig, version));
      }
      return dedupedSorted(updated);
    },
  };

  if (
    primary.getDefaultChangelogFormat ||
    secondaries.some((strategy) => strategy.getDefaultChangelogFormat)
  ) {
    composite.getDefaultChangelogFormat = () => {
      return primary.getDefaultChangelogFormat?.() ?? "markdown-changelog";
    };
  }

  if (
    primary.validateProject ||
    secondaries.some((strategy) => strategy.validateProject)
  ) {
    composite.validateProject = (
      cwd: string,
      config: VersionaryConfig,
    ): string | null => {
      const messages: string[] = [];
      const primaryError = primary.validateProject?.(cwd, config) ?? null;
      if (primaryError) {
        messages.push(primaryError);
      }
      const secondaryConfig = configForSecondary(config);
      for (const secondary of secondaries) {
        const error = secondary.validateProject?.(cwd, secondaryConfig) ?? null;
        if (error) {
          messages.push(error);
        }
      }
      return messages.length === 0 ? null : messages.join("\n");
    };
  }

  if (primary.readPackageName) {
    composite.readPackageName = (
      cwd: string,
      config: VersionaryConfig,
    ): string | null => {
      return primary.readPackageName?.(cwd, config) ?? null;
    };
  }

  if (primary.isPublishable || secondaries.some((s) => s.isPublishable)) {
    composite.isPublishable = (
      cwd: string,
      pkg: StrategyPackagePlanContext,
    ): boolean | undefined => {
      // Only strategies that recognize this package's version file have an
      // opinion; among those, one publishing facet is enough to expose the
      // package on a registry.
      const opinions = [primary, ...secondaries]
        .map((strategy) => strategy.isPublishable?.(cwd, pkg))
        .filter((opinion): opinion is boolean => typeof opinion === "boolean");
      return opinions.length === 0 ? undefined : opinions.some(Boolean);
    };
  }

  if (
    primary.propagateDependentPatchImpacts ||
    secondaries.some((strategy) => strategy.propagateDependentPatchImpacts)
  ) {
    composite.propagateDependentPatchImpacts = (
      cwd: string,
      packages: StrategyPackagePlanContext[],
    ): string[] => {
      const impacted: string[] = [];
      impacted.push(
        ...(primary.propagateDependentPatchImpacts?.(cwd, packages) ?? []),
      );
      for (const secondary of secondaries) {
        impacted.push(
          ...(secondary.propagateDependentPatchImpacts?.(cwd, packages) ?? []),
        );
      }
      return dedupedSorted(impacted);
    };
  }

  if (
    primary.finalizeVersionWrites ||
    secondaries.some((strategy) => strategy.finalizeVersionWrites)
  ) {
    composite.finalizeVersionWrites = (
      cwd: string,
      writes: StrategyVersionWriteContext[],
      context: StrategyFinalizeContext,
    ): string[] => {
      const updated: string[] = [];
      updated.push(
        ...(primary.finalizeVersionWrites?.(cwd, writes, context) ?? []),
      );
      for (const secondary of secondaries) {
        updated.push(
          ...(secondary.finalizeVersionWrites?.(cwd, writes, context) ?? []),
        );
      }
      return dedupedSorted(updated);
    };
  }

  return composite;
}
