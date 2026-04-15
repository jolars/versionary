import { describe, expect, it } from "vitest";
import {
  analyzeCommits,
  analyzeParsedCommits,
  applyRevertSuppression,
  isReleasableCommit,
  isReleasableParsedCommit,
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

  it("treats parsed breaking commit as releasable", () => {
    const release = analyzeParsedCommits([
      {
        hash: "abc9def",
        subject: "docs: update migration note",
        body: "BREAKING CHANGE: config format changed",
        fullMessage:
          "docs: update migration note\n\nBREAKING CHANGE: config format changed",
        type: "docs",
        scope: null,
        description: "update migration note",
        isBreaking: true,
        isRevert: false,
        footers: [
          {
            token: "BREAKING CHANGE",
            value: "config format changed",
          },
        ],
        revertedShas: [],
      },
    ]);
    expect(release).toBe("major");
  });

  it("suppresses reverted commits by SHA", () => {
    const effective = applyRevertSuppression([
      {
        hash: "abcdef1",
        subject: "feat: add capability",
        body: "",
        fullMessage: "feat: add capability",
        type: "feat",
        scope: null,
        description: "add capability",
        isBreaking: false,
        isRevert: false,
        footers: [],
        revertedShas: [],
      },
      {
        hash: "abcdef2",
        subject: "revert: feat: add capability",
        body: "This reverts commit abcdef1.",
        fullMessage:
          "revert: feat: add capability\n\nThis reverts commit abcdef1.",
        type: "revert",
        scope: null,
        description: "feat: add capability",
        isBreaking: false,
        isRevert: true,
        footers: [],
        revertedShas: ["abcdef1"],
      },
    ]);
    expect(effective.map((commit) => commit.hash)).toEqual(["abcdef2"]);
  });

  it("analyzes parsed commits with revert suppression", () => {
    const release = analyzeParsedCommits([
      {
        hash: "abc1def",
        subject: "feat: add x",
        body: "",
        fullMessage: "feat: add x",
        type: "feat",
        scope: null,
        description: "add x",
        isBreaking: false,
        isRevert: false,
        footers: [],
        revertedShas: [],
      },
      {
        hash: "abc2def",
        subject: "revert: feat: add x",
        body: "This reverts commit abc1def.",
        fullMessage: "revert: feat: add x\n\nThis reverts commit abc1def.",
        type: "revert",
        scope: null,
        description: "feat: add x",
        isBreaking: false,
        isRevert: true,
        footers: [],
        revertedShas: ["abc1def"],
      },
      {
        hash: "abc3def",
        subject: "fix: patch y",
        body: "",
        fullMessage: "fix: patch y",
        type: "fix",
        scope: null,
        description: "patch y",
        isBreaking: false,
        isRevert: false,
        footers: [],
        revertedShas: [],
      },
    ]);
    expect(release).toBe("patch");
  });

  it("marks parsed releasable commits correctly", () => {
    expect(
      isReleasableParsedCommit({
        hash: "1234567",
        subject: "feat!: break API",
        body: "",
        fullMessage: "feat!: break API",
        type: "feat",
        scope: null,
        description: "break API",
        isBreaking: true,
        isRevert: false,
        footers: [],
        revertedShas: [],
      }),
    ).toBe(true);
  });
});
