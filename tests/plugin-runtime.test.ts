import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRuntimePlugins } from "../src/plugins/runtime.js";
import { findPluginsByCapability } from "../src/plugins/capabilities.js";

describe("plugin runtime", () => {
  it("loads at least one SCM review plugin", () => {
    const plugins = loadRuntimePlugins();
    const scmPlugins = findPluginsByCapability(plugins, "scm.reviewRequest");
    expect(scmPlugins.length).toBeGreaterThan(0);
  });

  it("loads npm plugin when configured", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-plugin-runtime-"));
    fs.writeFileSync(
      path.join(cwd, "versionary.jsonc"),
      JSON.stringify({
        version: 1,
        mode: "simple",
        pluginConfig: {
          plugins: [{ name: "npm" }],
        },
      }),
      "utf8",
    );

    const plugins = loadRuntimePlugins(cwd);
    const npmPlugins = findPluginsByCapability(plugins, "publish.package");
    expect(npmPlugins.length).toBeGreaterThan(0);
    expect(npmPlugins[0]?.name).toBe("npm");
  });
});
