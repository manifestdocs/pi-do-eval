import { describe, expect, it } from "vitest";
import { scoreSession } from "../src/scorer.js";
import type { EvalPlugin, EvalSession, JudgeResult, VerifyResult } from "../src/types.js";

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

function makePlugin(scores: Record<string, number>, weights: Record<string, number>): EvalPlugin {
  return {
    name: "test",
    extensionPath: "",
    scoreSession: () => ({ scores, weights, findings: [] }),
    buildJudgePrompt: () => "",
  };
}

describe("scoreSession", () => {
  it("computes weighted average of deterministic scores", () => {
    const plugin = makePlugin({ quality: 80, coverage: 60 }, { quality: 0.7, coverage: 0.3 });
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin });

    expect(result.deterministic).toEqual({ quality: 80, coverage: 60 });
    expect(result.judge).toBeUndefined();
    // (80*0.7 + 60*0.3) / (0.7+0.3) = 74
    expect(result.overall).toBe(74);
  });

  it("includes judge scores with default 0.1 weight", () => {
    const plugin = makePlugin({ quality: 80 }, { quality: 0.9 });
    const judgeResult: JudgeResult = {
      scores: { readability: 70 },
      reasons: { readability: "clear code" },
      findings: [],
    };
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin, judgeResult });

    expect(result.judge).toEqual({ readability: 70 });
    // (80*0.9 + 70*0.1) / (0.9+0.1) = 79
    expect(result.overall).toBe(79);
  });

  it("uses explicit weight for judge score if plugin provides it", () => {
    const plugin = makePlugin({ quality: 80 }, { quality: 0.5, readability: 0.5 });
    const judgeResult: JudgeResult = {
      scores: { readability: 60 },
      reasons: {},
      findings: [],
    };
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin, judgeResult });

    // (80*0.5 + 60*0.5) / (0.5+0.5) = 70
    expect(result.overall).toBe(70);
  });

  it("returns 0 when no scores have weights", () => {
    const plugin = makePlugin({}, {});
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin });

    expect(result.overall).toBe(0);
  });

  it("ignores scores without matching weights", () => {
    const plugin = makePlugin({ quality: 100, unweighted: 50 }, { quality: 1.0 });
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin });

    // only quality is weighted, so overall = 100
    expect(result.overall).toBe(100);
  });

  it("rounds the overall score", () => {
    const plugin = makePlugin({ a: 33, b: 67 }, { a: 0.5, b: 0.5 });
    const result = scoreSession({ session: stubSession, verify: stubVerify, plugin });

    // (33*0.5 + 67*0.5) / 1.0 = 50
    expect(result.overall).toBe(50);
  });
});
