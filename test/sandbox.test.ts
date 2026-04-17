import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import {
  _resetAiJailCache,
  assertSandboxAvailable,
  buildSandboxedCommand,
  checkAiJail,
} from "../src/lib/eval/sandbox.js";

beforeEach(() => {
  _resetAiJailCache();
  vi.mocked(execFileSync).mockReset();
});

describe("checkAiJail", () => {
  it("returns true when ai-jail is on PATH", () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("/usr/local/bin/ai-jail"));
    expect(checkAiJail()).toBe(true);
  });

  it("returns false and warns when ai-jail is missing", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(checkAiJail()).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("caches the result after first check", () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
    checkAiJail();
    checkAiJail();
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });
});

describe("buildSandboxedCommand", () => {
  beforeEach(() => {
    // Make ai-jail available for these tests
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
  });

  it("wraps command with --rw-map for worker mode", () => {
    const result = buildSandboxedCommand("pi", ["-p", "--mode", "json"], {
      workDir: "/tmp/work",
      workDirAccess: "rw",
    });
    expect(result.command).toBe("ai-jail");
    expect(result.args).toEqual(["--rw-map", "/tmp/work:/tmp/work", "pi", "-p", "--mode", "json"]);
  });

  it("wraps command with --map (read-only) for judge mode", () => {
    const result = buildSandboxedCommand("pi", ["-p"], {
      workDir: "/tmp/work",
      workDirAccess: "ro",
    });
    expect(result.command).toBe("ai-jail");
    expect(result.args).toEqual(["--map", "/tmp/work:/tmp/work", "pi", "-p"]);
  });

  it("adds extra rw and ro paths", () => {
    const result = buildSandboxedCommand("pi", ["-p"], {
      workDir: "/tmp/work",
      workDirAccess: "rw",
      options: {
        extraRwPaths: ["/tmp/cache"],
        extraRoPaths: ["/data/ref"],
      },
    });
    expect(result.args).toContain("--rw-map");
    expect(result.args).toContain("/tmp/cache:/tmp/cache");
    expect(result.args).toContain("/data/ref:/data/ref");
  });

  it("adds --lockdown when requested", () => {
    const result = buildSandboxedCommand("pi", ["-p"], {
      workDir: "/tmp/work",
      workDirAccess: "rw",
      options: { lockdown: true },
    });
    expect(result.args).toContain("--lockdown");
  });

  it("returns original command when ai-jail is unavailable", () => {
    _resetAiJailCache();
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = buildSandboxedCommand("pi", ["-p", "--mode", "json"], {
      workDir: "/tmp/work",
      workDirAccess: "rw",
    });
    expect(result.command).toBe("pi");
    expect(result.args).toEqual(["-p", "--mode", "json"]);
  });
});

describe("assertSandboxAvailable", () => {
  it("allows omitted sandbox configuration", () => {
    expect(() => assertSandboxAvailable(undefined)).not.toThrow();
  });

  it("warns but does not throw for boolean sandbox fallback", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => assertSandboxAvailable(true)).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it("throws when explicit sandbox options are requested without ai-jail", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => assertSandboxAvailable({ lockdown: true })).toThrow(
      "ai-jail not found on PATH but explicit SandboxOptions were provided. Install ai-jail or pass sandbox: true to fall back to unsandboxed.",
    );
  });
});
