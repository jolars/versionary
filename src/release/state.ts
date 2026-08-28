import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";

const MANIFEST_VERSION_KEY = "manifest-version";
const BASELINE_SHA_KEY = "baseline-sha";
const RELEASE_TARGETS_KEY = "release-targets";
const PENDING_RELEASE_TARGETS_KEY = "pending-release-targets";

interface SimpleStateFile {
  [MANIFEST_VERSION_KEY]?: number;
  [BASELINE_SHA_KEY]?: string;
  [RELEASE_TARGETS_KEY]?: ReleaseTargetState[];
  [PENDING_RELEASE_TARGETS_KEY]?: ReleaseTargetState[];
}

interface PackageStateFile {
  [MANIFEST_VERSION_KEY]: 1;
  path: string;
  [BASELINE_SHA_KEY]: string;
  "release-target": ReleaseTargetState;
  "release-branch": string;
}

export interface ReleaseTargetState {
  path: string;
  version: string;
  tag: string;
  dependencies?: string[];
}

export interface PendingReleaseCohort {
  branch: string;
  targets: ReleaseTargetState[];
}

function parseStateFile(raw: string, filePath: string): SimpleStateFile {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid release manifest at ${filePath}: expected an object.`,
    );
  }
  const manifest = parsed as Record<string, unknown>;
  if (
    manifest[MANIFEST_VERSION_KEY] !== undefined &&
    manifest[MANIFEST_VERSION_KEY] !== 1
  ) {
    throw new Error(
      `Unsupported ${MANIFEST_VERSION_KEY} in ${filePath}: ${String(manifest[MANIFEST_VERSION_KEY])}.`,
    );
  }
  if (
    manifest[BASELINE_SHA_KEY] !== undefined &&
    typeof manifest[BASELINE_SHA_KEY] !== "string"
  ) {
    throw new Error(
      `Invalid release manifest at ${filePath}: ${BASELINE_SHA_KEY} must be a string.`,
    );
  }
  validateReleaseTargets(
    manifest[RELEASE_TARGETS_KEY],
    RELEASE_TARGETS_KEY,
    filePath,
  );
  validateReleaseTargets(
    manifest[PENDING_RELEASE_TARGETS_KEY],
    PENDING_RELEASE_TARGETS_KEY,
    filePath,
  );
  return manifest as SimpleStateFile;
}

function validateReleaseTargets(
  value: unknown,
  key: string,
  filePath: string,
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `Invalid release manifest at ${filePath}: ${key} must be an array.`,
    );
  }
  for (const target of value) {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      throw new Error(
        `Invalid release manifest at ${filePath}: each release target must be an object.`,
      );
    }
    const record = target as Record<string, unknown>;
    if (
      typeof record.path !== "string" ||
      typeof record.version !== "string" ||
      typeof record.tag !== "string"
    ) {
      throw new Error(
        `Invalid release manifest at ${filePath}: ${key} must contain string path, version, and tag.`,
      );
    }
    if (
      record.dependencies !== undefined &&
      (!Array.isArray(record.dependencies) ||
        !record.dependencies.every(
          (dependency) => typeof dependency === "string",
        ))
    ) {
      throw new Error(
        `Invalid release manifest at ${filePath}: ${key} dependencies must be an array of package-path strings.`,
      );
    }
  }
}

export function getBaselineStatePath(cwd: string): string {
  const loaded = loadConfig(cwd);
  const configured = loaded.config["baseline-file"];
  if (configured) {
    return path.join(cwd, configured);
  }

  return path.join(cwd, ".versionary-manifest.json");
}

export function getPackageStateDirectory(cwd: string): string {
  return `${getBaselineStatePath(cwd)}.d`;
}

function packageStateFileName(packagePath: string): string {
  const slug =
    packagePath === "."
      ? "root"
      : packagePath
          .replaceAll("\\", "/")
          .replace(/[^A-Za-z0-9._-]+/gu, "-")
          .replace(/^-+|-+$/gu, "") || "package";
  const digest = createHash("sha256")
    .update(packagePath)
    .digest("hex")
    .slice(0, 12);
  return `${slug}-${digest}.json`;
}

function parsePackageStateFile(
  raw: string,
  filePath: string,
): PackageStateFile {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid package release state at ${filePath}: expected an object.`,
    );
  }
  const state = parsed as Record<string, unknown>;
  if (state[MANIFEST_VERSION_KEY] !== 1) {
    throw new Error(
      `Unsupported ${MANIFEST_VERSION_KEY} in ${filePath}: ${String(state[MANIFEST_VERSION_KEY])}.`,
    );
  }
  if (
    typeof state.path !== "string" ||
    typeof state[BASELINE_SHA_KEY] !== "string" ||
    typeof state["release-branch"] !== "string"
  ) {
    throw new Error(
      `Invalid package release state at ${filePath}: path, baseline-sha, and release-branch must be strings.`,
    );
  }
  validateReleaseTargets([state["release-target"]], "release-target", filePath);
  const target = state["release-target"] as ReleaseTargetState;
  if (target.path !== state.path) {
    throw new Error(
      `Invalid package release state at ${filePath}: release target path must match state path.`,
    );
  }
  return state as unknown as PackageStateFile;
}

