import { afterEach, describe, expect, it } from "vitest";
import { createBenchReport, printBenchComparison } from "../src/bench.js";
import { createSuiteReport } from "../src/suites.js";
import type { EvalReport, SuiteReport } from "../src/types.js";

function makeReport(trial: string, variant: string, overall: number): EvalReport {
  return {
    meta: {
      trial,
      variant,
      workerModel: "test/model",
      startedAt: "2026-01-01T00:00:00Z",
      durationMs: 30_000,
      status: "completed",
    },
    scores: {
      deterministic: { quality: overall, coverage: overall - 10 },
      overall,
      issues: [],
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
}

function makeSuiteForModel(
  model: string,
  trials: Array<{ trial: string; variant: string; overall: number }>,
): SuiteReport {
  const reports = trials.map((t, i) => ({
    report: makeReport(t.trial, t.variant, t.overall),
    runDir: `run-${model}-${i}`,
  }));
  return createSuiteReport("small", `suite-${model}`, reports, "2026-01-01T00:10:00Z", undefined, model);
}

describe("createBenchReport", () => {
  it("builds entries from two model suite reports", () => {
    const suiteA = makeSuiteForModel("anthropic/claude-sonnet", [
      { trial: "todo-cli", variant: "ts", overall: 82 },
      { trial: "booking", variant: "ts", overall: 71 },
    ]);
    const suiteB = makeSuiteForModel("openai/gpt-4o", [
      { trial: "todo-cli", variant: "ts", overall: 74 },
      { trial: "booking", variant: "ts", overall: 65 },
    ]);

    const reports = new Map<string, SuiteReport>([
      ["anthropic/claude-sonnet", suiteA],
      ["openai/gpt-4o", suiteB],
    ]);

    const bench = createBenchReport("small", "bench-001", reports, "2026-01-01T00:00:00Z");

    expect(bench.suite).toBe("small");
    expect(bench.models).toEqual(["anthropic/claude-sonnet", "openai/gpt-4o"]);
    expect(bench.entries).toHaveLength(2);

    const todo = bench.entries.find((e) => e.trial === "todo-cli");
    expect(todo?.overall["anthropic/claude-sonnet"]).toBe(82);
    expect(todo?.overall["openai/gpt-4o"]).toBe(74);

    expect(bench.averages["anthropic/claude-sonnet"]).toBe(76.5);
    expect(bench.averages["openai/gpt-4o"]).toBe(69.5);
  });

  it("handles trial missing from one model", () => {
    const suiteA = makeSuiteForModel("model-a", [
      { trial: "todo-cli", variant: "ts", overall: 80 },
      { trial: "booking", variant: "ts", overall: 70 },
    ]);
    const suiteB = makeSuiteForModel("model-b", [{ trial: "todo-cli", variant: "ts", overall: 75 }]);

    const reports = new Map<string, SuiteReport>([
      ["model-a", suiteA],
      ["model-b", suiteB],
    ]);

    const bench = createBenchReport("small", "bench-002", reports, "2026-01-01T00:00:00Z");
    expect(bench.entries).toHaveLength(2);

    const booking = bench.entries.find((e) => e.trial === "booking");
    expect(booking?.overall["model-a"]).toBe(70);
    expect(booking?.overall["model-b"]).toBeUndefined();
  });

  it("works with a single model", () => {
    const suiteA = makeSuiteForModel("model-a", [{ trial: "todo-cli", variant: "ts", overall: 85 }]);

    const reports = new Map([["model-a", suiteA]]);
    const bench = createBenchReport("small", "bench-003", reports, "2026-01-01T00:00:00Z");

    expect(bench.models).toEqual(["model-a"]);
    expect(bench.entries).toHaveLength(1);
    expect(bench.averages["model-a"]).toBe(85);
  });

  it("preserves deterministic scores per model", () => {
    const suiteA = makeSuiteForModel("model-a", [{ trial: "todo-cli", variant: "ts", overall: 80 }]);
    const suiteB = makeSuiteForModel("model-b", [{ trial: "todo-cli", variant: "ts", overall: 70 }]);

    const reports = new Map<string, SuiteReport>([
      ["model-a", suiteA],
      ["model-b", suiteB],
    ]);

    const bench = createBenchReport("small", "bench-004", reports, "2026-01-01T00:00:00Z");
    const todo = bench.entries.find((e) => e.trial === "todo-cli");
    expect(todo?.deterministic["model-a"]?.quality).toBe(80);
    expect(todo?.deterministic["model-b"]?.quality).toBe(70);
  });
});

describe("printBenchComparison", () => {
  let output: string[];
  const origLog = console.log;

  afterEach(() => {
    console.log = origLog;
  });

  function captureOutput(report: ReturnType<typeof createBenchReport>) {
    output = [];
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    printBenchComparison(report);
    console.log = origLog;
    return output;
  }

  it("prints comparison table with delta for two models", () => {
    const suiteA = makeSuiteForModel("anthropic/claude-sonnet", [{ trial: "todo-cli", variant: "ts", overall: 82 }]);
    const suiteB = makeSuiteForModel("openai/gpt-4o", [{ trial: "todo-cli", variant: "ts", overall: 74 }]);

    const bench = createBenchReport(
      "small",
      "bench-010",
      new Map([
        ["anthropic/claude-sonnet", suiteA],
        ["openai/gpt-4o", suiteB],
      ]),
      "2026-01-01T00:00:00Z",
    );

    const lines = captureOutput(bench);
    expect(lines.some((l) => l.includes("Model Comparison: small"))).toBe(true);
    expect(lines.some((l) => l.includes("claude-sonnet") && l.includes("gpt-4o"))).toBe(true);
    expect(lines.some((l) => l.includes("todo-cli/ts") && l.includes("82") && l.includes("74"))).toBe(true);
    expect(lines.some((l) => l.includes("+8"))).toBe(true);
  });

  it("prints single model without delta column", () => {
    const suiteA = makeSuiteForModel("model-a", [{ trial: "todo-cli", variant: "ts", overall: 85 }]);

    const bench = createBenchReport("small", "bench-011", new Map([["model-a", suiteA]]), "2026-01-01T00:00:00Z");
    const lines = captureOutput(bench);
    expect(lines.some((l) => l.includes("delta"))).toBe(false);
    expect(lines.some((l) => l.includes("85"))).toBe(true);
  });
});
