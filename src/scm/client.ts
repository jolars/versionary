import { createGitHubPlugin } from "./github-plugin.js";
import type { ScmClient } from "./types.js";

export function getScmClient(): ScmClient {
  return createGitHubPlugin();
}
