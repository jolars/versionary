import { describe, expect, it } from "vitest";
import {
  findPluginsByCapability,
  pluginHasCapability,
} from "../src/plugins/capabilities.js";
import type { VersionaryPluginRuntime } from "../src/types/plugins.js";

describe("plugin capability helpers", () => {
  const githubPlugin: VersionaryPluginRuntime = {
    name: "github",
    capabilities: ["scm.reviewRequest", "scm.releaseMetadata"],
  };

  const directPlugin: VersionaryPluginRuntime = {
    name: "direct",
    capabilities: [],
  };

  it("checks plugin capability", () => {
    expect(pluginHasCapability(githubPlugin, "scm.reviewRequest")).toBe(true);
    expect(pluginHasCapability(directPlugin, "scm.reviewRequest")).toBe(false);
  });

  it("filters plugins by capability", () => {
    const plugins = findPluginsByCapability(
      [githubPlugin, directPlugin],
      "scm.releaseMetadata",
    );
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("github");
  });
});
