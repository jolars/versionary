import { loadConfig } from "../../config/load-config.js";
import type { VersionaryPluginRuntime } from "../../types/plugins.js";
import { createGitHubPlugin } from "./github/plugin.js";

const BUILTIN_PLUGIN_FACTORIES: Record<string, () => VersionaryPluginRuntime> =
  {
    github: createGitHubPlugin,
  };

export function loadRuntimePlugins(
  cwd = process.cwd(),
): VersionaryPluginRuntime[] {
  const loaded = loadConfig(cwd);
  const configured = loaded.config.plugins ?? [];

  const plugins: VersionaryPluginRuntime[] = [createGitHubPlugin()];
  const seen = new Set(plugins.map((plugin) => plugin.name));

  for (const name of configured) {
    const factory = BUILTIN_PLUGIN_FACTORIES[name];
    if (!factory || seen.has(name)) {
      continue;
    }
    const plugin = factory();
    plugins.push(plugin);
    seen.add(plugin.name);
  }

  return plugins;
}
