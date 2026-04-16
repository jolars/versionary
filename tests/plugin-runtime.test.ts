import { describe, expect, it } from "vitest";
import { findPluginsByCapability } from "../src/plugins/capabilities.js";
import { loadRuntimePlugins } from "../src/plugins/runtime.js";

describe("plugin runtime", () => {
  it("loads at least one SCM review plugin", () => {
    const plugins = loadRuntimePlugins();
    const scmPlugins = findPluginsByCapability(plugins, "scm.reviewRequest");
    expect(scmPlugins.length).toBeGreaterThan(0);
  });

  it("only loads built-in plugins", () => {
    const plugins = loadRuntimePlugins();
    expect(plugins.map((plugin) => plugin.name)).toEqual(["github"]);
  });
});
