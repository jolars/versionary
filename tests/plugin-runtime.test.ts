import { describe, expect, it } from "vitest";
import { findPluginsByCapability } from "../src/scm/capabilities.js";
import { createGitHubPlugin } from "../src/scm/github-plugin.js";

describe("plugin runtime", () => {
  it("exposes SCM review capability on GitHub client", () => {
    const plugin = createGitHubPlugin();
    const scmPlugins = findPluginsByCapability([plugin], "scm.reviewRequest");
    expect(scmPlugins.length).toBe(1);
  });

  it("uses github plugin name", () => {
    const plugin = createGitHubPlugin();
    expect(plugin.name).toBe("github");
  });
});
