import { execFileSync } from "node:child_process";
import type { VersionaryScmReleaseMetadataResult } from "../../types/plugins.js";

export type TagStepResult = "created" | "exists";

export interface ReleaseTargetInput {
  tag: string;
  version: string;
  notes: string;
}

export interface ReleaseExecutionContext {
  createReleaseMetadata: (
    input: ReleaseTargetInput,
  ) => Promise<VersionaryScmReleaseMetadataResult>;
  logger?: {
    info: (message: string) => void;
  };
}

export interface ReleaseTargetOutcome {
  tag: string;
  tagStatus: TagStepResult;
  metadataStatus: "created" | "exists";
  url: string;
}

function hasRemoteTag(cwd: string, tag: string): boolean {
  try {
    const output = execFileSync(
      "git",
      ["ls-remote", "--tags", "origin", `refs/tags/${tag}`],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

function readRemoteTagSha(cwd: string, tag: string): string | null {
  try {
    const output = execFileSync(
      "git",
      ["ls-remote", "--tags", "origin", `refs/tags/${tag}`],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (!output) {
      return null;
    }
    const [sha] = output.split(/\s+/u);
    return sha ?? null;
  } catch {
    return null;
  }
}

function createTagWithRecovery(cwd: string, tag: string): TagStepResult {
  const localTag = execFileSync("git", ["tag", "--list", tag], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

  if (localTag.length > 0) {
    const localSha = execFileSync("git", ["rev-parse", `refs/tags/${tag}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const remoteSha = readRemoteTagSha(cwd, tag);
    if (remoteSha && remoteSha !== localSha) {
      throw new Error(
        `Tag drift detected for "${tag}": local tag (${localSha.slice(0, 7)}) differs from remote (${remoteSha.slice(0, 7)}). Resolve the tag mismatch before retrying release.`,
      );
    }
    return "exists";
  }

  try {
    execFileSync("git", ["tag", tag], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(
      `Failed creating local tag "${tag}". Ensure repository is writable and retry.`,
    );
  }

  try {
    execFileSync("git", ["push", "origin", tag], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return "created";
  } catch {
    if (hasRemoteTag(cwd, tag)) {
      const localSha = execFileSync("git", ["rev-parse", `refs/tags/${tag}`], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const remoteSha = readRemoteTagSha(cwd, tag);
      if (remoteSha && remoteSha !== localSha) {
        throw new Error(
          `Tag drift detected for "${tag}": local tag (${localSha.slice(0, 7)}) differs from remote (${remoteSha.slice(0, 7)}). Resolve the tag mismatch before retrying release.`,
        );
      }
      return "exists";
    }
    throw new Error(
      `Failed pushing tag "${tag}" to origin. Check push permissions and remote connectivity, then retry.`,
    );
  }
}

export async function executeIdempotentReleaseTarget(
  cwd: string,
  target: ReleaseTargetInput,
  context: ReleaseExecutionContext,
): Promise<ReleaseTargetOutcome> {
  const tagStatus = createTagWithRecovery(cwd, target.tag);

  const metadata = await context.createReleaseMetadata(target);
  const metadataStatus = metadata.status ?? "created";

  if (tagStatus === "exists" && metadataStatus === "created") {
    context.logger?.info(
      `Recovered drift for ${target.tag}: tag already existed and release metadata has now been created.`,
    );
  }

  if (!metadata.url) {
    throw new Error(
      `Release metadata for "${target.tag}" did not return a URL. Verify SCM API permissions and retry.`,
    );
  }

  return {
    tag: target.tag,
    tagStatus,
    metadataStatus,
    url: metadata.url,
  };
}
