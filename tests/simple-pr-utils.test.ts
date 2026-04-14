import { describe, expect, it } from "vitest";
import { isReleaseCommitMessage, splitSafeDirtyFiles } from "../src/simple/pr.js";

describe("release commit detection", () => {
  it("matches release commit pattern", () => {
    expect(isReleaseCommitMessage("chore(release): v1.2.3")).toBe(true);
  });

  it("rejects non-release messages", () => {
    expect(isReleaseCommitMessage("feat: add feature")).toBe(false);
    expect(isReleaseCommitMessage("chore(release): prepare")).toBe(false);
  });
});

describe("safe dirty file splitting", () => {
  it("ignores lockfiles but blocks source edits", () => {
    const result = splitSafeDirtyFiles(["pnpm-lock.yaml", "src/cli/index.ts", "package-lock.json"]);
    expect(result.ignored).toEqual(["pnpm-lock.yaml", "package-lock.json"]);
    expect(result.blocking).toEqual(["src/cli/index.ts"]);
  });

  it("blocks unknown tracked files", () => {
    const result = splitSafeDirtyFiles(["README.md", ".github/workflows/ci.yml"]);
    expect(result.ignored).toEqual([]);
    expect(result.blocking).toEqual(["README.md", ".github/workflows/ci.yml"]);
  });
});
