import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateEpochEntries,
  compareSuiteReports,
  computeStats,
  createSuiteReport,
  loadLatestSuiteReport,
  loadPreviousSuiteReport,
  loadSuiteReport,
  updateSuiteIndex,
  writeSuiteReport,
} from "../src/suites.js";
import type { EvalReport, SuiteReport, SuiteReportEntry } from "../src/types.js";

const tempDirs: string[] = [];

interface ReportOverrides {
  meta?: Partial<EvalReport["meta"]>;
  scores?: Partial<EvalReport["scores"]> & {
    deterministic?: Record<string, number>;
  };
  session?: Partial<EvalReport["session"]>;
  findings?: string[];
}

function makeReport(trial: string, variant: string, overrides?: ReportOverrides): EvalReport {
  const base: EvalReport = {
    meta: {
      trial,
      variant,
      workerModel: "openai/gpt-5.4",
      startedAt: "2026-01-01T00:00:00Z",
      durationMs: 30_000,
      status: "completed",
    },
    scores: {
      deterministic: { quality: 80, coverage: 70 },
      overall: 80,
    },
    session: {
      toolCalls: [],
      fileWrites: [],
      pluginEvents: [],
      rawLines: [],
      startTime: 0,
      endTime: 30_000,
      exitCode: 0,
      tokenUsage: { input: 0, output: 0 },
      parseWarnings: 0,
    },
    findings: [],
  };

  return {
    ...base,
    ...overrides,
    meta: {
      ...base.meta,
      ...overrides?.meta,
    },
    scores: {
      ...base.scores,
      ...overrides?.scores,
      deterministic: {
        ...base.scores.deterministic,
        ...overrides?.scores?.deterministic,
      },
    },
    session: {
      ...base.session,
      ...overrides?.session,
    },
    findings: overrides?.findings ? [...overrides.findings] : base.findings,
  };
}

function makeSuite(entries: Array<{ report: EvalReport; runDir: string }>, suiteRunId: string): SuiteReport {
  return createSuiteReport("small", suiteRunId, entries, "2026-01-01T00:10:00Z");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("suite reports", () => {
  it("writes, indexes, and reloads suite runs", () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-do-eval-suites-"));
    tempDirs.push(runsDir);

    const baseline = makeSuite(
      [{ report: makeReport("todo-cli", "typescript-vitest"), runDir: "2026-01-01-todo" }],
      "suite-001",
    );
    const current = makeSuite(
      [{ report: makeReport("stack-calc", "typescript-vitest"), runDir: "2026-01-02-stack" }],
      "suite-002",
    );

    writeSuiteReport(baseline, runsDir);
    writeSuiteReport(current, runsDir);
    updateSuiteIndex(runsDir);

    expect(loadSuiteReport(runsDir, "small", "suite-001")?.suiteRunId).toBe("suite-001");
    expect(loadLatestSuiteReport(runsDir, "small")?.suiteRunId).toBe("suite-002");
    expect(loadPreviousSuiteReport(runsDir, "small")?.suiteRunId).toBe("suite-001");
    expect(loadPreviousSuiteReport(runsDir, "small", "suite-002")?.suiteRunId).toBe("suite-001");
  });

  it("summarizes completed, verify-failed, and hard-failed runs", () => {
    const report = makeSuite(
      [
        { report: makeReport("todo-cli", "typescript-vitest"), runDir: "run-a" },
        {
          report: makeReport("booking-api", "typescript-vitest", {
            findings: ["Verification failed"],
          }),
          runDir: "run-b",
        },
        {
          report: makeReport("shopping-cart", "typescript-vitest", {
            meta: { trial: "shopping-cart", variant: "typescript-vitest", status: "timeout" },
            findings: ["Session ended with status: timeout"],
          }),
          runDir: "run-c",
        },
      ],
      "suite-003",
    );

    expect(report.summary).toEqual({
      totalRuns: 3,
      completedRuns: 2,
      verifyFailureCount: 1,
      hardFailureCount: 2,
      averageOverall: 80,
    });
  });
});

