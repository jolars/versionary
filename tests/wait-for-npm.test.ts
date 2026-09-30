import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { waitForNpmPackage } from "../scripts/wait-for-npm.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

describe("npm publication guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.mocked(execFileSync).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("downloads the exact published package using an isolated cache", async () => {
    vi.mocked(execFileSync).mockImplementation((_command, _args, options) => {
      expect(readdirSync(String(options?.cwd))).toEqual([]);
      return "versionary-1.6.0.tgz\n";
    });

    await waitForNpmPackage("versionary", "1.6.0");

    expect(execFileSync).toHaveBeenCalledOnce();
    const [command, args, options] = vi.mocked(execFileSync).mock.calls[0];
    expect(command).toBe("npm");
    expect(args).toEqual([
      "pack",
      "versionary@1.6.0",
      "--ignore-scripts",
      "--registry=https://registry.npmjs.org",
      "--prefer-online",
      "--fetch-retries=0",
      "--cache",
      path.join(String(options?.cwd), "cache"),
    ]);
    expect(options?.timeout).toBe(30_000);
    expect(existsSync(String(options?.cwd))).toBe(false);
  });

  it("waits for both metadata and the tarball to become available", async () => {
    vi.mocked(execFileSync)
      .mockImplementationOnce(() => {
        throw new Error("ETARGET: No matching version found");
      })
      .mockImplementationOnce(() => {
        throw new Error("E404: Tarball not found");
      })
      .mockReturnValue("versionary-1.6.0.tgz\n");

    const waiting = waitForNpmPackage("versionary", "1.6.0");
    expect(execFileSync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(execFileSync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    await waiting;
    expect(execFileSync).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails after 15 minutes with the last error and removes temporary files", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("E404: Tarball not found");
    });

    const failed = expect(
      waitForNpmPackage("versionary", "1.6.0"),
    ).rejects.toThrow(
      /Timed out.*versionary@1\.6\.0.*E404: Tarball not found/s,
    );
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    await failed;

    expect(execFileSync).toHaveBeenCalledTimes(30);
    for (const [, , options] of vi.mocked(execFileSync).mock.calls) {
      expect(existsSync(String(options?.cwd))).toBe(false);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("includes time spent downloading in the deadline and caps each request", async () => {
    vi.mocked(execFileSync).mockImplementation((_command, _args, options) => {
      const remaining = 15 * 60_000 - Date.now();
      expect(options?.timeout).toBe(Math.min(30_000, remaining));
      expect(options?.killSignal).toBe("SIGKILL");
      vi.setSystemTime(Date.now() + Math.min(29_000, remaining));
      throw new Error("Download timed out");
    });

    const failed = expect(
      waitForNpmPackage("versionary", "1.6.0"),
    ).rejects.toThrow(/Timed out.*Download timed out/s);
    await vi.runAllTimersAsync();
    await failed;

    expect(Date.now()).toBe(15 * 60_000);
    expect(execFileSync).toHaveBeenCalledTimes(16);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("publish workflow", () => {
  it("requires the availability guard to pass before advancing the major tag", () => {
    const workflow = parse(
      readFileSync(
        new URL("../.github/workflows/publish.yml", import.meta.url),
        "utf8",
      ),
    );
    const publish = workflow.jobs.publish;
    const guard = publish.steps.findIndex((step: { run?: string }) =>
      step.run?.includes("scripts/wait-for-npm.ts"),
    );
    const upload = publish.steps.findIndex((step: { run?: string }) =>
      step.run?.includes("publish --no-git-checks"),
    );

    expect(upload).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(upload);
    expect(publish.steps[guard].if).toBeUndefined();
    expect(publish.steps[guard]["continue-on-error"]).toBeUndefined();
    expect(publish["continue-on-error"]).toBeUndefined();
    expect(workflow.jobs["update-action-major-tag"].needs).toBe("publish");
    expect(workflow.jobs["update-action-major-tag"].if).not.toContain(
      "always()",
    );
  });
});
