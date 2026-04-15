import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  formatMarkdown,
  printAggregatedSummary,
  printSuiteComparison,
  updateRunIndex,
  writeReport,
} from "../src/reporter.js";
import { writeSuiteReport } from "../src/suites.js";
import type { AggregatedSuiteEntry, EvalReport, SuiteComparison } from "../src/types.js";

function makeReport(overrides?: Partial<EvalReport> & { scores?: Partial<EvalReport["scores"]> }): EvalReport {
  const base: EvalReport = {
    meta: {
      trial: "test-project",
      variant: "baseline",
      workerModel: "claude-sonnet",
      startedAt: "2026-01-01T00:00:00Z",
      durationMs: 30000,
      status: "completed",
    },
    scores: {
      deterministic: { quality: 80, coverage: 60 },
      judge: { readability: 70 },
      overall: 75,
      issues: [],
    },
    session: {
      toolCalls: [{ timestamp: 0, name: "write", arguments: {}, resultText: "ok", wasBlocked: false }],
      fileWrites: [{ timestamp: 0, path: "src/index.ts", tool: "write", labels: [] }],
      pluginEvents: [],
      rawLines: [],
      startTime: 0,
      endTime: 30000,
      exitCode: 0,
      tokenUsage: { input: 1000, output: 500 },
      parseWarnings: 0,
    },
    findings: ["Found a potential issue"],
    judgeResult: {
      scores: { readability: 70 },
      reasons: { readability: "Code is clear and well-structured" },
      findings: ["Consider adding more comments"],
    },
  };
  const judgeScores = overrides?.scores ? overrides.scores.judge : base.scores.judge;

  return {
    ...base,
    ...overrides,
    meta: {
      ...base.meta,
      ...overrides?.meta,
    },
    scores: {
      deterministic: {
        ...base.scores.deterministic,
        ...overrides?.scores?.deterministic,
      },
      overall: overrides?.scores?.overall ?? base.scores.overall,
      issues: overrides?.scores?.issues ?? base.scores.issues,
      ...(judgeScores
        ? {
            judge: {
              ...judgeScores,
            },
          }
        : {}),
    },
    session: {
      ...base.session,
      ...overrides?.session,
    },
  };
}

describe("formatMarkdown", () => {
  it("includes the trial and variant in the title", () => {
    const md = formatMarkdown(makeReport());
    expect(md).toContain("# Eval Report: test-project (baseline)");
  });

  it("renders deterministic scores table", () => {
    const md = formatMarkdown(makeReport());
    expect(md).toContain("| quality | 80/100 |");
    expect(md).toContain("| coverage | 60/100 |");
  });

  it("renders judge scores table", () => {
    const md = formatMarkdown(makeReport());
    expect(md).toContain("## Judge Scores");
    expect(md).toContain("| readability | 70/100 |");
  });

  it("renders overall score", () => {
    const md = formatMarkdown(makeReport());
    expect(md).toContain("**Overall: 75/100**");
  });

  it("renders scoring issues when present", () => {
    const md = formatMarkdown(makeReport({ scores: { ...makeReport().scores, issues: ["Judge metric excluded"] } }));
    expect(md).toContain("## Scoring Issues");
    expect(md).toContain("- Judge metric excluded");
  });

  it("renders findings", () => {
    const md = formatMarkdown(makeReport());
    expect(md).toContain("## Findings");
    expect(md).toContain("- Found a potential issue");
  });

  it("renders judge reasoning", () => {
    const md = formatMarkdown(makeReport());
    expect(md).toContain("## Judge Reasoning");
    expect(md).toContain("**readability (70/100):** Code is clear and well-structured");
    expect(md).toContain("- Consider adding more comments");
  });

  it("omits judge section when no judge scores", () => {
    const md = formatMarkdown(makeReport({ scores: { deterministic: { quality: 80 }, overall: 80 } }));
    expect(md).not.toContain("## Judge Scores");
  });

  it("omits judge reasoning when no judge result", () => {
    const md = formatMarkdown(makeReport({ judgeResult: undefined }));
    expect(md).not.toContain("## Judge Reasoning");
  });

  it("renders default session summary without plugin", () => {
    const md = formatMarkdown(makeReport());
    expect(md).toContain("- Tool calls: 1");
    expect(md).toContain("- File writes: 1");
    expect(md).toContain("- Plugin events: 0");
  });

  it("renders duration in seconds", () => {
    const md = formatMarkdown(makeReport());
    expect(md).toContain("| Duration | 30.0s |");
  });

  it("renders worker and judge model", () => {
    const md = formatMarkdown(makeReport({ meta: { ...makeReport().meta, judgeModel: "claude-opus" } }));
    expect(md).toContain("| Worker Model | claude-sonnet |");
    expect(md).toContain("| Judge Model | claude-opus |");
  });

  it("renders suite metadata when present", () => {
    const md = formatMarkdown(makeReport({ meta: { ...makeReport().meta, suite: "small", suiteRunId: "suite-1" } }));
    expect(md).toContain("| Suite | small |");
    expect(md).toContain("| Suite Run | suite-1 |");
  });
});

