import { describe, expect, it } from "vitest";
import {
  analyzeCommits,
  analyzeParsedCommits,
  applyRevertSuppression,
  getCommitParseDiagnostics,
  isReleasableCommit,
  isReleasableParsedCommit,
  parseConventionalCommitMessage,
} from "../src/git/commits.js";

describe("simple commit analysis", () => {
  it("returns highest bump type", () => {
    const release = analyzeCommits([
      { hash: "a", subject: "fix: patch issue" },
      { hash: "b", subject: "feat: add thing" },
    ]);
    expect(release).toBe("minor");
  });

  it("treats revert commits as patch releases", () => {
    const release = analyzeCommits([
      { hash: "a", subject: "revert: feat: add thing" },
    ]);
    expect(release).toBe("patch");
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
    expect(isReleasableCommit("revert: feat: add thing")).toBe(true);
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

  it("parses structured ast fields for a valid conventional commit", () => {
    const parsed = parseConventionalCommitMessage(
      "feat(ng-list): Allow custom separator",
      "bla bla bla\n\nBREAKING CHANGE: some breaking change.\nThanks @stevemao\nCloses #1",
    );

    expect(parsed.type).toBe("feat");
    expect(parsed.scope).toBe("ng-list");
    expect(parsed.description).toBe("Allow custom separator");
    expect(parsed.body).toBe("bla bla bla");
    expect(parsed.footer).toContain("BREAKING CHANGE: some breaking change.");
    expect(parsed.notes).toEqual([
      {
        title: "BREAKING CHANGE",
        text: "some breaking change.\nThanks @stevemao",
      },
    ]);
    expect(parsed.references).toEqual([
      {
        action: "Closes",
        owner: null,
        repository: null,
        issue: "1",
        raw: "#1",
        prefix: "#",
      },
    ]);
    expect(parsed.mentions).toContain("stevemao");
  });

  it("captures malformed header diagnostics", () => {
    const parsed = parseConventionalCommitMessage("invalid header");
    const diagnostics = getCommitParseDiagnostics(parsed);
    expect(diagnostics.some((d) => d.code === "invalid-header")).toBe(true);
  });

  it("captures malformed breaking footer diagnostics", () => {
    const parsed = parseConventionalCommitMessage(
      "feat: add parser support",
      "BREAKING CHANGE this misses colon",
    );
    const diagnostics = getCommitParseDiagnostics(parsed);
    expect(
      diagnostics.some((d) => d.code === "malformed-breaking-footer"),
    ).toBe(true);
  });

  it("captures malformed reference diagnostics", () => {
    const parsed = parseConventionalCommitMessage(
      "fix: patch bug",
      "Refs: GH-abc",
    );
    const diagnostics = getCommitParseDiagnostics(parsed);
    expect(diagnostics.some((d) => d.code === "malformed-reference")).toBe(
      true,
    );
  });

  it("extracts inline closing references from body sentences", () => {
    const parsed = parseConventionalCommitMessage(
      "feat: support smart punctuation",
      "Add smart punctuation conversion. Closes #182",
    );
    expect(parsed.references).toContainEqual({
      action: "Closes",
      owner: null,
      repository: null,
      issue: "182",
      raw: "#182",
      prefix: "#",
    });
  });

  it("extracts inline owner/repo closing references from body sentences", () => {
    const parsed = parseConventionalCommitMessage(
      "feat: support smart punctuation",
      "Add smart punctuation conversion. Fixes octo-org/octo-repo#100",
    );
    expect(parsed.references).toContainEqual({
      action: "Fixes",
      owner: "octo-org",
      repository: "octo-repo",
      issue: "100",
      raw: "octo-org/octo-repo#100",
      prefix: "#",
    });
  });

  it("deduplicates references regardless of action capitalization", () => {
    const parsed = parseConventionalCommitMessage(
      "fix(parser): handle bare #| comments",
      "Fixes #188, fixes #190\n\nfixes #190",
    );
    expect(parsed.references).toEqual([
      {
        action: "Fixes",
        owner: null,
        repository: null,
        issue: "188",
        raw: "#188",
        prefix: "#",
      },
      {
        action: "Fixes",
        owner: null,
        repository: null,
        issue: "190",
        raw: "#190",
        prefix: "#",
      },
    ]);
  });

  it("captures ambiguous revert diagnostics when no sha exists", () => {
    const parsed = parseConventionalCommitMessage(
      "revert: feat: add thing",
      "This reverts prior changes without a hash reference.",
    );
    const diagnostics = getCommitParseDiagnostics(parsed);
    expect(diagnostics.some((d) => d.code === "ambiguous-revert")).toBe(true);
    expect(parsed.revert).toEqual({
      header: "revert: feat: add thing",
      hashes: [],
    });
  });
});
