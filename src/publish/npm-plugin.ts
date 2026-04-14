import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type {
  VersionaryPluginContext,
  VersionaryPluginRuntime,
  VersionaryPublishPackageInput,
  VersionaryPublishPackageResult,
} from "../types/plugins.js";

interface PackageJsonData {
  name?: string;
  version?: string;
  private?: boolean;
}

function getPublishAccess(): "public" | "restricted" {
  const raw = process.env.VERSIONARY_NPM_ACCESS?.trim().toLowerCase();
  if (raw === "restricted") {
    return "restricted";
  }
  return "public";
}

function shouldSkipPublish(): boolean {
  const raw = process.env.VERSIONARY_SKIP_NPM_PUBLISH?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function readPackageJson(cwd: string): PackageJsonData {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error("npm publish plugin requires package.json in repository root.");
  }
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJsonData;
  return parsed;
}

function ensurePackageVersion(version: string, packageJson: PackageJsonData): void {
  if (!packageJson.version) {
    return;
  }
  if (packageJson.version !== version) {
    throw new Error(
      `npm publish plugin expected package.json version "${version}" but found "${packageJson.version}".`,
    );
  }
}

function hasNpmToken(): boolean {
  return Boolean(process.env.NPM_TOKEN?.trim());
}

function publishToNpm(cwd: string, access: "public" | "restricted"): void {
  execFileSync("npm", ["publish", "--access", access], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_loglevel: process.env.npm_config_loglevel ?? "warn",
    },
  });
}

async function publishPackage(
  input: VersionaryPublishPackageInput,
  context: VersionaryPluginContext,
): Promise<VersionaryPublishPackageResult> {
  const packageJson = readPackageJson(context.cwd);
  const packageName = packageJson.name ?? "unknown-package";

  if (packageJson.private) {
    context.logger?.info(`Skipping npm publish for private package "${packageName}".`);
    return { packageManager: "npm", packageName, version: input.version };
  }

  ensurePackageVersion(input.version, packageJson);

  if (shouldSkipPublish()) {
    context.logger?.info(`Skipping npm publish for "${packageName}" because VERSIONARY_SKIP_NPM_PUBLISH is set.`);
    return { packageManager: "npm", packageName, version: input.version };
  }

  if (!hasNpmToken()) {
    context.logger?.warn(`Skipping npm publish for "${packageName}" because NPM_TOKEN is not set.`);
    return { packageManager: "npm", packageName, version: input.version };
  }

  publishToNpm(context.cwd, getPublishAccess());
  context.logger?.info(`Published ${packageName}@${input.version} to npm.`);
  return { packageManager: "npm", packageName, version: input.version };
}

export function createNpmPlugin(): VersionaryPluginRuntime {
  return {
    name: "npm",
    capabilities: ["publish.package"],
    publishPackage,
  };
}
