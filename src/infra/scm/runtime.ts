import type { VersionaryPluginRuntime } from "../../types/plugins.js";
import { createGitHubPlugin } from "./github/plugin.js";

export function loadRuntimePlugins(): VersionaryPluginRuntime[] {
  return [createGitHubPlugin()];
}
