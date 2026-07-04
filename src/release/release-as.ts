import type { ParsedCommit } from "../git/commits.js";
import {
  compareVersions,
  isValidVersion,
  parseVersion,
  type ReleaseType,
} from "./semver.js";

/**
 * Footer token (case-insensitive) that requests an explicit next version, e.g.
 *
 *   chore: graduate to stable release
 *
 *   Release-As: 1.0.0
 *
 * The override forces a release with the requested version even when the
 * conventional-commit analysis alone would produce no bump.
 */
export const RELEASE_AS_FOOTER_TOKEN = "release-as";

export interface ReleaseAsOverride {
  /** The requested target version (leading `v` stripped, validated SemVer). */
  version: string;
  /** Hash of the commit carrying the winning footer. */
  sourceHash: string;
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

/**
 * Scan a release window for a `Release-As:` footer override.
 *
 * Returns the explicit target version, or `null` when no footer is present.
 * Throws on an invalid version, a downgrade or no-op relative to
 * `currentVersion`, or conflicting override versions within the window.
 */
export function resolveReleaseAsOverride(
  commits: ParsedCommit[],
  currentVersion: string,
): ReleaseAsOverride | null {
  const overrides: ReleaseAsOverride[] = [];
  for (const commit of commits) {
    for (const footer of commit.footers) {
      if (normalizeToken(footer.token) !== RELEASE_AS_FOOTER_TOKEN) {
        continue;
      }
      const raw = footer.value.trim().replace(/^v/u, "");
      if (!isValidVersion(raw)) {
        throw new Error(
          `Invalid \`Release-As\` footer in commit ${commit.hash}: ` +
            `"${footer.value}" is not a valid SemVer version.`,
        );
      }
      overrides.push({ version: raw, sourceHash: commit.hash });
    }
  }
  if (overrides.length === 0) {
    return null;
  }
  const distinct = [...new Set(overrides.map((override) => override.version))];
  if (distinct.length > 1) {
    throw new Error(
      `Conflicting \`Release-As\` footers in release window: ${distinct
        .map((version) => `"${version}"`)
        .join(", ")}. Only one target version may be requested.`,
    );
  }
  // All requested versions are identical here; the last footer wins.
  const override = overrides[overrides.length - 1] as ReleaseAsOverride;
  if (compareVersions(override.version, currentVersion) <= 0) {
    throw new Error(
      `\`Release-As\` footer requests ${override.version}, which is not ` +
        `greater than the current version ${currentVersion}. Downgrades and ` +
        `no-op releases are not allowed.`,
    );
  }
  return override;
}

/** Derive the semantic release level implied by moving `from` -> `to`. */
export function releaseTypeBetween(from: string, to: string): ReleaseType {
  const before = parseVersion(from);
  const after = parseVersion(to);
  if (after.major !== before.major) {
    return "major";
  }
  if (after.minor !== before.minor) {
    return "minor";
  }
  if (after.patch !== before.patch) {
    return "patch";
  }
  return null;
}
