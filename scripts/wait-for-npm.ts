import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TIMEOUT_MS = 15 * 60_000;
const RETRY_DELAY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

export async function waitForNpmPackage(
  name: string,
  version: string,
): Promise<void> {
  const spec = `${name}@${version}`;
  const deadline = Date.now() + TIMEOUT_MS;
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "versionary-npm-"));
  let lastError = "";

  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      try {
        // Metadata can appear before the tarball. An isolated cache ensures
        // that a successful pack proves npm can actually serve this version.
        execFileSync(
          "npm",
          [
            "pack",
            spec,
            "--ignore-scripts",
            "--registry=https://registry.npmjs.org",
            "--prefer-online",
            "--fetch-retries=0",
            "--cache",
            path.join(tempDir, "cache"),
          ],
          {
            cwd: tempDir,
            encoding: "utf8",
            stdio: "pipe",
            timeout: Math.min(REQUEST_TIMEOUT_MS, remaining),
            killSignal: "SIGKILL",
          },
        );
        console.log(`${spec} is downloadable from npm.`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      const delay = Math.min(RETRY_DELAY_MS, deadline - Date.now());
      if (delay <= 0) break;
      console.log(
        `Waiting for ${spec} on npm; retrying in ${delay / 1000}s.\n${lastError}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw new Error(
      `Timed out after ${TIMEOUT_MS / 1000}s waiting for ${spec} to become downloadable from npm. Last error: ${lastError}`,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const { name, version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  waitForNpmPackage(name, version).catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
