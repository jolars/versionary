import type { ReleaseTargetState } from "./state.js";

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right);
}

function buildDependencyGraph(
  targets: readonly ReleaseTargetState[],
): Map<string, Set<string>> {
  const releasingPaths = new Set(targets.map((target) => target.path));
  return new Map(
    targets.map((target) => [
      target.path,
      new Set(
        (target.dependencies ?? []).filter(
          (dependencyPath) =>
            dependencyPath !== target.path &&
            releasingPaths.has(dependencyPath),
        ),
      ),
    ]),
  );
}

/**
 * Return the paths that actually sit on a dependency cycle, meaning those that
 * are reachable from themselves. Packages that merely depend on a cycle are
 * blocked by it but are not part of it, so naming them would send maintainers
 * to inspect manifests that are fine.
 */
function findCyclicPaths(graph: Map<string, Set<string>>): string[] {
  const cyclic: string[] = [];
  for (const path of graph.keys()) {
    const seen = new Set<string>();
    const stack = [...(graph.get(path) ?? [])];
    let onCycle = false;
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (current === path) {
        onCycle = true;
        break;
      }
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      stack.push(...(graph.get(current) ?? []));
    }
    if (onCycle) {
      cyclic.push(path);
    }
  }
  return cyclic.sort(comparePaths);
}

export interface ReleaseTargetOrder {
  ordered: ReleaseTargetState[];
  cyclicPaths: string[];
}

/**
 * Return a deterministic dependency-first handoff for downstream publishers.
 * Dependencies outside this release set are already published and do not
 * constrain the current targets.
 *
 * A cycle cannot be ordered dependency-first, so the remaining targets are
 * emitted in package-path order instead. The ordering is advisory metadata, so
 * degrading it must not block tagging; callers surface `cyclicPaths` so the
 * cycle still gets reported.
 */
export function orderReleaseTargets(
  targets: readonly ReleaseTargetState[],
): ReleaseTargetOrder {
  const graph = buildDependencyGraph(targets);
  const remaining = [...targets].sort((left, right) =>
    comparePaths(left.path, right.path),
  );
  const emitted = new Set<string>();
  const ordered: ReleaseTargetState[] = [];

  while (remaining.length > 0) {
    const readyIndex = remaining.findIndex((target) =>
      [...(graph.get(target.path) ?? [])].every((dependencyPath) =>
        emitted.has(dependencyPath),
      ),
    );
    // Nothing is ready only when every remaining target waits on a cycle;
    // break the deadlock with the first target in package-path order.
    const [target] = remaining.splice(readyIndex === -1 ? 0 : readyIndex, 1);
    if (!target) {
      continue;
    }
    ordered.push(target);
    emitted.add(target.path);
  }

  return { ordered, cyclicPaths: findCyclicPaths(graph) };
}

export function releaseTargetHandoff(
  targets: readonly ReleaseTargetState[],
  logger?: { warn: (message: string) => void },
): Array<ReleaseTargetState & { dependencies: string[] }> {
  const { ordered, cyclicPaths } = orderReleaseTargets(targets);
  if (cyclicPaths.length > 0) {
    const quoted = cyclicPaths.map((path) => `"${path}"`).join(", ");
    logger?.warn(
      `Release dependencies contain a cycle: ${quoted}. Publishing order for those packages falls back to package-path order.`,
    );
  }
  const releasingPaths = new Set(targets.map((target) => target.path));
  return ordered.map((target) => ({
    ...target,
    // Dependencies outside the release set are already published, and the
    // documented contract is that every entry names a target in this handoff.
    dependencies: [...new Set(target.dependencies ?? [])]
      .filter(
        (dependencyPath) =>
          dependencyPath !== target.path && releasingPaths.has(dependencyPath),
      )
      .sort(comparePaths),
  }));
}
