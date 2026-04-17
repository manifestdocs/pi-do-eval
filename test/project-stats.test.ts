import { describe, expect, it } from "vitest";
import type { LauncherConfig, SuiteIndexEntry } from "../src/lib/eval/types.js";
import { computeProjectStats } from "../src/lib/project-stats.js";

function makeLauncherConfig(overrides: Partial<LauncherConfig> = {}): LauncherConfig {
  return {
    trials: [
      { name: "trial-a", description: "", variants: ["default"] },
      { name: "trial-b", description: "", variants: ["default", "edge"] },
    ],
    suites: {
      smoke: [{ trial: "trial-a", variant: "default" }],
      full: [
        { trial: "trial-a", variant: "default" },
        { trial: "trial-b", variant: "default" },
        { trial: "trial-b", variant: "edge" },
      ],
    },
    models: [],
    ...overrides,
  };
}

function makeSuiteEntry(overrides: Partial<SuiteIndexEntry> = {}): SuiteIndexEntry {
  return {
    suite: "smoke",
    suiteRunId: "run-1",
    dir: "run-1-smoke",
    startedAt: "2026-04-16T10:00:00.000Z",
    completedAt: "2026-04-16T10:05:00.000Z",
    totalRuns: 1,
    hardFailureCount: 0,
    averageOverall: 80,
    ...overrides,
  };
}

describe("computeProjectStats", () => {
  it("returns zero counts when config is null", () => {
    const stats = computeProjectStats(null, []);
    expect(stats).toEqual({
      trialCount: 0,
      suiteCount: 0,
      suiteRunCount: 0,
      latestSuiteRun: null,
      configAvailable: false,
    });
  });

  it("counts trials and suites from launcher config", () => {
    const stats = computeProjectStats(makeLauncherConfig(), []);
    expect(stats.trialCount).toBe(2);
    expect(stats.suiteCount).toBe(2);
    expect(stats.configAvailable).toBe(true);
  });

  it("returns the latest suite run by completedAt", () => {
    const entries: SuiteIndexEntry[] = [
      makeSuiteEntry({ suiteRunId: "a", completedAt: "2026-04-10T00:00:00.000Z", averageOverall: 70 }),
      makeSuiteEntry({ suiteRunId: "b", completedAt: "2026-04-15T00:00:00.000Z", averageOverall: 90 }),
      makeSuiteEntry({ suiteRunId: "c", completedAt: "2026-04-12T00:00:00.000Z", averageOverall: 80 }),
    ];

    const stats = computeProjectStats(makeLauncherConfig(), entries);

    expect(stats.suiteRunCount).toBe(3);
    expect(stats.latestSuiteRun?.suiteRunId).toBe("b");
    expect(stats.latestSuiteRun?.averageOverall).toBe(90);
  });

  it("computes regression delta against the previous run of the same suite", () => {
    const entries: SuiteIndexEntry[] = [
      makeSuiteEntry({
        suite: "smoke",
        suiteRunId: "old",
        completedAt: "2026-04-10T00:00:00.000Z",
        averageOverall: 80,
      }),
      makeSuiteEntry({
        suite: "smoke",
        suiteRunId: "new",
        completedAt: "2026-04-15T00:00:00.000Z",
        averageOverall: 75,
      }),
      makeSuiteEntry({
        suite: "other",
        suiteRunId: "other-1",
        completedAt: "2026-04-14T00:00:00.000Z",
        averageOverall: 95,
      }),
    ];

    const stats = computeProjectStats(makeLauncherConfig(), entries);

    expect(stats.latestSuiteRun?.suiteRunId).toBe("new");
    expect(stats.latestSuiteRun?.delta).toBeCloseTo(-5, 5);
  });

  it("returns null delta when the suite has no prior run", () => {
    const entries: SuiteIndexEntry[] = [
      makeSuiteEntry({ suite: "smoke", suiteRunId: "only", averageOverall: 88 }),
    ];
    const stats = computeProjectStats(makeLauncherConfig(), entries);
    expect(stats.latestSuiteRun?.delta).toBeNull();
  });
});
