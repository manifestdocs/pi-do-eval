import { describe, expect, it } from "vitest";
import { scoreSession } from "../src/scorer.js";
import type { EvalPlugin, EvalSession, JudgeResult, PluginScoreResult, VerifyResult } from "../src/types.js";

const stubSession: EvalSession = {
  toolCalls: [],
  fileWrites: [],
  pluginEvents: [],
  rawLines: [],
  startTime: 0,
  endTime: 0,
  exitCode: null,
  tokenUsage: { input: 0, output: 0 },
  parseWarnings: 0,
};

const stubVerify: VerifyResult = { passed: true, output: "", metrics: {} };

function makePlugin(result: PluginScoreResult): EvalPlugin {
  return {
    name: "test",
    extensionPath: "",
    scoreSession: () => result,
    buildJudgePrompt: () => "",
  };
}

describe("scoreSession", () => {
  it("computes weighted average of deterministic scores", () => {
    const plugin = makePlugin({
      scores: { quality: 80, coverage: 60 },
      weights: { quality: 0.7, coverage: 0.3 },
      findings: [],
    });
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin });

    expect(result.deterministic).toEqual({ quality: 80, coverage: 60 });
    expect(result.judge).toBeUndefined();
    expect(result.overall).toBe(74);
    expect(result.issues).toEqual([]);
  });

  it("includes judge scores with the default low weight", () => {
    const plugin = makePlugin({
      scores: { quality: 80 },
      weights: { quality: 0.9 },
      findings: [],
    });
    const judgeResult: JudgeResult = {
      scores: { readability: 70 },
      reasons: { readability: "clear code" },
      findings: [],
    };
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin, judgeResult });

    expect(result.judge).toEqual({ readability: 70 });
    expect(result.overall).toBe(79);
    expect(result.issues).toEqual([]);
  });

  it("uses explicit judge weights when provided by the plugin", () => {
    const plugin = makePlugin({
      scores: { quality: 80 },
      weights: { quality: 0.5 },
      findings: [],
      judge: { weights: { readability: 0.5 } },
    });
    const judgeResult: JudgeResult = {
      scores: { readability: 60 },
      reasons: {},
      findings: [],
    };
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin, judgeResult });

    expect(result.overall).toBe(70);
    expect(result.issues).toEqual([]);
  });

  it("can exclude judge scores from the overall while still reporting them", () => {
    const plugin = makePlugin({
      scores: { quality: 80 },
      weights: { quality: 1.0 },
      findings: [],
      judge: { includeInOverall: false },
    });
    const judgeResult: JudgeResult = {
      scores: { readability: 10 },
      reasons: {},
      findings: [],
    };
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin, judgeResult });

    expect(result.judge).toEqual({ readability: 10 });
    expect(result.overall).toBe(80);
  });

  it("keeps deterministic and judge metrics separate when names collide", () => {
    const plugin = makePlugin({
      scores: { quality: 80 },
      weights: { quality: 1.0 },
      findings: [],
    });
    const judgeResult: JudgeResult = {
      scores: { quality: 20 },
      reasons: {},
      findings: [],
    };
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin, judgeResult });

    expect(result.deterministic).toEqual({ quality: 80 });
    expect(result.judge).toEqual({ quality: 20 });
    expect(result.overall).toBe(80);
    expect(result.issues).toContain(
      'Judge score "quality" duplicates a deterministic metric name; it will be reported separately and excluded from overall.',
    );
  });

  it("returns 0 when no scores have weights", () => {
    const plugin = makePlugin({ scores: {}, weights: {}, findings: [] });
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin });

    expect(result.overall).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("ignores deterministic scores without matching weights", () => {
    const plugin = makePlugin({
      scores: { quality: 100, unweighted: 50 },
      weights: { quality: 1.0 },
      findings: [],
    });
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin });

    expect(result.overall).toBe(100);
    expect(result.issues).toEqual([]);
  });

  it("reports invalid scores and weights instead of using them", () => {
    const plugin = makePlugin({
      scores: { quality: 120 },
      weights: { quality: -1, missing: 0.2 },
      findings: [],
      judge: { defaultWeight: -0.5 },
    });
    const judgeResult: JudgeResult = {
      scores: { readability: Number.POSITIVE_INFINITY },
      reasons: {},
      findings: [],
    };
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin, judgeResult });

    expect(result.deterministic).toEqual({});
    expect(result.judge).toBeUndefined();
    expect(result.overall).toBe(0);
    expect(result.issues).toEqual([
      'Deterministic score "quality" must be between 0 and 100.',
      'Deterministic weight "quality" must be non-negative.',
      "Judge default weight must be a finite non-negative number; using 0.1.",
      'Judge score "readability" must be a finite number.',
      'Deterministic weight "missing" has no matching deterministic score and will be ignored.',
    ]);
  });
});
