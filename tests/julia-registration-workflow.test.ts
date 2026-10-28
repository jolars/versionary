import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

const workflow = parse(
  fs.readFileSync(
    fileURLToPath(new URL("../examples/julia-release.yml", import.meta.url)),
    "utf8",
  ),
);
const script = workflow.jobs.versionary.steps.find(
  (step: { name?: string }) => step.name === "Request Julia registration",
).with.script;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const register = new AsyncFunction(
  "github",
  "context",
  "core",
  "process",
  script,
);
const target = {
  path: ".",
  version: "1.0.1",
  tag: "v1.0.1",
  sha: "a".repeat(40),
  notes: "Reviewed release notes.",
};

function setup() {
  const comments: { user: { login: string }; body: string }[] = [];
  const createCommitComment = vi.fn(async ({ body }: { body: string }) => {
    comments.push({ user: { login: "github-actions[bot]" }, body });
  });
  const github = {
    paginate: vi.fn(async () => comments),
    rest: { repos: { listCommentsForCommit: vi.fn(), createCommitComment } },
  };
  const run = (targets = [target], retry = false) =>
    register(
      github,
      { repo: { owner: "test", repo: "repository" } },
      { info: vi.fn() },
      {
        env: {
          RELEASE_TARGETS: JSON.stringify(targets),
          RETRY_REGISTRATION: String(retry),
        },
      },
    );
  return { run, github, createCommitComment, comments };
}

describe("Julia registration workflow", () => {
  it("registers the saved commit and reviewed notes once across workflow reruns", async () => {
    const { run, github, createCommitComment } = setup();
    await run();
    await run();
    expect(createCommitComment).toHaveBeenCalledTimes(1);
    expect(createCommitComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "test",
        repo: "repository",
        commit_sha: target.sha,
        body: expect.stringContaining(
          "@JuliaRegistrator register\n\nRelease notes:\n\nReviewed release notes.",
        ),
      }),
    );
    expect(github.paginate).toHaveBeenCalledWith(
      github.rest.repos.listCommentsForCommit,
      expect.objectContaining({ commit_sha: target.sha }),
    );
  });

  it("allows an explicit retry at the same saved commit", async () => {
    const { run, createCommitComment } = setup();
    await run();
    await run([target], true);
    expect(createCommitComment).toHaveBeenCalledTimes(2);
    expect(createCommitComment.mock.calls[0]).toEqual(
      createCommitComment.mock.calls[1],
    );
  });

  it("registers subdirectory packages separately", async () => {
    const { run, createCommitComment } = setup();
    await run([
      target,
      { ...target, path: "packages/Solver", tag: "Solver-v1.0.1" },
    ]);
    expect(createCommitComment).toHaveBeenCalledTimes(2);
    expect(createCommitComment).toHaveBeenLastCalledWith(
      expect.objectContaining({
        commit_sha: target.sha,
        body: expect.stringContaining(
          "@JuliaRegistrator register subdir=packages/Solver\n",
        ),
      }),
    );
  });

  it("does not trust another user's duplicate marker", async () => {
    const { run, comments, createCommitComment } = setup();
    await run();
    const comment = comments[0];
    if (!comment) throw new Error("Expected a registration comment.");
    comment.user.login = "someone-else";
    await run();
    expect(createCommitComment).toHaveBeenCalledTimes(2);
  });

  it("fails on API errors so the workflow can be retried", async () => {
    const { run, createCommitComment } = setup();
    createCommitComment.mockRejectedValueOnce(
      new Error("GitHub is unavailable"),
    );
    await expect(run()).rejects.toThrow("GitHub is unavailable");
  });

  it("rejects incomplete handoffs before submitting registration", async () => {
    const { run, createCommitComment } = setup();
    await expect(run([{ ...target, sha: "main" }])).rejects.toThrow(
      "Invalid external release target",
    );
    await expect(run([])).rejects.toThrow(
      "did not supply any external release targets",
    );
    expect(createCommitComment).not.toHaveBeenCalled();
  });
});
