import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateCi } from "../src/ci.js";
import { resolveSeparateReleaseBranch } from "../src/release/cohorts.js";
import type { VersionaryConfig } from "../src/types/config.js";

const directories: string[] = [];
const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

function setup(
  config: Partial<VersionaryConfig> = {},
  branch = "versionary/release",
) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-ci-"));
  directories.push(cwd);
  fs.writeFileSync(
    path.join(cwd, "versionary.jsonc"),
    JSON.stringify({ version: 1, "release-pr-checks": "skip", ...config }),
  );
  const event = {
    pull_request: {
      head: { ref: branch, repo: { full_name: "test/repository" } },
      base: { repo: { full_name: "test/repository" } },
    },
  };
  const eventPath = path.join(cwd, "event.json");
  const writeEvent = (value: unknown) => {
    fs.writeFileSync(eventPath, JSON.stringify(value));
  };
  writeEvent(event);
  const env: NodeJS.ProcessEnv = {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "test/repository",
  };
  return { cwd, event, eventPath, writeEvent, env };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("CI check selection", () => {
  it.each([undefined, "run", "skip"] as const)(
    "uses release-pr-checks %s on a release PR",
    (policy) => {
      const { cwd, env } = setup({ "release-pr-checks": policy });
      expect(evaluateCi(cwd, env)).toMatchObject({
        action: "ci-evaluated",
        runChecks: policy !== "skip",
        isReleasePr: true,
      });
    },
  );

  it.each(["automation/release", "versionary/release-1.x"])(
    "recognizes the configured release branch %s",
    (branch) => {
      const { cwd, env } = setup({ "release-branch": branch }, branch);
      expect(evaluateCi(cwd, env).runChecks).toBe(false);
    },
  );

  it.each(["versionary/release", "automation/release-1.x"])(
    "recognizes generated package and cohort branches under %s",
    (prefix) => {
      const branch = resolveSeparateReleaseBranch(
        prefix,
        "@scope/api",
        "packages/api",
      );
      const { cwd, env } = setup(
        {
          "release-branch": prefix,
          "separate-release-prs": true,
          packages: { "packages/api": {}, "packages/cli": {} },
        },
        branch,
      );
      expect(evaluateCi(cwd, env)).toMatchObject({
        runChecks: false,
        isReleasePr: true,
      });
    },
  );

  it.each([
    "fix/parser",
    "versionary/releases",
    "versionary/release-manual",
    "versionary/release-api-123",
    "versionary/release-api-0123456789ab-extra",
  ])("runs checks on an ordinary branch %s", (branch) => {
    const { cwd, env } = setup(
      {
        "separate-release-prs": true,
        packages: { "packages/api": {} },
      },
      branch,
    );
    expect(evaluateCi(cwd, env)).toMatchObject({
      runChecks: true,
      isReleasePr: false,
    });
  });

  it("runs checks on package-like branches when separate PRs are disabled", () => {
    const branch = resolveSeparateReleaseBranch(
      "versionary/release",
      "api",
      "packages/api",
    );
    const { cwd, env } = setup({}, branch);
    expect(evaluateCi(cwd, env).runChecks).toBe(true);
  });

  it.each(["push", "workflow_dispatch", "merge_group", undefined])(
    "always runs checks for event %s even with matching PR metadata",
    (eventName) => {
      const { cwd, env } = setup();
      env.GITHUB_EVENT_NAME = eventName;
      expect(evaluateCi(cwd, env)).toMatchObject({
        runChecks: true,
        isReleasePr: false,
      });
    },
  );

  it("supports pull_request_target without requiring a release token", () => {
    const { cwd, env } = setup();
    env.GITHUB_EVENT_NAME = "pull_request_target";
    expect(evaluateCi(cwd, env).runChecks).toBe(false);
  });

  it("keeps checks enabled in direct release mode", () => {
    const { cwd, env } = setup({ "review-mode": "direct" });
    expect(evaluateCi(cwd, env).runChecks).toBe(true);
  });

  it.each(["head", "base"] as const)(
    "requires the %s repository to match",
    (side) => {
      const { cwd, env, event, writeEvent } = setup();
      event.pull_request[side].repo.full_name = "contributor/repository";
      writeEvent(event);
      expect(evaluateCi(cwd, env)).toMatchObject({
        runChecks: true,
        isReleasePr: false,
      });
    },
  );

  it("matches repository names without case sensitivity", () => {
    const { cwd, env } = setup();
    env.GITHUB_REPOSITORY = "Test/Repository";
    expect(evaluateCi(cwd, env).runChecks).toBe(false);
  });

  it.each([
    {},
    null,
    { pull_request: { head: { ref: "versionary/release", repo: null } } },
  ])("runs checks when PR metadata is incomplete (%j)", (event) => {
    const { cwd, env, writeEvent } = setup();
    writeEvent(event);
    expect(evaluateCi(cwd, env).runChecks).toBe(true);
  });

  it.each(["missing", "unreadable", "malformed", "repository"])(
    "runs checks with %s event context",
    (kind) => {
      const { cwd, env, eventPath } = setup();
      if (kind === "missing") delete env.GITHUB_EVENT_PATH;
      if (kind === "unreadable") fs.unlinkSync(eventPath);
      if (kind === "malformed") fs.writeFileSync(eventPath, "{");
      if (kind === "repository") delete env.GITHUB_REPOSITORY;
      expect(evaluateCi(cwd, env).runChecks).toBe(true);
    },
  );

  it.each([false, "[skip ci]", null])(
    "rejects invalid check policy %j",
    (policy) => {
      const { cwd, env } = setup();
      fs.writeFileSync(
        path.join(cwd, "versionary.jsonc"),
        JSON.stringify({
          version: 1,
          "release-pr-checks": policy,
        }),
      );
      expect(() => evaluateCi(cwd, env)).toThrow(/release-pr-checks/u);
    },
  );

  it("exposes the CLI decision without Git, version files, tokens, or writes", () => {
    const { cwd, env } = setup();
    const files = fs.readdirSync(cwd);
    const before = files.map((file) =>
      fs.readFileSync(path.join(cwd, file), "utf8"),
    );
    const result = spawnSync(tsx, [cli, "ci", "--json"], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        GITHUB_TOKEN: "",
        GH_TOKEN: "",
        VERSIONARY_PR_TOKEN: "",
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      runChecks: false,
      isReleasePr: true,
    });
    expect(fs.readdirSync(cwd)).toEqual(files);
    expect(
      files.map((file) => fs.readFileSync(path.join(cwd, file), "utf8")),
    ).toEqual(before);
  });

  it("runs the CI Action against a nested project without invoking Git", () => {
    const { cwd, env } = setup();
    const project = path.join(cwd, "project");
    const bin = path.join(cwd, "bin");
    const output = path.join(cwd, "github-output");
    const gitCalls = path.join(cwd, "git-calls");
    fs.mkdirSync(project);
    fs.mkdirSync(bin);
    fs.renameSync(
      path.join(cwd, "versionary.jsonc"),
      path.join(project, "versionary.jsonc"),
    );
    fs.writeFileSync(
      path.join(bin, "npx"),
      `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const result = spawnSync(${JSON.stringify(tsx)}, [${JSON.stringify(cli)}, ...process.argv.slice(4)], { stdio: "inherit" });
process.exit(result.status ?? 1);
`,
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(bin, "git"),
      `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.TEST_GIT_CALLS, "called");
process.exit(99);
`,
      { mode: 0o755 },
    );
    const action = fileURLToPath(
      new URL("../action/index.js", import.meta.url),
    );
    const result = spawnSync(process.execPath, [action], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        INPUT_COMMAND: "ci",
        INPUT_TOKEN: "",
        INPUT_WORKING_DIRECTORY: "project",
        GITHUB_OUTPUT: output,
        TEST_GIT_CALLS: gitCalls,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      runChecks: false,
      isReleasePr: true,
    });
    expect(fs.readFileSync(output, "utf8")).toMatch(
      /run_checks<<([^\n]+)\nfalse\n\1\n/u,
    );
    expect(fs.existsSync(gitCalls)).toBe(false);
    expect(fs.readdirSync(project)).toEqual(["versionary.jsonc"]);
  });
});
