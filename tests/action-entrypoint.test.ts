import { execFileSync } from "node:child_process";
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
});