describe("compareSuiteReports", () => {
  it("flags hard regressions, missing entries, and large score drops", () => {
    const baseline = makeSuite(
      [
        {
          report: makeReport("todo-cli", "typescript-vitest", {
            scores: { deterministic: { quality: 85 }, overall: 85 },
          }),
          runDir: "todo-old",
        },
        {
          report: makeReport("booking-api", "typescript-vitest", {
            scores: { deterministic: { quality: 90 }, overall: 90 },
          }),
          runDir: "booking-old",
        },
        {
          report: makeReport("stack-calc", "typescript-vitest", {
            scores: { deterministic: { quality: 92 }, overall: 92 },
          }),
          runDir: "stack-old",
        },
        {
          report: makeReport("word-freq", "python-pytest", {
            scores: { deterministic: { quality: 88 }, overall: 88 },
          }),
          runDir: "word-old",
        },
      ],
      "suite-010",
    );
    const current = makeSuite(
      [
        {
          report: makeReport("todo-cli", "typescript-vitest", {
            meta: { trial: "todo-cli", variant: "typescript-vitest", status: "timeout" },
            scores: { deterministic: { quality: 10 }, overall: 10 },
            findings: ["Session ended with status: timeout"],
          }),
          runDir: "todo-new",
        },
        {
          report: makeReport("booking-api", "typescript-vitest", {
            scores: { deterministic: { quality: 88 }, overall: 88 },
            findings: ["Verification failed"],
          }),
          runDir: "booking-new",
        },
        {
          report: makeReport("stack-calc", "typescript-vitest", {
            scores: { deterministic: { quality: 80 }, overall: 80 },
          }),
          runDir: "stack-new",
        },
        {
          report: makeReport("kanban-board", "typescript-vitest-svelte", {
            scores: { deterministic: { quality: 75 }, overall: 75 },
          }),
          runDir: "kanban-new",
        },
      ],
      "suite-011",
    );

    const comparison = compareSuiteReports(current, baseline, { threshold: 5 });

    expect(comparison.hasRegression).toBe(true);
    expect(comparison.entries.filter((entry) => entry.regression)).toHaveLength(4);
    expect(comparison.findings).toContain("todo-cli/typescript-vitest: Status regressed from completed to timeout");
    expect(comparison.findings).toContain("booking-api/typescript-vitest: Verification regressed from pass to fail");
    expect(comparison.findings).toContain("stack-calc/typescript-vitest: Overall score dropped by 12 points");
    expect(comparison.findings).toContain("word-freq/python-pytest: Entry missing from current suite run");
    expect(comparison.entries.find((entry) => entry.trial === "kanban-board")?.regression).toBe(false);
  });

  it("allows small score movement under the threshold", () => {
    const baseline = makeSuite(
      [
        {
          report: makeReport("todo-cli", "typescript-vitest", {
            scores: { deterministic: { quality: 80 }, overall: 80 },
          }),
          runDir: "todo-old",
        },
      ],
      "suite-020",
    );
    const current = makeSuite(
      [
        {
          report: makeReport("todo-cli", "typescript-vitest", {
            scores: { deterministic: { quality: 78 }, overall: 78 },
          }),
          runDir: "todo-new",
        },
      ],
      "suite-021",
    );

    const comparison = compareSuiteReports(current, baseline, { threshold: 3 });

    expect(comparison.hasRegression).toBe(false);
    expect(comparison.entries[0]?.regression).toBe(false);
    expect(comparison.entries[0]?.findings).toEqual([]);
  });
});

// -- Phase 1: Stats core -------------------------------------------------------