function readPackageStates(cwd: string): PackageStateFile[] {
  const directory = getPackageStateDirectory(cwd);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(directory, entry.name);
      return parsePackageStateFile(fs.readFileSync(filePath, "utf8"), filePath);
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function readBaselineSha(cwd = process.cwd()): string | null {
  const filePath = getBaselineStatePath(cwd);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const parsed = parseStateFile(fs.readFileSync(filePath, "utf8"), filePath);
  return parsed[BASELINE_SHA_KEY] ?? null;
}

// Accumulated per-package baseline: the latest released tag for every package
// ever released. `plan` uses these tags as the commit-range floor per package,
// so this list must persist entries across releases rather than be replaced.
export function readReleaseTargets(cwd = process.cwd()): ReleaseTargetState[] {
  const filePath = getBaselineStatePath(cwd);
  const legacyTargets = fs.existsSync(filePath)
    ? (parseStateFile(fs.readFileSync(filePath, "utf8"), filePath)[
        RELEASE_TARGETS_KEY
      ] ?? [])
    : [];
  const packageTargets = readPackageStates(cwd).map(
    (state) => state["release-target"],
  );
  return [
    ...new Map(
      [...legacyTargets, ...packageTargets].map((target) => [
        target.path,
        target,
      ]),
    ).values(),
  ].sort((a, b) => a.path.localeCompare(b.path));
}

// The publish set introduced by the current release PR. `release` consumes this
// so it only publishes/announces what this PR bumped, not every package in the
// accumulated baseline.
export function readPendingReleaseTargets(
  cwd = process.cwd(),
): ReleaseTargetState[] {
  return collectPendingReleaseCohorts(cwd, {
    allowPartiallyTagged: true,
  }).flatMap((cohort) => cohort.targets);
}

// Every target the release state records, including cohorts whose tags already
// exist. `release` needs these to tell "this repo never recorded a release"
// apart from "this release was already published"; only the former may fall
// back to tagging the root package.
export function readRecordedPendingReleaseTargets(
  cwd = process.cwd(),
): ReleaseTargetState[] {
  return collectPendingReleaseCohorts(cwd, {
    allowPartiallyTagged: true,
    includeFullyTagged: true,
  }).flatMap((cohort) => cohort.targets);
}

export function readPendingReleaseCohorts(
  cwd = process.cwd(),
): PendingReleaseCohort[] {
  return collectPendingReleaseCohorts(cwd, {});
}

function collectPendingReleaseCohorts(
  cwd: string,
  options: {
    allowPartiallyTagged?: boolean;
    includeFullyTagged?: boolean;
  },
): PendingReleaseCohort[] {
  const filePath = getBaselineStatePath(cwd);
  const packageStates = readPackageStates(cwd);
  const sidecarPaths = new Set(packageStates.map((state) => state.path));
  const byBranch = new Map<string, ReleaseTargetState[]>();
  for (const state of packageStates) {
    const targets = byBranch.get(state["release-branch"]) ?? [];
    targets.push(state["release-target"]);
    byBranch.set(state["release-branch"], targets);
  }
  if (fs.existsSync(filePath)) {
    const parsed = parseStateFile(fs.readFileSync(filePath, "utf8"), filePath);
    const legacyPending = (parsed[PENDING_RELEASE_TARGETS_KEY] ?? []).filter(
      (target) => !sidecarPaths.has(target.path),
    );
    if (legacyPending.length > 0) {
      const branch =
        loadConfig(cwd).config["release-branch"] ?? "versionary/release";
      byBranch.set(branch, [...(byBranch.get(branch) ?? []), ...legacyPending]);
    }
  }

  const pending: PendingReleaseCohort[] = [];
  for (const [branch, unsortedTargets] of byBranch) {
    const targets = [...unsortedTargets].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    const tagged = targets.filter((target) => hasLocalTag(cwd, target.tag));
    if (tagged.length === targets.length && !options.includeFullyTagged) {
      continue;
    }
    if (
      tagged.length > 0 &&
      tagged.length < targets.length &&
      !options.allowPartiallyTagged
    ) {
      const existingTags = tagged.map((target) => target.tag).join(", ");
      const missingTags = targets
        .filter((target) => !tagged.includes(target))
        .map((target) => target.tag)
        .join(", ");
      throw new Error(
        `Pending release cohort on ${branch} is partially tagged and cannot move safely. Existing tags: ${existingTags}. Missing tags: ${missingTags}. Rerun the original release workflow to complete it.`,
      );
    }
    pending.push({ branch, targets });
  }
  return pending.sort((a, b) => a.branch.localeCompare(b.branch));
}

function hasLocalTag(cwd: string, tag: string): boolean {
  try {
    execFileSync(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`],
      {
        cwd,
        stdio: "ignore",
      },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Pending targets remain in the manifest after publishing, so the tag set is
 * the durable evidence that the pending release actually completed.
 */
export function hasFullyUntaggedPendingRelease(cwd = process.cwd()): boolean {
  return readPendingReleaseCohorts(cwd).length > 0;
}

export function writePackageReleaseState(
  cwd: string,
  baselineSha: string,
  releaseTargets: ReleaseTargetState[],
  branch: string,
): string[] {
  const directory = getPackageStateDirectory(cwd);
  fs.mkdirSync(directory, { recursive: true });
  const written: string[] = [];
  for (const target of releaseTargets) {
    const filePath = path.join(directory, packageStateFileName(target.path));
    const state: PackageStateFile = {
      [MANIFEST_VERSION_KEY]: 1,
      path: target.path,
      [BASELINE_SHA_KEY]: baselineSha,
      "release-target": target,
      "release-branch": branch,
    };
    fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    written.push(path.relative(cwd, filePath));
  }
  return written.sort((a, b) => a.localeCompare(b));
}

export function hasReleaseStateChangeAtHead(cwd = process.cwd()): boolean {
  const relativeDirectory = path.relative(cwd, getPackageStateDirectory(cwd));
  try {
    const changed = execFileSync(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD^", "HEAD"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return changed.some(
      (entry) =>
        entry === relativeDirectory ||
        entry.startsWith(`${relativeDirectory}${path.sep}`) ||
        entry.startsWith(`${relativeDirectory}/`),
    );
  } catch {
    return false;
  }
}

export function writeBaselineSha(
  cwd = process.cwd(),
  sha?: string,
  releaseTargets?: ReleaseTargetState[],
): string[] {
  const baselineShaValue =
    sha ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  const filePath = getBaselineStatePath(cwd);
  const existing = fs.existsSync(filePath)
    ? parseStateFile(fs.readFileSync(filePath, "utf8"), filePath)
    : {};
  const existingTargets = existing[RELEASE_TARGETS_KEY] ?? [];
  // Merge the current targets into the accumulated baseline (latest tag per
  // path wins, since `releaseTargets` is appended last), but record the current
  // targets verbatim as the pending publish set.
  const nextTargets =
    releaseTargets === undefined
      ? existingTargets
      : [
          ...new Map(
            [...existingTargets, ...releaseTargets].map((target) => [
              target.path,
              target,
            ]),
          ).values(),
        ].sort((a, b) => a.path.localeCompare(b.path));
  const nextPending =
    releaseTargets === undefined
      ? (existing[PENDING_RELEASE_TARGETS_KEY] ?? [])
      : [...releaseTargets].sort((a, b) => a.path.localeCompare(b.path));
  const next: SimpleStateFile = {
    [MANIFEST_VERSION_KEY]: 1,
    [BASELINE_SHA_KEY]: baselineShaValue,
    [RELEASE_TARGETS_KEY]: nextTargets,
    [PENDING_RELEASE_TARGETS_KEY]: nextPending,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  const written = [path.relative(cwd, filePath)];
  if (
    releaseTargets !== undefined &&
    fs.existsSync(getPackageStateDirectory(cwd))
  ) {
    written.push(
      ...writePackageReleaseState(
        cwd,
        baselineShaValue,
        releaseTargets,
        loadConfig(cwd).config["release-branch"] ?? "versionary/release",
      ),
    );
  }
  return written.sort((a, b) => a.localeCompare(b));
}
