import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { formatMarkdown, updateRunIndex, writeReport } from "../src/reporter.js";
import { writeSuiteReport } from "../src/suites.js";
import type { EvalReport } from "../src/types.js";

function makeReport(overrides?: Partial<EvalReport>): EvalReport {
  return {
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
    ...overrides,
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

    writeReport(makeReport({ meta: { ...makeReport().meta, suite: "small", suiteRunId: "suite-1" } }), runDir);
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
    }>;

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      dir: "2026-01-01-example-default",
      suite: "small",
      suiteRunId: "suite-1",
    });
  });
});
