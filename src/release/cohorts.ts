import { createHash } from "node:crypto";
import type { ReleasePlan } from "./plan.js";

export type ReleaseCohort = string[];

function normalizedCohorts(cohorts: readonly ReleaseCohort[]): ReleaseCohort[] {
  return cohorts
    .map((cohort) => [...new Set(cohort)].sort((a, b) => a.localeCompare(b)))
    .filter((cohort) => cohort.length > 0)
    .sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
}

export function buildInitialReleaseCohorts(plan: ReleasePlan): ReleaseCohort[] {
  const releasing = (plan.packages ?? [])
    .filter((pkg) => pkg.nextVersion)
    .map((pkg) => pkg.path)
    .sort((a, b) => a.localeCompare(b));
  const releasingSet = new Set(releasing);
  const parent = new Map(
    releasing.map((packagePath) => [packagePath, packagePath]),
  );
  const find = (packagePath: string): string => {
    const current = parent.get(packagePath) ?? packagePath;
    if (current === packagePath) {
      return current;
    }
    const root = find(current);
    parent.set(packagePath, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) {
      return;
    }
    const [first, second] = [leftRoot, rightRoot].sort((a, b) =>
      a.localeCompare(b),
    );
    if (first && second) {
      parent.set(second, first);
    }
  };

  for (const pkg of plan.packages ?? []) {
    if (!pkg.nextVersion || !releasingSet.has(pkg.path)) {
      continue;
    }
    for (const sourcePath of pkg.dependencySourcePaths ?? []) {
      if (releasingSet.has(sourcePath)) {
        union(pkg.path, sourcePath);
      }
    }
  }

  const grouped = new Map<string, string[]>();
  for (const packagePath of releasing) {
    const root = find(packagePath);
    grouped.set(root, [...(grouped.get(root) ?? []), packagePath]);
  }
  return normalizedCohorts([...grouped.values()]);
}

function overlaps(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

export function stabilizeReleaseCohorts(
  initial: readonly ReleaseCohort[],
  changedFilesFor: (packagePaths: ReleaseCohort) => readonly string[],
): ReleaseCohort[] {
  let cohorts = normalizedCohorts(initial);
  while (cohorts.length > 1) {
    const footprints = cohorts.map(
      (cohort) =>
        new Set(
          changedFilesFor(cohort).map((file) => file.replaceAll("\\", "/")),
        ),
    );
    const parent = cohorts.map((_, index) => index);
    const find = (index: number): number => {
      const current = parent[index] ?? index;
      if (current === index) {
        return current;
      }
      const root = find(current);
      parent[index] = root;
      return root;
    };
    const union = (left: number, right: number): void => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) {
        parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
      }
    };

    for (let left = 0; left < cohorts.length; left += 1) {
      for (let right = left + 1; right < cohorts.length; right += 1) {
        if (
          overlaps(
            footprints[left] ?? new Set(),
            footprints[right] ?? new Set(),
          )
        ) {
          union(left, right);
        }
      }
    }

    const merged = new Map<number, string[]>();
    for (let index = 0; index < cohorts.length; index += 1) {
      const root = find(index);
      merged.set(root, [
        ...(merged.get(root) ?? []),
        ...(cohorts[index] ?? []),
      ]);
    }
    const next = normalizedCohorts([...merged.values()]);
    if (next.length === cohorts.length) {
      return cohorts;
    }
    cohorts = next;
  }
  return cohorts;
}

// The prefix shared by every separate release branch. It is the configured
// release branch itself, so listing on it also matches the legacy single
// release branch left behind by repos migrating from the combined PR flow.
export function resolveSeparateReleaseBranchPrefix(prefix: string): string {
  return prefix.replace(/\/+$/gu, "");
}

export function resolveSeparateReleaseBranch(
  prefix: string,
  releaseName: string,
  packagePath: string,
): string {
  const normalizedPrefix = resolveSeparateReleaseBranchPrefix(prefix);
  const slug =
    releaseName
      .trim()
      .replace(/^@/u, "")
      .replace(/[^A-Za-z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "package";
  const digest = createHash("sha256")
    .update(packagePath)
    .digest("hex")
    .slice(0, 12);
  // A sibling of the legacy release branch, not a child of it: git cannot hold
  // both `refs/heads/<prefix>` and `refs/heads/<prefix>/<name>`, and repos
  // migrating from the combined PR flow still have the former on the remote.
  return `${normalizedPrefix}-${slug}-${digest}`;
}
