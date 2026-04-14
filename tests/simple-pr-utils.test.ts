import { describe, expect, it } from "vitest";
import { isReleaseCommitMessage, renderSimpleReviewRequestBody, splitSafeDirtyFiles } from "../src/simple/pr.js";

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

describe("review request body rendering", () => {
  it("groups releasable commits and omits ci/chore", () => {
    const body = renderSimpleReviewRequestBody("1.2.3", [
      { hash: "aaaaaaa", subject: "ci: tweak workflow" },
      { hash: "bbbbbbb", subject: "chore: bump deps" },
      { hash: "ccccccc", subject: "feat: add awesome feature" },
      { hash: "ddddddd", subject: "fix: patch bug" },
      { hash: "eeeeeee", subject: "feat!: breaking API change" },
    ]);

    expect(body).toContain("This PR prepares **v1.2.3**.");
    expect(body).toContain("### Breaking changes");
    expect(body).toContain("### Features");
    expect(body).toContain("### Fixes");
    expect(body).toContain("- feat!: breaking API change (eeeeeee)");
    expect(body).toContain("- feat: add awesome feature (ccccccc)");
    expect(body).toContain("- fix: patch bug (ddddddd)");
    expect(body).not.toContain("ci: tweak workflow");
    expect(body).not.toContain("chore: bump deps");
  });
});
