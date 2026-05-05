import { afterEach, describe, expect, it } from "vitest";
import {
  collectBenchGateFailures,
  createBenchReport,
  createProfileBenchReport,
  printBenchComparison,
} from "../src/lib/eval/bench.js";
import { createSuiteReport } from "../src/lib/eval/suites.js";
import type { EvalReport, ExecutionProfile, SuiteReport } from "../src/lib/eval/types.js";

function makeReport(trial: string, variant: string, overall: number, overrides?: Partial<EvalReport>): EvalReport {
  return {
    meta: {
      trial,
      variant,
      workerModel: "test/model",
      startedAt: "2026-01-01T00:00:00Z",
      durationMs: 30_000,
      status: "completed",
      verifyPassed: true,
    },
    scores: {
      deterministic: { quality: overall, coverage: overall - 10 },
      overall,
      issues: [],
      ...overrides?.scores,
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
    ...overrides,
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
    expect(bench.profiles?.[0]?.factors).toEqual({ provider: "anthropic", model: "claude-sonnet", layers: [] });
    expect(bench.profiles?.[1]?.factors).toEqual({ provider: "openai", model: "gpt-4o", layers: [] });
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

describe("collectBenchGateFailures", () => {
  const profile: ExecutionProfile = {
    id: "codexWithLayer",
    label: "Codex with layer",
    agent: { harness: "codex" },
    factors: { layers: [] },
  };

  it("requires judge scores when configured", () => {
    const suite = makeSuiteForModel("codexWithLayer", [{ trial: "routing", variant: "default", overall: 90 }]);

    expect(
      collectBenchGateFailures([{ profile, report: suite }], { profiles: [profile.id], requireJudge: true }),
    ).toEqual(["codexWithLayer routing/default: judge result required but missing"]);
  });

  it("requires deterministic score minimums when configured", () => {
    const report = makeReport("routing", "default", 90, {
      scores: {
        deterministic: { baseline_isolation: 100, abp_activation: 0 },
        judge: { quality: 90 },
        overall: 90,
        issues: [],
      },
    });
    const suite = createSuiteReport(
      "small",
      "suite-layer",
      [{ report, runDir: "run-layer" }],
      "2026-01-01T00:10:00Z",
      undefined,
      profile.id,
    );

    expect(
      collectBenchGateFailures([{ profile, report: suite }], {
        profiles: [profile.id],
        requireJudge: true,
        requiredDeterministicScores: { baseline_isolation: 100, abp_activation: 100 },
      }),
    ).toEqual(['codexWithLayer routing/default: deterministic score "abp_activation" 0 is below required 100']);
  });
});

describe("createProfileBenchReport", () => {
  it("rejects an unknown baseline profile", () => {
    const profile: ExecutionProfile = {
      id: "codex-baseline",
      label: "Codex baseline",
      agent: { harness: "codex", model: "gpt-5.2" },
      factors: { harness: "codex", model: "gpt-5.2", layers: [] },
    };
    const suite = makeSuiteForModel("codex-baseline", [{ trial: "bugfix", variant: "default", overall: 70 }]);

    expect(() =>
      createProfileBenchReport(
        "engineering-maturity",
        "bench-skills",
        [{ profile, report: suite }],
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:20:00Z",
        "missing-profile",
      ),
    ).toThrow(/Unknown baseline profile "missing-profile"/);
  });

  it("rejects duplicate profile ids", () => {
    const firstProfile: ExecutionProfile = {
      id: "codex-baseline",
      label: "Codex baseline",
      agent: { harness: "codex", model: "gpt-5.2" },
      factors: { harness: "codex", model: "gpt-5.2", layers: [] },
    };
    const secondProfile: ExecutionProfile = {
      id: "codex-baseline",
      label: "Codex duplicate",
      agent: { harness: "codex", model: "gpt-5.2" },
      factors: {
        harness: "codex",
        model: "gpt-5.2",
        layers: [{ kind: "skill-library", id: "engineering-skills" }],
      },
    };

    expect(() =>
      createProfileBenchReport(
        "engineering-maturity",
        "bench-skills",
        [
          {
            profile: firstProfile,
            report: makeSuiteForModel("codex-baseline-a", [{ trial: "bugfix", variant: "default", overall: 70 }]),
          },
          {
            profile: secondProfile,
            report: makeSuiteForModel("codex-baseline-b", [{ trial: "bugfix", variant: "default", overall: 84 }]),
          },
        ],
        "2026-01-01T00:00:00Z",
      ),
    ).toThrow(/Duplicate profile id "codex-baseline"/);
  });

  it("compares execution profiles with ordered layers and baseline deltas", () => {
    const controlProfile: ExecutionProfile = {
      id: "codex-gpt52",
      label: "Codex / GPT-5.2",
      agent: { harness: "codex", model: "gpt-5.2" },
      factors: {
        harness: "codex",
        model: "gpt-5.2",
        layers: [],
      },
    };
    const skillsProfile: ExecutionProfile = {
      id: "codex-gpt52-skills",
      label: "Codex / GPT-5.2 / skills",
      agent: { harness: "codex", model: "gpt-5.2" },
      factors: {
        harness: "codex",
        model: "gpt-5.2",
        layers: [{ kind: "skill-library", id: "engineering-skills", runtime: "codex", capabilities: ["skills"] }],
      },
      setup: {
        layers: [
          {
            kind: "skill-library",
            id: "engineering-skills",
            runtime: "codex",
            mode: "copy",
            source: "/path/to/skills",
          },
        ],
      },
    };

    const controlSuite = makeSuiteForModel("codex-gpt52", [{ trial: "bugfix", variant: "default", overall: 70 }]);
    const skillsSuite = makeSuiteForModel("codex-gpt52-skills", [{ trial: "bugfix", variant: "default", overall: 84 }]);

    const bench = createProfileBenchReport(
      "engineering-maturity",
      "bench-skills",
      [
        { profile: controlProfile, report: controlSuite },
        { profile: skillsProfile, report: skillsSuite },
      ],
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:20:00Z",
      "codex-gpt52",
    );

    expect(bench.profiles).toEqual([
      {
        id: "codex-gpt52",
        label: "Codex / GPT-5.2",
        factors: { harness: "codex", model: "gpt-5.2", layers: [] },
      },
      {
        id: "codex-gpt52-skills",
        label: "Codex / GPT-5.2 / skills",
        factors: {
          harness: "codex",
          model: "gpt-5.2",
          layers: [{ kind: "skill-library", id: "engineering-skills", runtime: "codex", capabilities: ["skills"] }],
        },
      },
    ]);
    expect(bench.models).toEqual(["codex-gpt52", "codex-gpt52-skills"]);
    expect(bench.baselineProfileId).toBe("codex-gpt52");
    expect(bench.averages).toEqual({ "codex-gpt52": 70, "codex-gpt52-skills": 84 });
    expect(bench.averageDeltas).toEqual({ "codex-gpt52-skills": 14 });
    expect(bench.entries[0]?.deltas).toEqual({ "codex-gpt52-skills": 14 });
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
    expect(lines.some((l) => l.includes("Profile Comparison: small"))).toBe(true);
    expect(lines.some((l) => l.includes("claude-sonnet") && l.includes("gpt-4o"))).toBe(true);
    expect(lines.some((l) => l.includes("todo-cli/ts") && l.includes("82") && l.includes("74"))).toBe(true);
    expect(lines.some((l) => l.includes("+8"))).toBe(true);
  });

  it("prints baseline deltas as treatment minus baseline", () => {
    const controlProfile: ExecutionProfile = {
      id: "codex-gpt52",
      label: "Codex / GPT-5.2",
      agent: { harness: "codex", model: "gpt-5.2" },
      factors: { harness: "codex", model: "gpt-5.2", layers: [] },
    };
    const skillsProfile: ExecutionProfile = {
      id: "codex-gpt52-skills",
      label: "Codex / GPT-5.2 / skills",
      agent: { harness: "codex", model: "gpt-5.2" },
      factors: {
        harness: "codex",
        model: "gpt-5.2",
        layers: [{ kind: "skill-library", id: "engineering-skills" }],
      },
    };
    const bench = createProfileBenchReport(
      "engineering-maturity",
      "bench-skills",
      [
        {
          profile: controlProfile,
          report: makeSuiteForModel("codex-gpt52", [{ trial: "bugfix", variant: "default", overall: 70 }]),
        },
        {
          profile: skillsProfile,
          report: makeSuiteForModel("codex-gpt52-skills", [{ trial: "bugfix", variant: "default", overall: 84 }]),
        },
      ],
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:20:00Z",
      "codex-gpt52",
    );

    const lines = captureOutput(bench);
    expect(lines.some((l) => l.includes("bugfix/default") && l.includes("+14"))).toBe(true);
    expect(lines.some((l) => l.includes("average") && l.includes("+14"))).toBe(true);
  });

  it("prints single model without delta column", () => {
    const suiteA = makeSuiteForModel("model-a", [{ trial: "todo-cli", variant: "ts", overall: 85 }]);

    const bench = createBenchReport("small", "bench-011", new Map([["model-a", suiteA]]), "2026-01-01T00:00:00Z");
    const lines = captureOutput(bench);
    expect(lines.some((l) => l.includes("delta"))).toBe(false);
    expect(lines.some((l) => l.includes("85"))).toBe(true);
  });
});
