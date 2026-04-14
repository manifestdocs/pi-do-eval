import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareSuiteReports,
  createSuiteReport,
  loadLatestSuiteReport,
  loadPreviousSuiteReport,
  loadSuiteReport,
  updateSuiteIndex,
  writeSuiteReport,
} from "../src/suites.js";
import type { EvalReport, SuiteReport } from "../src/types.js";

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
