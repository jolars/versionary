import type {
  VersionaryPluginCapability,
  VersionaryPluginRuntime,
} from "../types/plugins.js";

export function pluginHasCapability(
  plugin: VersionaryPluginRuntime,
  capability: VersionaryPluginCapability,
): boolean {
  return plugin.capabilities.includes(capability);
}

export function findPluginsByCapability(
  plugins: VersionaryPluginRuntime[],
  capability: VersionaryPluginCapability,
): VersionaryPluginRuntime[] {
  return plugins.filter((plugin) => pluginHasCapability(plugin, capability));
}
