export type ReleaseType = "major" | "minor" | "patch" | null;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(version: string): ParsedVersion {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid version in version file: "${version}". Expected x.y.z`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function bumpVersion(current: string, releaseType: Exclude<ReleaseType, null>): string {
  const parsed = parseVersion(current);
  if (releaseType === "major") {
    return `${parsed.major + 1}.0.0`;
  }

  if (releaseType === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}
