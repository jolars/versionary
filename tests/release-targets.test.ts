import { describe, expect, it, vi } from "vitest";
import {
  orderReleaseTargets,
  releaseTargetHandoff,
} from "../src/release/targets.js";

describe("release target ordering", () => {
  it("orders dependent release targets after their dependencies", () => {
    expect(
      orderReleaseTargets([
        {
          path: ".",
          version: "3.7.0",
          tag: "v3.7.0",
          dependencies: ["crates/panache-formatter", "crates/panache-parser"],
        },
        {
          path: "crates/panache-formatter",
          version: "0.22.0",
          tag: "panache-formatter-v0.22.0",
          dependencies: ["crates/panache-parser"],
        },
        {
          path: "crates/panache-parser",
          version: "0.28.0",
          tag: "panache-parser-v0.28.0",
          dependencies: [],
        },
        {
          path: "editors/code",
          version: "3.7.0",
          tag: "panache-code-v3.7.0",
          dependencies: ["."],
        },
      ]).ordered.map((target) => target.path),
    ).toEqual([
      "crates/panache-parser",
      "crates/panache-formatter",
      ".",
      "editors/code",
    ]);
  });

  it("uses package paths as a deterministic tie-breaker", () => {
    expect(
      orderReleaseTargets([
        { path: "packages/b", version: "1.0.0", tag: "b-v1.0.0" },
        { path: "packages/a", version: "1.0.0", tag: "a-v1.0.0" },
      ]).ordered.map((target) => target.path),
    ).toEqual(["packages/a", "packages/b"]);
  });

  it("falls back to package-path order for dependency cycles", () => {
    const { ordered, cyclicPaths } = orderReleaseTargets([
      {
        path: "packages/b",
        version: "1.0.0",
        tag: "b-v1.0.0",
        dependencies: ["packages/a"],
      },
      {
        path: "packages/a",
        version: "1.0.0",
        tag: "a-v1.0.0",
        dependencies: ["packages/b"],
      },
    ]);
    expect(ordered.map((target) => target.path)).toEqual([
      "packages/a",
      "packages/b",
    ]);
    expect(cyclicPaths).toEqual(["packages/a", "packages/b"]);
  });

  it("reports only the packages that sit on the cycle", () => {
    const { ordered, cyclicPaths } = orderReleaseTargets([
      {
        path: "packages/a",
        version: "1.0.0",
        tag: "a-v1.0.0",
        dependencies: ["packages/b"],
      },
      {
        path: "packages/b",
        version: "1.0.0",
        tag: "b-v1.0.0",
        dependencies: ["packages/a"],
      },
      {
        path: "packages/c",
        version: "1.0.0",
        tag: "c-v1.0.0",
        dependencies: ["packages/a"],
      },
    ]);
    expect(cyclicPaths).toEqual(["packages/a", "packages/b"]);
    // The package that merely depends on the cycle still lands after it.
    expect(ordered.map((target) => target.path)).toEqual([
      "packages/a",
      "packages/b",
      "packages/c",
    ]);
  });
});

describe("release target handoff", () => {
  it("keeps only dependencies inside the release set", () => {
    expect(
      releaseTargetHandoff([
        {
          path: "packages/a",
          version: "1.0.0",
          tag: "a-v1.0.0",
          dependencies: ["packages/b", "packages/unreleased", "packages/a"],
        },
        {
          path: "packages/b",
          version: "1.0.0",
          tag: "b-v1.0.0",
        },
      ]),
    ).toEqual([
      {
        path: "packages/b",
        version: "1.0.0",
        tag: "b-v1.0.0",
        dependencies: [],
      },
      {
        path: "packages/a",
        version: "1.0.0",
        tag: "a-v1.0.0",
        dependencies: ["packages/b"],
      },
    ]);
  });

  it("warns about cycles instead of failing the release", () => {
    const warn = vi.fn();
    const handoff = releaseTargetHandoff(
      [
        {
          path: "packages/a",
          version: "1.0.0",
          tag: "a-v1.0.0",
          dependencies: ["packages/b"],
        },
        {
          path: "packages/b",
          version: "1.0.0",
          tag: "b-v1.0.0",
          dependencies: ["packages/a"],
        },
      ],
      { warn },
    );
    expect(handoff.map((target) => target.path)).toEqual([
      "packages/a",
      "packages/b",
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Release dependencies contain a cycle: "packages/a", "packages/b".',
      ),
    );
  });
});
