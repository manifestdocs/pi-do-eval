import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalEvent } from "../src/lib/eval/types.js";
import { addOrUpdateProject } from "../src/lib/server/projects.js";
import { createRunsFileResponse } from "../src/lib/server/run-files.js";
import { projectWatchers } from "../src/lib/server/runtime.js";
import { createShutdownController } from "../src/lib/server/shutdown.js";
import { RunsWatcher } from "../src/lib/server/watcher.js";
import { GET as getProjectEvents } from "../src/routes/api/projects/[projectId]/events/+server.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-do-eval-server-"));
  process.env.PI_DO_EVAL_CONFIG_HOME = path.join(tmpDir, "config-home");
});

afterEach(() => {
  projectWatchers.stopAll();
  delete process.env.PI_DO_EVAL_CONFIG_HOME;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createRunsFileResponse", () => {
  it("blocks direct path traversal", () => {
    const evalDir = path.join(tmpDir, "eval");
    fs.mkdirSync(path.join(evalDir, "runs"), { recursive: true });

    const response = createRunsFileResponse(evalDir, "../secret.txt");

    expect(response.status).toBe(403);
  });

  it("blocks symlink escapes outside the runs root", async () => {
    const evalDir = path.join(tmpDir, "eval");
    const runsDir = path.join(evalDir, "runs");
    const outside = path.join(tmpDir, "outside.txt");
    fs.mkdirSync(path.join(runsDir, "run-1"), { recursive: true });
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, path.join(runsDir, "run-1", "report.txt"));

    const response = createRunsFileResponse(evalDir, "run-1/report.txt");

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
  });
});

describe("project SSE routes", () => {
  it("removes the watcher listener when the stream is cancelled", async () => {
    const projectRoot = path.join(tmpDir, "project");
    const evalDir = path.join(projectRoot, "eval");
    fs.mkdirSync(evalDir, { recursive: true });
    fs.writeFileSync(path.join(evalDir, "eval.ts"), "export {};\n");
    const project = addOrUpdateProject(projectRoot).project;

    const response = await getProjectEvents({ params: { projectId: project.id } } as never);

    expect(response.status).toBe(200);
    expect(projectWatchers.getListenerCount(project.id)).toBe(1);

    await response.body?.cancel();

    expect(projectWatchers.getListenerCount(project.id)).toBe(0);
  });
});

describe("RunsWatcher", () => {
  it("caps buffered progress events while preserving the latest index update", () => {
    const watcher = new RunsWatcher(tmpDir);
    const emit = (watcher as unknown as { emit(event: EvalEvent): void }).emit.bind(watcher);

    emit({ type: "index_updated", timestamp: 1, runs: [] });
    for (let i = 0; i < 550; i++) {
      emit({
        type: "run_progress",
        timestamp: i + 2,
        dir: `run-${i}`,
        durationMs: i,
        toolCount: i,
        fileCount: i,
      });
    }

    const buffered = (watcher as unknown as { events: EvalEvent[] }).events;
    expect(buffered).toHaveLength(500);
    expect(buffered[0]?.type).toBe("index_updated");
    expect(buffered.at(-1)).toMatchObject({ type: "run_progress", dir: "run-549" });
  });

  it("snapshots listeners before dispatch so removals do not skip pending listeners", () => {
    const watcher = new RunsWatcher(tmpDir);
    const emit = (watcher as unknown as { emit(event: EvalEvent): void }).emit.bind(watcher);
    const calls: string[] = [];

    let unsubscribeSecond = () => {};
    watcher.subscribe(() => {
      calls.push("first");
      unsubscribeSecond();
    });
    unsubscribeSecond = watcher.subscribe(() => {
      calls.push("second");
    });
    watcher.subscribe(() => {
      calls.push("third");
    });

    emit({ type: "index_updated", timestamp: 1, runs: [] });

    expect(calls).toEqual(["first", "second", "third"]);
  });
});

describe("shutdown controller", () => {
  it("kills active runs and stops watchers during shutdown", async () => {
    const stopAll = vi.fn();
    const killActiveRun = vi.fn();
    const controller = createShutdownController({
      listProjectIds: () => ["alpha", "beta"],
      killActiveRun,
      stopAll,
      forceKillDelayMs: 2500,
    });

    await controller.shutdown("SIGTERM");

    expect(killActiveRun).toHaveBeenCalledTimes(2);
    expect(killActiveRun).toHaveBeenNthCalledWith(1, "alpha", { forceAfterMs: 2500 });
    expect(killActiveRun).toHaveBeenNthCalledWith(2, "beta", { forceAfterMs: 2500 });
    expect(stopAll).toHaveBeenCalledOnce();
  });
});
