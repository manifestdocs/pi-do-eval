import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LauncherConfig, SuiteIndexEntry } from "../src/lib/eval/types.js";
import {
  allProjectStats,
  loadProjectStats,
  resetProjectStats,
} from "../src/stores/project-stats.js";

const launcherConfig: LauncherConfig = {
  trials: [
    { name: "trial-a", description: "", variants: ["default"] },
    { name: "trial-b", description: "", variants: ["default"] },
  ],
  suites: {
    smoke: [{ trial: "trial-a", variant: "default" }],
  },
  models: [],
};

const suiteIndex: SuiteIndexEntry[] = [
  {
    suite: "smoke",
    suiteRunId: "run-1",
    dir: "run-1-smoke",
    startedAt: "2026-04-15T00:00:00.000Z",
    completedAt: "2026-04-15T00:05:00.000Z",
    totalRuns: 1,
    hardFailureCount: 0,
    averageOverall: 80,
  },
];

function mockFetch(launcher: LauncherConfig | null, suites: SuiteIndexEntry[]): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (typeof url !== "string") throw new Error(`Unexpected url: ${url}`);
    if (url.endsWith("/launcher")) {
      if (!launcher) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(launcher), { status: 200 });
    }
    if (url.endsWith("/runs/suites/index.json")) {
      return new Response(JSON.stringify(suites), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

afterEach(() => {
  resetProjectStats();
  vi.restoreAllMocks();
});

describe("project-stats store", () => {
  it("loads stats for a single project", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch(launcherConfig, suiteIndex) as never);

    await loadProjectStats("project-1");

    const stats = get(allProjectStats)["project-1"];
    expect(stats).toBeTruthy();
    expect(stats?.trialCount).toBe(2);
    expect(stats?.suiteCount).toBe(1);
    expect(stats?.suiteRunCount).toBe(1);
    expect(stats?.latestSuiteRun?.suiteRunId).toBe("run-1");
  });

  it("records configAvailable=false when launcher config is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch(null, []) as never);

    await loadProjectStats("project-2");

    const stats = get(allProjectStats)["project-2"];
    expect(stats).toBeTruthy();
    expect(stats?.configAvailable).toBe(false);
    expect(stats?.trialCount).toBe(0);
  });
});