describe("computeStats", () => {
  it("returns stderr=0 for a single value", () => {
    const stats = computeStats([75]);
    expect(stats.mean).toBe(75);
    expect(stats.stderr).toBe(0);
    expect(stats.min).toBe(75);
    expect(stats.max).toBe(75);
    expect(stats.n).toBe(1);
  });

  it("computes correct mean and stderr for known values", () => {
    const stats = computeStats([70, 80, 90]);
    expect(stats.mean).toBe(80);
    // stddev = 10, stderr = 10/sqrt(3) ≈ 5.77
    expect(stats.stderr).toBeCloseTo(5.8, 0);
    expect(stats.min).toBe(70);
    expect(stats.max).toBe(90);
    expect(stats.n).toBe(3);
  });

  it("handles two values", () => {
    const stats = computeStats([60, 80]);
    expect(stats.mean).toBe(70);
    // stddev = sqrt(200) ≈ 14.14, stderr = 14.14/sqrt(2) ≈ 10
    expect(stats.stderr).toBeCloseTo(10, 0);
    expect(stats.n).toBe(2);
  });

  it("returns stderr=0 for identical values", () => {
    const stats = computeStats([85, 85, 85]);
    expect(stats.mean).toBe(85);
    expect(stats.stderr).toBe(0);
  });
});

function makeEntry(trial: string, variant: string, overrides?: Partial<SuiteReportEntry>): SuiteReportEntry {
  return {
    trial,
    variant,
    runDir: `run-${trial}-${variant}`,
    status: "completed",
    overall: 80,
    verifyPassed: true,
    deterministic: { quality: 80, coverage: 70 },
    findings: [],
    ...overrides,
  };
}

describe("aggregateEpochEntries", () => {
  it("aggregates 3 epochs of one trial into stats", () => {
    const entries: SuiteReportEntry[] = [
      makeEntry("todo-cli", "ts", { overall: 70, runDir: "run-1", deterministic: { quality: 70, coverage: 60 } }),
      makeEntry("todo-cli", "ts", { overall: 80, runDir: "run-2", deterministic: { quality: 80, coverage: 70 } }),
      makeEntry("todo-cli", "ts", { overall: 90, runDir: "run-3", deterministic: { quality: 90, coverage: 80 } }),
    ];

    const agg = aggregateEpochEntries(entries);
    expect(agg).toHaveLength(1);

    const entry = agg[0]!;
    expect(entry.trial).toBe("todo-cli");
    expect(entry.variant).toBe("ts");
    expect(entry.epochs).toBe(3);
    expect(entry.runDirs).toEqual(["run-1", "run-2", "run-3"]);
    expect(entry.overall.mean).toBe(80);
    expect(entry.overall.n).toBe(3);
    expect(entry.deterministic["quality"]!.mean).toBe(80);
    expect(entry.deterministic["coverage"]!.mean).toBeCloseTo(70, 0);
    expect(entry.statusCounts).toEqual({ completed: 3 });
    expect(entry.verifyPassCount).toBe(3);
  });

  it("handles mixed statuses across epochs", () => {
    const entries: SuiteReportEntry[] = [
      makeEntry("api", "ts", { overall: 80, runDir: "r1" }),
      makeEntry("api", "ts", { overall: 70, runDir: "r2", status: "timeout", verifyPassed: false }),
      makeEntry("api", "ts", { overall: 90, runDir: "r3" }),
    ];

    const agg = aggregateEpochEntries(entries);
    expect(agg[0]!.statusCounts).toEqual({ completed: 2, timeout: 1 });
    expect(agg[0]!.verifyPassCount).toBe(2);
  });

  it("handles judge scores present in some epochs", () => {
    const entries: SuiteReportEntry[] = [
      makeEntry("todo", "ts", { overall: 80, runDir: "r1", judge: { readability: 70 } }),
      makeEntry("todo", "ts", { overall: 85, runDir: "r2" }), // no judge
      makeEntry("todo", "ts", { overall: 90, runDir: "r3", judge: { readability: 90 } }),
    ];

    const agg = aggregateEpochEntries(entries);
    // Only 2 epochs had judge scores
    expect(agg[0]!.judge?.["readability"]!.n).toBe(2);
    expect(agg[0]!.judge?.["readability"]!.mean).toBe(80);
  });

  it("groups multiple trials correctly", () => {
    const entries: SuiteReportEntry[] = [
      makeEntry("todo", "ts", { overall: 70, runDir: "r1" }),
      makeEntry("todo", "ts", { overall: 80, runDir: "r2" }),
      makeEntry("api", "py", { overall: 90, runDir: "r3" }),
      makeEntry("api", "py", { overall: 85, runDir: "r4" }),
    ];

    const agg = aggregateEpochEntries(entries);
    expect(agg).toHaveLength(2);
    expect(agg.find((a) => a.trial === "todo")?.overall.mean).toBe(75);
    expect(agg.find((a) => a.trial === "api")?.overall.mean).toBe(87.5);
  });

  it("deduplicates findings across epochs", () => {
    const entries: SuiteReportEntry[] = [
      makeEntry("todo", "ts", { runDir: "r1", findings: ["Slow response", "Missing tests"] }),
      makeEntry("todo", "ts", { runDir: "r2", findings: ["Missing tests", "Low coverage"] }),
    ];

    const agg = aggregateEpochEntries(entries);
    expect(agg[0]!.findings).toEqual(["Slow response", "Missing tests", "Low coverage"]);
  });
});

