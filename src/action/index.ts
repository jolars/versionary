import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

interface RunJsonResult {
  action?: string;
  message?: string;
  releaseCreated?: boolean;
  tagNames?: unknown;
  reviewUrl?: string;
  branch?: string;
  title?: string;
}

function getInput(name: string): string {
  const canonical = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const underscoreAlias = canonical.replace(/-/g, "_");
  return (
    process.env[canonical] ??
    process.env[underscoreAlias] ??
    process.env[`INPUT_${name.toUpperCase()}`] ??
    ""
  ).trim();
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function hasGitConfig(cwd: string, key: string): boolean {
  try {
    runGit(cwd, ["config", key]);
    return true;
  } catch {
    return false;
  }
}

function hasOriginRemote(cwd: string): boolean {
  try {
    runGit(cwd, ["remote", "get-url", "origin"]);
    return true;
  } catch {
    return false;
  }
}

function setOutput(name: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is not set.");
  }
  const delimiter = `versionary-${randomUUID()}`;
  appendFileSync(
    outputPath,
    `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
    "utf8",
  );
}

function main(): void {
  const token = getInput("token") || getInput("github-token");
  if (!token) {
    throw new Error(
      "Input required and not supplied: token (or deprecated github-token).",
    );
  }

  const versionaryVersion = getInput("versionary-version") || "0.7.0";
  const cwd = getInput("working-directory") || ".";
  process.chdir(cwd);

  if (!hasGitConfig(cwd, "user.name")) {
    runGit(cwd, ["config", "user.name", "github-actions[bot]"]);
  }
  if (!hasGitConfig(cwd, "user.email")) {
    runGit(cwd, [
      "config",
      "user.email",
      "41898282+github-actions[bot]@users.noreply.github.com",
    ]);
  }

  if (hasOriginRemote(cwd)) {
    const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository) {
      throw new Error("GITHUB_REPOSITORY is not set.");
    }
    const base = serverUrl.replace(/^https?:\/\//u, "");
    const encodedToken = encodeURIComponent(token);
    runGit(cwd, [
      "remote",
      "set-url",
      "origin",
      `https://x-access-token:${encodedToken}@${base}/${repository}.git`,
    ]);
  }

  const raw = execFileSync(
    "npx",
    ["--yes", `versionary@${versionaryVersion}`, "run", "--json"],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GITHUB_TOKEN: token,
      },
    },
  ).trim();

  if (!raw) {
    throw new Error("Versionary returned empty JSON output.");
  }

  process.stdout.write(`${raw}\n`);

  let payload: RunJsonResult;
  try {
    payload = JSON.parse(raw) as RunJsonResult;
  } catch (error) {
    throw new Error(
      `Failed parsing Versionary JSON output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const tagNames = Array.isArray(payload.tagNames)
    ? payload.tagNames.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const firstTag = tagNames[0] ?? "";
  const releaseCreated =
    payload.releaseCreated === true || tagNames.length > 0 ? "true" : "false";

  setOutput("action", payload.action ?? "");
  setOutput("message", payload.message ?? "");
  setOutput("release_created", releaseCreated);
  setOutput("tag_name", firstTag);
  setOutput("tag_names", JSON.stringify(tagNames));
  setOutput("review_url", payload.reviewUrl ?? "");
  setOutput("branch", payload.branch ?? "");
  setOutput("title", payload.title ?? "");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
