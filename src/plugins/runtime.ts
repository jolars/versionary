import { createGitHubPlugin } from "../scm/github-plugin.js";
import type { VersionaryPluginRuntime } from "../types/plugins.js";

export function loadRuntimePlugins(): VersionaryPluginRuntime[] {
  return [createGitHubPlugin()];
}
