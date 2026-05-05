import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkerModelLabel } from "../src/lib/eval/project-runner.js";
import type { RunIndexEntry, SuiteReport } from "../src/lib/eval/types.js";
import { getOrLoadSuiteReport, resetRunData, runs, sidebarItems } from "../src/stores/runs.js";

function makeSuiteReport(suite: string, suiteRunId: string): SuiteReport {
  return {
    suite,
    suiteRunId,
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:01:00Z",
    entries: [],
    summary: {
      totalRuns: 0,
      completedRuns: 0,
      verifyFailureCount: 0,
      hardFailureCount: 0,
      averageOverall: 0,
    },
  };
}

afterEach(() => {
  resetRunData();
  vi.restoreAllMocks();
});

describe("suite report store cache", () => {
  it("does not collide when suite names and run ids share separators", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeSuiteReport("bar-baz", "foo")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeSuiteReport("baz", "foo-bar")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const first = await getOrLoadSuiteReport("bar-baz", "foo", "project-1");
    const second = await getOrLoadSuiteReport("baz", "foo-bar", "project-1");

    expect(first?.suite).toBe("bar-baz");
    expect(second?.suite).toBe("baz");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("sidebar run grouping", () => {
  it("keeps active and completed suite runs in the same worker group", () => {
    runs.set([
      makeRun({ dir: "run-active", status: "running", workerModel: "" }),
      makeRun({ dir: "run-done", status: "completed", suiteRunId: "suite-1", overall: 80 }),
    ]);

    const groups = get(sidebarItems);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.workerModel).toBe("openai/gpt-5.4");
    expect(groups[0]?.suiteRuns).toHaveLength(1);
    expect(groups[0]?.suiteRuns[0]?.finishedRuns).toBe(1);
    expect(groups[0]?.suiteRuns[0]?.totalRuns).toBe(2);
  });
});

describe("resolveWorkerModelLabel", () => {
  it("predicts the completed run model label for live run metadata", () => {
    const label = resolveWorkerModelLabel({
      activeWorker: { provider: "openai", model: "gpt-5.4" },
    });

    expect(label).toBe("openai/gpt-5.4");
  });
});

function makeRun(overrides: Partial<RunIndexEntry>): RunIndexEntry {
  return {
    dir: "run",
    trial: "proof-first-bugfix",
    variant: "default",
    status: "completed",
    overall: 0,
    durationMs: 100,
    startedAt: "2026-01-01T00:00:00Z",
    workerModel: "openai/gpt-5.4",
    suite: "allSkills",
    suiteRunId: "suite-1",
    ...overrides,
  };
}
