import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn();
  pid = 4242;
}

let nextChild: FakeChildProcess | null = null;

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    nextChild ??= new FakeChildProcess();
    const child = nextChild;
    nextChild = null;
    return child;
  }),
}));

import { spawn } from "node:child_process";
import type { LauncherConfig } from "../src/lib/eval/types.js";
import {
  getActiveRunsRegistryPath,
  getRunStatus,
  killActiveRun,
  recoverActiveRuns,
  resetLauncherState,
  spawnRun,
} from "../src/lib/server/launcher.js";

let tmpDir: string;

const launcherConfig: LauncherConfig = {
  trials: [{ name: "example", description: "Example", variants: ["default"] }],
  suites: { quick: [{ trial: "example", variant: "default" }] },
  models: [],
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-do-eval-launcher-"));
  process.env.PI_DO_EVAL_CONFIG_HOME = path.join(tmpDir, "config-home");
  fs.mkdirSync(path.join(tmpDir, "runs"), { recursive: true });
  nextChild = null;
  resetLauncherState();
  vi.useRealTimers();
});

afterEach(() => {
  resetLauncherState();
  delete process.env.PI_DO_EVAL_CONFIG_HOME;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("spawnRun", () => {
  it("captures launcher logs, persists active runs, and logs non-zero exits", async () => {
    const child = new FakeChildProcess();
    nextChild = child;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = spawnRun(
      "project-1",
      { type: "trial", trial: "example", variant: "default" },
      "bun eval.ts",
      tmpDir,
      launcherConfig,
    );

    expect(result).toEqual({ ok: true, id: expect.stringMatching(/^run-/) });
    const runId = result.ok ? result.id : "missing";
    expect(getRunStatus("project-1")).toEqual({
      active: true,
      id: runId,
      command: "bun eval.ts run --trial example --variant default",
    });

    const registryPath = getActiveRunsRegistryPath();
    const activeRegistry = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as Record<string, { id: string }>;
    expect(activeRegistry["project-1"]?.id).toBe(runId);

    child.stdout.write("launcher out\n");
    child.stderr.write("launcher err\n");
    child.emit("exit", 1);
    await new Promise((resolve) => setImmediate(resolve));

    expect(fs.readFileSync(path.join(tmpDir, "runs", runId, "launcher.stdout.log"), "utf-8")).toContain("launcher out");
    expect(fs.readFileSync(path.join(tmpDir, "runs", runId, "launcher.stderr.log"), "utf-8")).toContain("launcher err");
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(`Run ${runId} exited with code 1`));
    expect(getRunStatus("project-1")).toEqual({ active: false });
    expect(JSON.parse(fs.readFileSync(registryPath, "utf-8"))).toEqual({});
    expect(spawn).toHaveBeenCalledWith(
      "bun",
      ["eval.ts", "run", "--trial", "example", "--variant", "default"],
      expect.objectContaining({ cwd: tmpDir }),
    );
  });
});

describe("killActiveRun", () => {
  it("sends SIGTERM immediately and SIGKILL after the grace period", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    nextChild = child;

    const result = spawnRun(
      "project-2",
      { type: "trial", trial: "example", variant: "default" },
      "bun eval.ts",
      tmpDir,
      launcherConfig,
    );

    expect(result.ok).toBe(true);
    killActiveRun("project-2", { forceAfterMs: 5000 });

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(getRunStatus("project-2")).toEqual({ active: false });
  });
});

describe("recoverActiveRuns", () => {
  it("drops dead persisted processes during recovery", () => {
    fs.mkdirSync(path.dirname(getActiveRunsRegistryPath()), { recursive: true });
    fs.writeFileSync(
      getActiveRunsRegistryPath(),
      JSON.stringify({
        ghost: {
          id: "run-ghost",
          projectId: "ghost",
          pid: 999_999,
          command: "bun eval.ts run --trial example --variant default",
          startedAt: "2026-01-01T00:00:00Z",
          runDir: path.join(tmpDir, "runs", "run-ghost"),
        },
      }),
    );

    vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("ESRCH");
      (error as Error & { code?: string }).code = "ESRCH";
      throw error;
    });

    recoverActiveRuns();

    expect(JSON.parse(fs.readFileSync(getActiveRunsRegistryPath(), "utf-8"))).toEqual({});
  });
});