describe("updateRunIndex", () => {
  it("ignores suite reports and keeps suite metadata on run entries", () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-do-eval-runs-"));
    const runDir = path.join(runsDir, "2026-01-01-example-default");

    writeReport(
      makeReport({
        meta: {
          ...makeReport().meta,
          suite: "small",
          suiteRunId: "suite-1",
          epoch: 2,
          totalEpochs: 3,
        },
      }),
      runDir,
    );
    writeSuiteReport(
      {
        suite: "small",
        suiteRunId: "suite-1",
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
      },
      runsDir,
    );

    updateRunIndex(runsDir);

    const entries = JSON.parse(fs.readFileSync(path.join(runsDir, "index.json"), "utf-8")) as Array<{
      dir: string;
      suite?: string;
      suiteRunId?: string;
      epoch?: number;
      totalEpochs?: number;
    }>;

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      dir: "2026-01-01-example-default",
      suite: "small",
      suiteRunId: "suite-1",
      epoch: 2,
      totalEpochs: 3,
    });
  });
});

describe("printAggregatedSummary", () => {
  it("prints mean, stderr bars, and epoch metadata", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const entry: AggregatedSuiteEntry = {
      trial: "todo-cli",
      variant: "typescript",
      epochs: 3,
      runDirs: ["r1", "r2", "r3"],
      overall: { mean: 76, stderr: 1.8, min: 72, max: 81, n: 3, values: [72, 76, 81] },
      deterministic: {
        correctness: { mean: 80, stderr: 2.1, min: 76, max: 84, n: 3, values: [76, 80, 84] },
      },
      statusCounts: { completed: 3 },
      verifyPassCount: 3,
      findings: [],
    };

    printAggregatedSummary(entry);
    vi.restoreAllMocks();

    const output = logs.join("\n");
    expect(output).toContain("todo-cli/typescript (3 epochs)");
    expect(output).toContain("correctness");
    expect(output).toContain("+/-2.1");
    expect(output).toContain("Overall");
    expect(output).toContain("+/-1.8");
    expect(output).toContain("72-81");
    expect(output).toContain("3/3 completed");
    expect(output).toContain("3/3 verified");
  });

  it("omits stderr when it is 0", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const entry: AggregatedSuiteEntry = {
      trial: "todo",
      variant: "ts",
      epochs: 1,
      runDirs: ["r1"],
      overall: { mean: 80, stderr: 0, min: 80, max: 80, n: 1, values: [80] },
      deterministic: { quality: { mean: 80, stderr: 0, min: 80, max: 80, n: 1, values: [80] } },
      statusCounts: { completed: 1 },
      verifyPassCount: 1,
      findings: [],
    };

    printAggregatedSummary(entry);
    vi.restoreAllMocks();

    const output = logs.join("\n");
    expect(output).not.toContain("+/-");
  });
});

describe("printSuiteComparison", () => {
  it("prints comparison with severity labels", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const comparison: SuiteComparison = {
      suite: "small",
      currentSuiteRunId: "suite-011",
      baselineSuiteRunId: "suite-010",
      threshold: 3,
      currentAverageOverall: 72,
      baselineAverageOverall: 80,
      averageDelta: -8,
      entries: [
        {
          trial: "todo-cli",
          variant: "ts",
          deltaOverall: -8,
          regression: true,
          severity: "clear",
          findings: ["Overall score dropped by 8 points"],
        },
        {
          trial: "api",
          variant: "ts",
          deltaOverall: -2,
          regression: false,
          severity: "drift",
          findings: ["Overall score drifted by -2 points"],
        },
        {
          trial: "calc",
          variant: "ts",
          regression: true,
          severity: "hard",
          findings: ["Status regressed from completed to timeout"],
        },
      ],
      findings: [],
      hasRegression: true,
      hardRegressionCount: 1,
      clearRegressionCount: 1,
      driftCount: 1,
    };

    printSuiteComparison(comparison);
    vi.restoreAllMocks();

    const output = logs.join("\n");
    expect(output).toContain("Suite: small");
    expect(output).toContain("suite-010");
    expect(output).toContain("suite-011");
    expect(output).toContain("CLEAR");
    expect(output).toContain("drift");
    expect(output).toContain("HARD");
    expect(output).toContain("1 hard, 1 clear, 1 drift");
  });
});
