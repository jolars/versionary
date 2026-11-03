import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configSchema } from "../src/config/schema.js";
import { createReleasePlan } from "../src/release/plan.js";
import { preparePendingSeparateReleasePrs } from "../src/release/pr.js";
import {
  readPendingReleaseCohorts,
  writePackageReleaseState,
} from "../src/release/state.js";
import { runCli } from "./helpers/cli.js";

const roots: string[] = [];
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function write(cwd: string, file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), content);
}
function setup(rootExternal = false, direct = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-mixed-"));
  roots.push(root);
  const cwd = path.join(root, "work");
  const origin = path.join(root, "origin");
  fs.mkdirSync(cwd);
  fs.mkdirSync(origin);
  git(origin, "init", "--bare");
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Test User");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "remote", "add", "origin", origin);
  write(
    cwd,
    "versionary.jsonc",
    JSON.stringify({
      version: 1,
      "review-mode": direct ? "direct" : "pr",
      "release-mode": rootExternal ? "external" : "versionary",
      "separate-release-prs": !direct,
      "bootstrap-sha": undefined,
      packages: {
        julia: { "release-type": "julia", "release-mode": "external" },
        node: {
          "release-type": "node",
          ...(rootExternal ? { "release-mode": "versionary" } : {}),
        },
      },
    }),
  );
  write(cwd, "julia/Project.toml", 'name = "JuliaDemo"\nversion = "1.0.0"\n');
  write(cwd, "node/package.json", '{"name":"node-demo","version":"1.0.0"}\n');
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "chore: init");
  git(cwd, "tag", "JuliaDemo-v1.0.0");
  git(cwd, "tag", "node-demo-v1.0.0");
  git(cwd, "push", "-u", "origin", "main", "--tags");
  return { cwd, origin };
}
function pending(cwd: string, paths = ["julia", "node"]): string {
  const baseline = git(cwd, "rev-parse", "HEAD");
  for (const pkg of paths) {
    const name = pkg === "julia" ? "JuliaDemo" : "node-demo";
    write(
      cwd,
      `${pkg}/CHANGELOG.md`,
      `## 1.0.1 - 2026-11-03\n\n- Reviewed ${pkg} fix.\n`,
    );
    write(
      cwd,
      pkg === "julia" ? "julia/Project.toml" : "node/package.json",
      pkg === "julia"
        ? 'name = "JuliaDemo"\nversion = "1.0.1"\n'
        : '{"name":"node-demo","version":"1.0.1"}\n',
    );
    writePackageReleaseState(
      cwd,
      baseline,
      [{ path: pkg, version: "1.0.1", tag: `${name}-v1.0.1` }],
      "versionary/release-mixed",
    );
  }
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "chore(release): reviewed versions");
  return git(cwd, "rev-parse", "HEAD");
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("mixed release modes", () => {
  it("validates package overrides and rejects unsupported modes", () => {
    expect(
      configSchema.safeParse({
        version: 1,
        packages: { julia: { "release-mode": "external" } },
      }).success,
    ).toBe(true);
    expect(
      configSchema.safeParse({
        version: 1,
        packages: { julia: { "release-mode": "tagbot" } },
      }).success,
    ).toBe(false);
  });

  it.each([false, true])(
    "publishes internal targets and hands off external ones (root external = %s)",
    (rootExternal) => {
      const { cwd, origin } = setup(rootExternal);
      const sha = pending(cwd);
      const result = JSON.parse(runCli(cwd, "run", "--json"));
      expect(result).toMatchObject({
        action: "release-published",
        releaseCreated: true,
        releaseReady: true,
        tagNames: ["node-demo-v1.0.1"],
        releaseTargets: [{ path: "node" }],
        externalReleaseTargets: [
          {
            path: "julia",
            sha,
            notes: expect.stringContaining("Reviewed julia fix"),
          },
        ],
      });
      expect(git(origin, "tag", "--list", "JuliaDemo-v1.0.1")).toBe("");
      expect(git(origin, "tag", "--list", "node-demo-v1.0.1")).toBe(
        "node-demo-v1.0.1",
      );
      git(cwd, "commit", "--allow-empty", "-m", "docs: later work");
      const waiting = JSON.parse(runCli(cwd, "run", "--json"));
      expect(waiting).toMatchObject({
        action: "release-waiting",
        releaseCreated: false,
        tagNames: [],
        externalReleaseTargets: [{ sha }],
      });
      expect(readPendingReleaseCohorts(cwd)).toEqual([]);
    },
  );

  it("prepares unrelated releases without changing an in-flight external version", () => {
    const { cwd } = setup();
    const sha = pending(cwd, ["julia"]);
    write(cwd, "julia/src.jl", "# Later correction.\n");
    write(cwd, "node/index.js", "export const ready = true;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: later changes");
    const plan = createReleasePlan(cwd);
    expect(
      plan.packages?.find((pkg) => pkg.path === "julia")?.nextVersion,
    ).toBeNull();
    expect(plan.packages?.find((pkg) => pkg.path === "node")?.nextVersion).toBe(
      "1.0.1",
    );
    const result = JSON.parse(runCli(cwd, "run", "--json"));
    expect(result).toMatchObject({
      action: "pr-prepared",
      releaseReady: false,
      externalReleaseTargets: [{ sha }],
      reviewRequests: [{ packagePaths: ["node"] }],
    });
    expect(
      fs.readFileSync(path.join(cwd, "julia/Project.toml"), "utf8"),
    ).toContain('version = "1.0.1"');
    git(cwd, "tag", "-a", "JuliaDemo-v1.0.1", "-m", "Registered", sha);
    expect(
      createReleasePlan(cwd).packages?.find((pkg) => pkg.path === "julia")
        ?.nextVersion,
    ).toBe("1.0.2");
  });

  it("recovers only internal pending targets after CI corrections", () => {
    const { cwd } = setup();
    pending(cwd);
    git(cwd, "commit", "--allow-empty", "-m", "fix: repair CI");
    const recovered = preparePendingSeparateReleasePrs(cwd, {
      "dry-run": true,
    });
    expect(recovered.map((candidate) => candidate.packagePaths)).toEqual([
      ["node"],
    ]);
  });

  it("supports direct releases while an unrelated external package waits", () => {
    const { cwd, origin } = setup(false, true);
    const sha = pending(cwd, ["julia"]);
    write(cwd, "node/index.js", "export const ready = true;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: node change");
    const result = JSON.parse(runCli(cwd, "run", "--json"));
    expect(result).toMatchObject({
      action: "release-published",
      tagNames: ["node-demo-v1.0.1"],
      releaseReady: false,
      externalReleaseTargets: [{ sha }],
    });
    expect(git(origin, "tag", "--list", "JuliaDemo-v1.0.1")).toBe("");
  });
  it("previews mixed releases without creating either tag", () => {
    const { cwd, origin } = setup();
    pending(cwd);
    const result = JSON.parse(runCli(cwd, "run", "--json", "--dry-run"));
    expect(result).toMatchObject({
      action: "release-dry-run",
      releaseCreated: false,
      releaseReady: false,
      releaseTargets: [{ path: "node" }],
      externalReleaseTargets: [{ path: "julia" }],
    });
    expect(git(origin, "tag", "--list", "*-v1.0.1")).toBe("");
  });

  it("never reports an unmerged external release PR as ready", () => {
    const { cwd } = setup();
    const config = JSON.parse(
      fs.readFileSync(path.join(cwd, "versionary.jsonc"), "utf8"),
    );
    config["separate-release-prs"] = false;
    write(cwd, "versionary.jsonc", JSON.stringify(config));
    write(cwd, "julia/source.jl", "# New fix.\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: Julia correction");
    const result = JSON.parse(runCli(cwd, "run", "--json"));
    expect(result.action).toBe("pr-prepared");
    expect(result.releaseReady).not.toBe(true);
    expect(result.externalReleaseTargets).toBeUndefined();
  });

  it("allows recovery when only the external member of a cohort has been tagged", () => {
    const { cwd } = setup();
    pending(cwd);
    git(cwd, "tag", "-a", "JuliaDemo-v1.0.1", "-m", "Registered");
    git(cwd, "commit", "--allow-empty", "-m", "fix: CI correction");
    expect(
      preparePendingSeparateReleasePrs(cwd, { "dry-run": true }).map(
        (candidate) => candidate.packagePaths,
      ),
    ).toEqual([["node"]]);
  });

  it("holds dependents while allowing unrelated packages to release", () => {
    const { cwd } = setup();
    const config = JSON.parse(
      fs.readFileSync(path.join(cwd, "versionary.jsonc"), "utf8"),
    );
    config.packages.julia["release-type"] = "rust";
    config.packages.node["release-type"] = "rust";
    config.packages.other = { "release-type": "node" };
    write(cwd, "versionary.jsonc", JSON.stringify(config));
    write(
      cwd,
      "julia/Cargo.toml",
      '[package]\nname = "ffi"\nversion = "1.0.1"\n',
    );
    write(
      cwd,
      "node/Cargo.toml",
      '[package]\nname = "consumer"\nversion = "1.0.0"\n[dependencies]\nffi = { path = "../julia", version = "=1.0.1" }\n',
    );
    write(cwd, "other/package.json", '{"name":"other","version":"1.0.0"}');
    write(
      cwd,
      "julia/CHANGELOG.md",
      "## 1.0.1 - 2026-11-03\n\n- Reviewed fix.\n",
    );
    writePackageReleaseState(
      cwd,
      git(cwd, "rev-parse", "HEAD"),
      [{ path: "julia", version: "1.0.1", tag: "JuliaDemo-v1.0.1" }],
      "versionary/release-julia",
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore(release): JuliaDemo-v1.0.1");
    for (const pkg of ["node", "other"])
      write(cwd, `${pkg}/index.js`, "export const ready = true;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: later changes");
    const plan = createReleasePlan(cwd);
    expect(
      plan.packages?.find((pkg) => pkg.path === "node")?.nextVersion,
    ).toBeNull();
    expect(
      plan.packages?.find((pkg) => pkg.path === "other")?.nextVersion,
    ).toBe("1.0.1");
  });

  it("holds a fixed-version cohort until external registration completes", () => {
    const { cwd } = setup();
    const config = JSON.parse(
      fs.readFileSync(path.join(cwd, "versionary.jsonc"), "utf8"),
    );
    config["separate-release-prs"] = false;
    config["monorepo-mode"] = "fixed";
    write(cwd, "versionary.jsonc", JSON.stringify(config));
    pending(cwd, ["julia"]);
    write(cwd, "node/index.js", "export const ready = true;\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fix: later node change");
    expect(createReleasePlan(cwd).nextVersion).toBeNull();
  });
  it("waits to publish a managed target that depends on a pending external target", () => {
    const { cwd, origin } = setup();
    const sha = pending(cwd);
    writePackageReleaseState(
      cwd,
      git(cwd, "rev-parse", "HEAD^"),
      [
        {
          path: "node",
          version: "1.0.1",
          tag: "node-demo-v1.0.1",
          dependencies: ["julia"],
        },
      ],
      "versionary/release-mixed",
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore(release): dependency handoff");
    const waiting = JSON.parse(runCli(cwd, "run", "--json"));
    expect(waiting).toMatchObject({ action: "release-waiting", tagNames: [] });
    expect(readPendingReleaseCohorts(cwd)).toEqual([]);
    expect(git(origin, "tag", "--list", "*-v1.0.1")).toBe("");
    git(cwd, "tag", "-a", "JuliaDemo-v1.0.1", "-m", "Registered", sha);
    const published = JSON.parse(runCli(cwd, "run", "--json"));
    expect(published).toMatchObject({
      action: "release-published",
      tagNames: ["node-demo-v1.0.1"],
    });
  });
});
