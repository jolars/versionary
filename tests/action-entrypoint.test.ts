import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, "utf8");
  fs.chmodSync(filePath, 0o755);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("GitHub Action entrypoint", () => {
  function runWithEvent(event: string | null | undefined, token = "") {
    const cwd = makeTempDir("versionary-action-event-");
    const outputPath = path.join(cwd, "github-output.txt");
    const eventPath = path.join(cwd, "event.json");
    const binDir = path.join(cwd, "bin");
    const invocationsPath = path.join(cwd, "invocations.txt");
    fs.mkdirSync(binDir);
    if (typeof event === "string") {
      fs.writeFileSync(eventPath, event, "utf8");
    }
    for (const command of ["git", "npx"]) {
      writeExecutable(
        path.join(binDir, command),
        `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_INVOCATIONS_PATH, ${JSON.stringify(command)} + "\\n");
if (${JSON.stringify(command)} === "git") {
  process.exit(process.argv[2] === "config" ? 0 : 1);
}
process.stdout.write(JSON.stringify({ action: "noop", releaseCreated: false }));
`,
      );
    }
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const result = spawnSync(
      process.execPath,
      [path.resolve(testsDir, "..", "action", "index.js")],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          GITHUB_EVENT_NAME: "push",
          GITHUB_EVENT_PATH: event === undefined ? "" : eventPath,
          GITHUB_OUTPUT: outputPath,
          GITHUB_REPOSITORY: "contributor/project",
          INPUT_TOKEN: token,
          TEST_INVOCATIONS_PATH: invocationsPath,
        },
      },
    );
    const outputs = fs.existsSync(outputPath)
      ? Object.fromEntries(
          [
            ...fs
              .readFileSync(outputPath, "utf8")
              .matchAll(/([^\n]+)<<([^\n]+)\n([^\n]*)\n\2\n/gu),
          ].map(([, name, , value]) => [name, value]),
        )
      : {};
    const invocations = fs.existsSync(invocationsPath)
      ? fs.readFileSync(invocationsPath, "utf8").trim().split("\n")
      : [];
    return { ...result, outputs, invocations };
  }

  it.each(["", " \t\n"])(
    "skips a fork with an empty token (%j) before invoking git or Versionary",
    (token) => {
      const result = runWithEvent(
        JSON.stringify({ repository: { fork: true } }),
        token,
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        action: "fork-skipped",
        message:
          "Skipping release automation in a fork without a release token.",
        releaseCreated: false,
        tagNames: [],
      });
      expect(result.outputs).toEqual({
        action: "fork-skipped",
        message:
          "Skipping release automation in a fork without a release token.",
        release_created: "false",
        tag_name: "",
        tag_names: "[]",
        release_targets: "[]",
        review_url: "",
        review_requests: "[]",
        branch: "",
        title: "",
      });
      expect(result.invocations).toEqual([]);
    },
  );

  it.each([
    ["an upstream repository", '{"repository":{"fork":false}}'],
    [
      "an upstream pull request from a fork",
      '{"repository":{"fork":false},"pull_request":{"head":{"repo":{"fork":true}}}}',
    ],
    ["missing repository metadata", "{}"],
    ["a non-boolean fork flag", '{"repository":{"fork":"true"}}'],
    ["a null event", "null"],
    ["malformed JSON", "{"],
    ["an unset event path", undefined],
    ["an unreadable event file", null],
  ])("requires a token for %s", (_description, event) => {
    const result = runWithEvent(event);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Input required and not supplied: token.");
    expect(result.outputs).toEqual({});
    expect(result.invocations).toEqual([]);
  });

  it("runs Versionary for a fork with a supplied token", () => {
    const result = runWithEvent(
      JSON.stringify({ repository: { fork: true } }),
      "test-token",
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ action: "noop" });
    expect(result.outputs.action).toBe("noop");
    expect(result.invocations).toContain("npx");
  });

  it("skips a stale push before invoking Versionary", () => {
    const cwd = makeTempDir("versionary-action-");
    const binDir = path.join(cwd, "bin");
    const outputPath = path.join(cwd, "github-output.txt");
    fs.mkdirSync(binDir);

    writeExecutable(
      path.join(binDir, "git"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "config") {
  process.stdout.write("configured\\n");
  process.exit(0);
}
if (args[0] === "remote" && args[1] === "get-url") {
  process.stdout.write("https://github.com/jolars/libslope.git\\n");
  process.exit(0);
}
if (args[0] === "remote" && args[1] === "set-url") {
  process.exit(0);
}
if (args[0] === "ls-remote") {
  process.stdout.write(process.env.TEST_REMOTE_SHA + "\\t" + args[2] + "\\n");
  process.exit(0);
}
if (args[0] === "show" && args[1] === "-s") {
  process.stdout.write("feat: add a newer feature\\n");
  process.exit(0);
}
process.stderr.write("Unexpected git invocation: " + args.join(" ") + "\\n");
process.exit(2);
`,
    );
    writeExecutable(
      path.join(binDir, "npx"),
      `#!/usr/bin/env node
process.stderr.write("Versionary must not run for a stale push.\\n");
process.exit(91);
`,
    );

    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const actionEntrypoint = path.join(repoRoot, "action", "index.js");
    const eventSha = "1111111111111111111111111111111111111111";
    const remoteSha = "2222222222222222222222222222222222222222";
    const stdout = execFileSync(process.execPath, [actionEntrypoint], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        GITHUB_EVENT_NAME: "push",
        GITHUB_OUTPUT: outputPath,
        GITHUB_REF: "refs/heads/main",
        GITHUB_REPOSITORY: "jolars/libslope",
        GITHUB_SHA: eventSha,
        INPUT_TOKEN: "test-token",
        TEST_REMOTE_SHA: remoteSha,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    expect(JSON.parse(stdout)).toMatchObject({
      action: "stale-run-skipped",
      releaseCreated: false,
      tagNames: [],
    });
    expect(stdout).toContain(
      "Skipping stale push run for 1111111; refs/heads/main now points to 2222222.",
    );

    const actionOutput = fs.readFileSync(outputPath, "utf8");
    expect(actionOutput).toContain("action<<");
    expect(actionOutput).toContain("stale-run-skipped");
    expect(actionOutput).toContain("release_created<<");
    expect(actionOutput).toContain("false");
    expect(actionOutput).toContain("release_targets<<");
    expect(actionOutput).toContain("[]");
  });

  it("publishes a stale release-marker push only while it remains on the branch", () => {
    const cwd = makeTempDir("versionary-action-release-");
    const binDir = path.join(cwd, "bin");
    const outputPath = path.join(cwd, "github-output.txt");
    fs.mkdirSync(binDir);

    writeExecutable(
      path.join(binDir, "git"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "config") {
  process.stdout.write("configured\\n");
  process.exit(0);
}
if (args[0] === "remote" && args[1] === "get-url") {
  process.stdout.write("https://github.com/jolars/libslope.git\\n");
  process.exit(0);
}
if (args[0] === "remote" && args[1] === "set-url") {
  process.exit(0);
}
if (args[0] === "ls-remote") {
  process.stdout.write(process.env.TEST_REMOTE_SHA + "\\t" + args[2] + "\\n");
  process.exit(0);
}
if (args[0] === "show" && args[1] === "-s") {
  process.stdout.write("chore(release): v1.2.3\\n\\nVersionary-Release: true\\n");
  process.exit(0);
}
if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
  process.exit(process.env.TEST_IS_ANCESTOR === "true" ? 0 : 1);
}
process.stderr.write("Unexpected git invocation: " + args.join(" ") + "\\n");
process.exit(2);
`,
    );
    writeExecutable(
      path.join(binDir, "npx"),
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  action: "release-published",
  message: "Published v1.2.3.",
  releaseCreated: true,
  tagNames: ["v1.2.3"]
}) + "\\n");
`,
    );

    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const actionEntrypoint = path.join(repoRoot, "action", "index.js");
    const eventSha = "1111111111111111111111111111111111111111";
    const remoteSha = "2222222222222222222222222222222222222222";
    const stdout = execFileSync(process.execPath, [actionEntrypoint], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        GITHUB_EVENT_NAME: "push",
        GITHUB_OUTPUT: outputPath,
        GITHUB_REF: "refs/heads/main",
        GITHUB_REPOSITORY: "jolars/libslope",
        GITHUB_SHA: eventSha,
        INPUT_TOKEN: "test-token",
        TEST_IS_ANCESTOR: "true",
        TEST_REMOTE_SHA: remoteSha,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    expect(JSON.parse(stdout)).toMatchObject({
      action: "release-published",
      releaseCreated: true,
      tagNames: ["v1.2.3"],
    });

    const actionOutput = fs.readFileSync(outputPath, "utf8");
    expect(actionOutput).toContain("release_created<<");
    expect(actionOutput).toContain("true");
    expect(actionOutput).toContain("tag_name<<");
    expect(actionOutput).toContain("v1.2.3");

    const removedOutputPath = path.join(cwd, "removed-output.txt");
    const removedStdout = execFileSync(process.execPath, [actionEntrypoint], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        GITHUB_EVENT_NAME: "push",
        GITHUB_OUTPUT: removedOutputPath,
        GITHUB_REF: "refs/heads/main",
        GITHUB_REPOSITORY: "jolars/libslope",
        GITHUB_SHA: eventSha,
        INPUT_TOKEN: "test-token",
        TEST_IS_ANCESTOR: "false",
        TEST_REMOTE_SHA: remoteSha,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    expect(JSON.parse(removedStdout)).toMatchObject({
      action: "stale-run-skipped",
      releaseCreated: false,
      tagNames: [],
    });
  });

  it("exports all package review requests while retaining primary outputs", () => {
    const cwd = makeTempDir("versionary-action-multiple-prs-");
    const binDir = path.join(cwd, "bin");
    const outputPath = path.join(cwd, "github-output.txt");
    fs.mkdirSync(binDir);

    writeExecutable(
      path.join(binDir, "git"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "config") {
  process.stdout.write("configured\\n");
  process.exit(0);
}
if (args[0] === "remote" && args[1] === "get-url") {
  process.exit(1);
}
process.stderr.write("Unexpected git invocation: " + args.join(" ") + "\\n");
process.exit(2);
`,
    );
    writeExecutable(
      path.join(binDir, "npx"),
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  action: "pr-prepared",
  message: "Prepared 2 package release PRs.",
  releaseCreated: false,
  tagNames: [],
  reviewUrl: "https://example.test/pr/1",
  branch: "versionary/release/a-111",
  title: "chore(release): a-v1.1.0",
  reviewRequests: [
    { branch: "versionary/release/a-111", reviewUrl: "https://example.test/pr/1" },
    { branch: "versionary/release/b-222", reviewUrl: "https://example.test/pr/2" }
  ]
}) + "\\n");
`,
    );

    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const actionEntrypoint = path.join(repoRoot, "action", "index.js");
    execFileSync(process.execPath, [actionEntrypoint], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        GITHUB_OUTPUT: outputPath,
        INPUT_TOKEN: "test-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const actionOutput = fs.readFileSync(outputPath, "utf8");
    expect(actionOutput).toContain("review_requests<<");
    expect(actionOutput).toContain("https://example.test/pr/2");
    expect(actionOutput).toContain("branch<<");
    expect(actionOutput).toContain("versionary/release/a-111");
  });

  it("exports the dependency-ordered release target handoff", () => {
    const cwd = makeTempDir("versionary-action-release-targets-");
    const binDir = path.join(cwd, "bin");
    const outputPath = path.join(cwd, "github-output.txt");
    fs.mkdirSync(binDir);

    writeExecutable(
      path.join(binDir, "git"),
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "config") {
  process.stdout.write("configured\\n");
  process.exit(0);
}
if (args[0] === "remote" && args[1] === "get-url") {
  process.exit(1);
}
process.stderr.write("Unexpected git invocation: " + args.join(" ") + "\\n");
process.exit(2);
`,
    );
    writeExecutable(
      path.join(binDir, "npx"),
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  action: "release-published",
  message: "Published dependent releases.",
  releaseCreated: true,
  tagNames: ["v3.7.0", "panache-formatter-v0.22.0", "panache-parser-v0.28.0"],
  releaseTargets: [
    {
      path: "crates/panache-parser",
      version: "0.28.0",
      tag: "panache-parser-v0.28.0",
      dependencies: []
    },
    {
      path: "crates/panache-formatter",
      version: "0.22.0",
      tag: "panache-formatter-v0.22.0",
      dependencies: ["crates/panache-parser"]
    },
    {
      path: ".",
      version: "3.7.0",
      tag: "v3.7.0",
      dependencies: ["crates/panache-formatter", "crates/panache-parser"]
    }
  ]
}) + "\\n");
`,
    );

    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testsDir, "..");
    const actionEntrypoint = path.join(repoRoot, "action", "index.js");
    execFileSync(process.execPath, [actionEntrypoint], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        GITHUB_OUTPUT: outputPath,
        INPUT_TOKEN: "test-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const actionOutput = fs.readFileSync(outputPath, "utf8");
    expect(actionOutput).toContain("release_targets<<");
    expect(actionOutput).toContain('"path":"crates/panache-parser"');
    expect(actionOutput).toContain('"dependencies":["crates/panache-parser"]');
  });
});
