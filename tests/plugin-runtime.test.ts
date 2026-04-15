import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findPluginsByCapability } from "../src/plugins/capabilities.js";
import { loadRuntimePlugins } from "../src/plugins/runtime.js";

describe("plugin runtime", () => {
  it("loads at least one SCM review plugin", () => {
    const plugins = loadRuntimePlugins();
    const scmPlugins = findPluginsByCapability(plugins, "scm.reviewRequest");
    expect(scmPlugins.length).toBeGreaterThan(0);
  });

  it("ignores unknown configured plugin names", () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "versionary-plugin-runtime-"),
    );
    try {
      fs.writeFileSync(
        path.join(dir, "versionary.json"),
        JSON.stringify({
          version: 1,
          plugins: ["github", "unknown-plugin"],
        }),
        "utf8",
      );
      const plugins = loadRuntimePlugins(dir);
      const names = plugins.map((plugin) => plugin.name);
      expect(names).toContain("github");
      expect(names).not.toContain("unknown-plugin");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
