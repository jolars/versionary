import { describe, expect, it } from "vitest";
import {
  analyzeCommits,
  isReleasableCommit,
} from "../src/infra/git/commits.js";

describe("simple commit analysis", () => {
  it("returns highest bump type", () => {
    const release = analyzeCommits([
      { hash: "a", subject: "fix: patch issue" },
      { hash: "b", subject: "feat: add thing" },
    ]);
    expect(release).toBe("minor");
  });

  it("ignores revert commits", () => {
    const release = analyzeCommits([
      { hash: "a", subject: "revert: feat: add thing" },
    ]);
    expect(release).toBeNull();
  });

  it("ignores chore commits", () => {
    const release = analyzeCommits([
      { hash: "a", subject: "chore: update docs tooling" },
      { hash: "b", subject: "chore(ci): adjust workflow" },
    ]);
    expect(release).toBeNull();
  });

  it("still bumps on fix/feat while ignoring chore", () => {
    const release = analyzeCommits([
      { hash: "a", subject: "chore: update docs tooling" },
      { hash: "b", subject: "fix: handle edge case" },
    ]);
    expect(release).toBe("patch");
  });

  it("marks releasable commit types for changelog filtering", () => {
    expect(isReleasableCommit("feat: add thing")).toBe(true);
    expect(isReleasableCommit("fix: patch bug")).toBe(true);
    expect(isReleasableCommit("perf: speed things up")).toBe(true);
    expect(isReleasableCommit("refactor: internal cleanup")).toBe(false);
    expect(isReleasableCommit("ci: update workflow")).toBe(false);
    expect(isReleasableCommit("chore: bump deps")).toBe(false);
    expect(isReleasableCommit("revert: feat: add thing")).toBe(false);
  });
});
