import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuiteReport } from "../src/lib/eval/types.js";
import { getOrLoadSuiteReport, resetRunData } from "../src/stores/runs.js";

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
