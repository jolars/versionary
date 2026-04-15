import { describe, expect, it } from "vitest";
import {
  isReleaseCommitMessage,
  renderSimpleReviewRequestBody,
  splitSafeDirtyFiles,
} from "../src/app/release/pr.js";
import { parseConventionalCommitMessage } from "../src/infra/git/commits.js";

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
    const result = splitSafeDirtyFiles([
      "pnpm-lock.yaml",
      "src/cli/index.ts",
      "package-lock.json",
    ]);
    expect(result.ignored).toEqual(["pnpm-lock.yaml", "package-lock.json"]);
    expect(result.blocking).toEqual(["src/cli/index.ts"]);
  });

  it("blocks unknown tracked files", () => {
    const result = splitSafeDirtyFiles([
      "README.md",
      ".github/workflows/ci.yml",
    ]);
    expect(result.ignored).toEqual([]);
    expect(result.blocking).toEqual(["README.md", ".github/workflows/ci.yml"]);
  });
});

describe("review request body rendering", () => {
  it("groups releasable commits and omits ci/chore", () => {
    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    let body = "";
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/versionary";
      body = renderSimpleReviewRequestBody("1.2.3", [
        {
          ...parseConventionalCommitMessage("ci: tweak workflow"),
          hash: "aaaaaaa",
        },
        {
          ...parseConventionalCommitMessage("chore: bump deps"),
          hash: "bbbbbbb",
        },
        {
          ...parseConventionalCommitMessage(
            "feat(editors): add awesome feature",
          ),
          hash: "ccccccc1",
        },
        {
          ...parseConventionalCommitMessage("fix(lsp): patch bug"),
          hash: "ddddddd2",
        },
        {
          ...parseConventionalCommitMessage("feat!: breaking API change"),
          hash: "eeeeeee3",
        },
      ]);
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }

    expect(body).toContain("This PR prepares **v1.2.3**.");
    expect(body).toContain("### Breaking changes");
    expect(body).toContain("### Features");
    expect(body).toContain("### Fixes");
    expect(body).toContain(
      "- breaking API change ([`eeeeeee`](https://github.com/jolars/versionary/commit/eeeeeee3))",
    );
    expect(body).toContain(
      "- **editors:** add awesome feature ([`ccccccc`](https://github.com/jolars/versionary/commit/ccccccc1))",
    );
    expect(body).toContain(
      "- **lsp:** patch bug ([`ddddddd`](https://github.com/jolars/versionary/commit/ddddddd2))",
    );
    expect(body).not.toContain("ci: tweak workflow");
    expect(body).not.toContain("chore: bump deps");
  });
});