// -- Phase 2: Suite report epoch support ----------------------------------------

describe("createSuiteReport with epochs", () => {
  it("populates aggregated data when epochs > 1", () => {
    const reports = [
      {
        report: makeReport("todo-cli", "ts", { scores: { deterministic: { quality: 70 }, overall: 70 } }),
        runDir: "r1",
      },
      {
        report: makeReport("todo-cli", "ts", { scores: { deterministic: { quality: 80 }, overall: 80 } }),
        runDir: "r2",
      },
      {
        report: makeReport("todo-cli", "ts", { scores: { deterministic: { quality: 90 }, overall: 90 } }),
        runDir: "r3",
      },
      { report: makeReport("api", "ts", { scores: { deterministic: { quality: 85 }, overall: 85 } }), runDir: "r4" },
      { report: makeReport("api", "ts", { scores: { deterministic: { quality: 95 }, overall: 95 } }), runDir: "r5" },
      { report: makeReport("api", "ts", { scores: { deterministic: { quality: 88 }, overall: 88 } }), runDir: "r6" },
    ];

    const suite = createSuiteReport("small", "suite-100", reports, "2026-01-01T00:10:00Z", 3);
    expect(suite.epochs).toBe(3);
    expect(suite.summary.epochs).toBe(3);
    expect(suite.aggregated).toHaveLength(2);

    const todo = suite.aggregated!.find((a) => a.trial === "todo-cli");
    expect(todo?.overall.mean).toBe(80);
    expect(todo?.epochs).toBe(3);
  });

  it("omits aggregated when epochs is 1 or omitted", () => {
    const reports = [{ report: makeReport("todo-cli", "ts"), runDir: "r1" }];

    const suite1 = createSuiteReport("small", "suite-101", reports, "2026-01-01T00:10:00Z");
    expect(suite1.epochs).toBeUndefined();
    expect(suite1.aggregated).toBeUndefined();

    const suite2 = createSuiteReport("small", "suite-102", reports, "2026-01-01T00:10:00Z", 1);
    expect(suite2.epochs).toBeUndefined();
    expect(suite2.aggregated).toBeUndefined();
  });

  it("includes epochs in suite index entries", () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-do-eval-epochs-"));
    tempDirs.push(runsDir);

    const reports = [
      { report: makeReport("todo-cli", "ts"), runDir: "r1" },
      { report: makeReport("todo-cli", "ts"), runDir: "r2" },
      { report: makeReport("todo-cli", "ts"), runDir: "r3" },
    ];
    const suite = createSuiteReport("small", "suite-200", reports, "2026-01-01T00:10:00Z", 3);
    writeSuiteReport(suite, runsDir);
    updateSuiteIndex(runsDir);

    const indexPath = path.join(runsDir, "suites", "index.json");
    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    expect(index[0].epochs).toBe(3);
  });

  it("can store comparison snapshots for the viewer", () => {
    const suite = createSuiteReport(
      "small",
      "suite-300",
      [{ report: makeReport("todo-cli", "ts"), runDir: "r1" }],
      "2026-01-01T00:10:00Z",
    );

    suite.comparison = {
      suite: "small",
      currentSuiteRunId: "suite-300",
      baselineSuiteRunId: "suite-299",
      threshold: 3,
      currentAverageOverall: 80,
      baselineAverageOverall: 82,
      averageDelta: -2,
      entries: [],
      findings: [],
      hasRegression: false,
      hardRegressionCount: 0,
      significantRegressionCount: 0,
      driftCount: 1,
    };

    expect(suite.comparison?.baselineSuiteRunId).toBe("suite-299");
  });
});

