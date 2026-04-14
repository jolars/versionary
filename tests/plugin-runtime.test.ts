import { describe, expect, it } from "vitest";
import { loadRuntimePlugins } from "../src/plugins/runtime.js";
import { findPluginsByCapability } from "../src/plugins/capabilities.js";

describe("plugin runtime", () => {
  it("loads at least one SCM review plugin", () => {
    const plugins = loadRuntimePlugins();
    const scmPlugins = findPluginsByCapability(plugins, "scm.reviewRequest");
    expect(scmPlugins.length).toBeGreaterThan(0);
  });
});
