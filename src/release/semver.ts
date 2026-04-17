export type ReleaseType = "major" | "minor" | "patch" | null;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
}

export interface BumpVersionOptions {
  allowStableMajor?: boolean;
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const COMPAT_DOTTED_PRERELEASE_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function normalizeVersionInput(version: string): string {
  const trimmed = version.trim();
  const compatMatch = trimmed.match(COMPAT_DOTTED_PRERELEASE_PATTERN);
  if (!compatMatch) {
    return trimmed;
  }
  const [, major, minor, patch, prerelease] = compatMatch;
  return `${major}.${minor}.${patch}-${prerelease}`;
}

export function parseVersion(version: string): ParsedVersion {
  const normalized = normalizeVersionInput(version);
  const match = normalized.match(SEMVER_PATTERN);
  if (!match) {
    throw new Error(
      `Invalid version in version file: "${version}". Expected SemVer 2.0.0 format (or compatibility form X.Y.Z.W).`,
    );
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
    build: match[5] ? match[5].split(".") : [],
  };
}

export function isValidVersion(version: string): boolean {
  return SEMVER_PATTERN.test(normalizeVersionInput(version));
}

function isNumericIdentifier(identifier: string): boolean {
  return /^(0|[1-9]\d*)$/u.test(identifier);
}

function comparePreReleaseIdentifiers(left: string, right: string): number {
  const leftNumeric = isNumericIdentifier(left);
  const rightNumeric = isNumericIdentifier(right);
  if (leftNumeric && rightNumeric) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (leftNumber < rightNumber) {
      return -1;
    }
    if (leftNumber > rightNumber) {
      return 1;
    }
    return 0;
  }

  if (leftNumeric && !rightNumeric) {
    return -1;
  }

  if (!leftNumeric && rightNumeric) {
    return 1;
  }

  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function compareVersions(leftRaw: string, rightRaw: string): number {
  const left = parseVersion(leftRaw);
  const right = parseVersion(rightRaw);

  if (left.major !== right.major) {
    return left.major < right.major ? -1 : 1;
  }
  if (left.minor !== right.minor) {
    return left.minor < right.minor ? -1 : 1;
  }
  if (left.patch !== right.patch) {
    return left.patch < right.patch ? -1 : 1;
  }

  const leftPre = left.prerelease;
  const rightPre = right.prerelease;
  if (leftPre.length === 0 && rightPre.length === 0) {
    return 0;
  }
  if (leftPre.length === 0) {
    return 1;
  }
  if (rightPre.length === 0) {
    return -1;
  }

  const maxLength = Math.max(leftPre.length, rightPre.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = leftPre[index];
    const rightIdentifier = rightPre[index];
    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }
    const comparison = comparePreReleaseIdentifiers(
      leftIdentifier,
      rightIdentifier,
    );
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

export function bumpVersion(
  current: string,
  releaseType: Exclude<ReleaseType, null>,
  options: BumpVersionOptions = {},
): string {
  const parsed = parseVersion(current);
  const allowStableMajor = options.allowStableMajor ?? false;
  if (releaseType === "major") {
    if (parsed.major === 0 && !allowStableMajor) {
      return `0.${parsed.minor + 1}.0`;
    }
    if (parsed.major === 0 && allowStableMajor) {
      return "1.0.0";
    }
    return `${parsed.major + 1}.0.0`;
  }

  if (releaseType === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}