// -- Phase 3: Statistical comparison -------------------------------------------

describe("compareSuiteReports with epochs", () => {
  function makeEpochSuite(
    suiteRunId: string,
    entries: Array<{ trial: string; variant: string; overalls: number[]; statuses?: string[]; verifies?: boolean[] }>,
  ): SuiteReport {
    const reports: Array<{ report: EvalReport; runDir: string }> = [];
    for (const entry of entries) {
      for (let i = 0; i < entry.overalls.length; i++) {
        reports.push({
          report: makeReport(entry.trial, entry.variant, {
            scores: { deterministic: { quality: entry.overalls[i]! }, overall: entry.overalls[i]! },
            meta: {
              trial: entry.trial,
              variant: entry.variant,
              status: (entry.statuses?.[i] ?? "completed") as any,
            },
            findings: entry.verifies?.[i] === false ? ["Verification failed"] : [],
          }),
          runDir: `${suiteRunId}-${entry.trial}-${entry.variant}-e${i}`,
        });
      }
    }
    return createSuiteReport("small", suiteRunId, reports, "2026-01-01T00:10:00Z", entries[0]?.overalls.length);
  }

  it("detects significant regression with clearly separated distributions", () => {
    const baseline = makeEpochSuite("s-010", [{ trial: "todo", variant: "ts", overalls: [78, 80, 82] }]);
    const current = makeEpochSuite("s-011", [{ trial: "todo", variant: "ts", overalls: [58, 60, 62] }]);

    const comparison = compareSuiteReports(current, baseline);
    const entry = comparison.entries[0]!;
    expect(entry.severity).toBe("significant");
    expect(entry.regression).toBe(true);
    expect(comparison.hasRegression).toBe(true);
    expect(comparison.significantRegressionCount).toBe(1);
  });

  it("classifies overlapping distributions as drift, not regression", () => {
    const baseline = makeEpochSuite("s-020", [{ trial: "todo", variant: "ts", overalls: [75, 80, 85] }]);
    const current = makeEpochSuite("s-021", [{ trial: "todo", variant: "ts", overalls: [73, 78, 83] }]);

    const comparison = compareSuiteReports(current, baseline);
    const entry = comparison.entries[0]!;
    expect(entry.severity).toBe("drift");
    expect(entry.regression).toBe(false);
    expect(comparison.hasRegression).toBe(false);
    expect(comparison.driftCount).toBe(1);
  });

  it("detects hard regression when any epoch has status regression", () => {
    const baseline = makeEpochSuite("s-030", [{ trial: "todo", variant: "ts", overalls: [80, 80, 80] }]);
    const current = makeEpochSuite("s-031", [
      { trial: "todo", variant: "ts", overalls: [80, 70, 80], statuses: ["completed", "timeout", "completed"] },
    ]);

    const comparison = compareSuiteReports(current, baseline);
    const entry = comparison.entries[0]!;
    expect(entry.severity).toBe("hard");
    expect(entry.regression).toBe(true);
    expect(comparison.hardRegressionCount).toBe(1);
  });

  it("detects hard regression when verify regresses", () => {
    const baseline = makeEpochSuite("s-040", [{ trial: "todo", variant: "ts", overalls: [80, 80, 80] }]);
    const current = makeEpochSuite("s-041", [
      { trial: "todo", variant: "ts", overalls: [80, 80, 80], verifies: [true, false, true] },
    ]);

    const comparison = compareSuiteReports(current, baseline);
    expect(comparison.entries[0]!.severity).toBe("hard");
  });

  it("compares mixed epoch counts using aggregated data instead of the last epoch only", () => {
    const baseline = makeEpochSuite("s-045", [{ trial: "todo", variant: "ts", overalls: [80] }]);
    const current = makeEpochSuite("s-046", [{ trial: "todo", variant: "ts", overalls: [58, 60, 62] }]);

    const comparison = compareSuiteReports(current, baseline);
    expect(comparison.entries[0]!.severity).toBe("significant");
    expect(comparison.entries[0]!.currentAggregated?.epochs).toBe(3);
    expect(comparison.entries[0]!.baselineAggregated?.epochs).toBe(1);
  });

  it("detects hard regression when completion rate worsens from an already flaky baseline", () => {
    const baseline = makeEpochSuite("s-047", [
      { trial: "todo", variant: "ts", overalls: [80, 80, 80], statuses: ["completed", "timeout", "completed"] },
    ]);
    const current = makeEpochSuite("s-048", [
      { trial: "todo", variant: "ts", overalls: [80, 80, 80], statuses: ["timeout", "timeout", "completed"] },
    ]);

    const comparison = compareSuiteReports(current, baseline);
    expect(comparison.entries[0]!.severity).toBe("hard");
    expect(comparison.entries[0]!.findings[0]).toContain("Completion rate regressed");
  });

  it("preserves backward compat: single-epoch uses flat threshold with severity", () => {
    const baseline = makeSuite(
      [
        {
          report: makeReport("todo-cli", "typescript-vitest", {
            scores: { deterministic: { quality: 85 }, overall: 85 },
          }),
          runDir: "old",
        },
      ],
      "suite-050",
    );
    const current = makeSuite(
      [
        {
          report: makeReport("todo-cli", "typescript-vitest", {
            scores: { deterministic: { quality: 78 }, overall: 78 },
          }),
          runDir: "new",
        },
      ],
      "suite-051",
    );

    const comparison = compareSuiteReports(current, baseline, { threshold: 5 });
    const entry = comparison.entries[0]!;
    expect(entry.severity).toBe("significant");
    expect(entry.regression).toBe(true);
    expect(comparison.significantRegressionCount).toBe(1);
    expect(comparison.hardRegressionCount).toBe(0);
    expect(comparison.driftCount).toBe(0);
  });

  it("backward compat: status regression is hard in single-epoch mode", () => {
    const baseline = makeSuite(
      [
        {
          report: makeReport("todo-cli", "ts", { scores: { deterministic: { quality: 85 }, overall: 85 } }),
          runDir: "old",
        },
      ],
      "suite-060",
    );
    const current = makeSuite(
      [
        {
          report: makeReport("todo-cli", "ts", {
            meta: { trial: "todo-cli", variant: "ts", status: "timeout" },
            scores: { deterministic: { quality: 10 }, overall: 10 },
          }),
          runDir: "new",
        },
      ],
      "suite-061",
    );

    const comparison = compareSuiteReports(current, baseline);
    expect(comparison.entries[0]!.severity).toBe("hard");
    expect(comparison.hardRegressionCount).toBe(1);
  });

  it("no regression when scores are equal across epochs", () => {
    const baseline = makeEpochSuite("s-070", [{ trial: "todo", variant: "ts", overalls: [80, 80, 80] }]);
    const current = makeEpochSuite("s-071", [{ trial: "todo", variant: "ts", overalls: [80, 80, 80] }]);

    const comparison = compareSuiteReports(current, baseline);
    expect(comparison.entries[0]!.severity).toBeUndefined();
    expect(comparison.entries[0]!.regression).toBe(false);
    expect(comparison.hasRegression).toBe(false);
  });
});
