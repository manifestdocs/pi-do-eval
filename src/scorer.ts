import type { EvalPlugin, EvalScores, EvalSession, JudgeResult, VerifyResult } from "./types.js";

interface ScoreContext {
  session: EvalSession;
  verify: VerifyResult;
  plugin: EvalPlugin;
  judgeResult?: JudgeResult;
}

const DEFAULT_JUDGE_WEIGHT = 0.1;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeScores(
  channel: "Deterministic" | "Judge",
  scores: Record<string, number>,
  issues: string[],
): Record<string, number> {
  const valid: Record<string, number> = {};

  for (const [key, value] of Object.entries(scores)) {
    if (!isFiniteNumber(value)) {
      issues.push(`${channel} score "${key}" must be a finite number.`);
      continue;
    }
    if (value < 0 || value > 100) {
      issues.push(`${channel} score "${key}" must be between 0 and 100.`);
      continue;
    }
    valid[key] = value;
  }

  return valid;
}

function sanitizeWeights(
  channel: "Deterministic" | "Judge",
  weights: Record<string, number>,
  issues: string[],
): Record<string, number> {
  const valid: Record<string, number> = {};

  for (const [key, value] of Object.entries(weights)) {
    if (!isFiniteNumber(value)) {
      issues.push(`${channel} weight "${key}" must be a finite number.`);
      continue;
    }
    if (value < 0) {
      issues.push(`${channel} weight "${key}" must be non-negative.`);
      continue;
    }
    valid[key] = value;
  }

  return valid;
}

export function scoreSession(ctx: ScoreContext): EvalScores {
  const pluginResult = ctx.plugin.scoreSession(ctx.session, ctx.verify);
  const issues: string[] = [];

  const deterministic = sanitizeScores("Deterministic", pluginResult.scores, issues);
  const deterministicWeights = sanitizeWeights("Deterministic", pluginResult.weights, issues);

  const judgeConfig = pluginResult.judge;
  const judgeDefaultWeightRaw = judgeConfig?.defaultWeight ?? DEFAULT_JUDGE_WEIGHT;
  const judgeDefaultWeight =
    isFiniteNumber(judgeDefaultWeightRaw) && judgeDefaultWeightRaw >= 0 ? judgeDefaultWeightRaw : DEFAULT_JUDGE_WEIGHT;
  if (!isFiniteNumber(judgeDefaultWeightRaw) || judgeDefaultWeightRaw < 0) {
    issues.push(`Judge default weight must be a finite non-negative number; using ${DEFAULT_JUDGE_WEIGHT}.`);
  }

  const judge = ctx.judgeResult ? sanitizeScores("Judge", ctx.judgeResult.scores, issues) : undefined;
  const judgeWeights = sanitizeWeights("Judge", judgeConfig?.weights ?? {}, issues);

  for (const key of Object.keys(deterministicWeights)) {
    if (!(key in deterministic)) {
      issues.push(`Deterministic weight "${key}" has no matching deterministic score and will be ignored.`);
    }
  }

  if (judge) {
    for (const key of Object.keys(judgeWeights)) {
      if (!(key in judge)) {
        issues.push(`Judge weight "${key}" has no matching judge score and will be ignored.`);
      }
    }

    for (const key of Object.keys(judge)) {
      if (key in deterministic) {
        issues.push(
          `Judge score "${key}" duplicates a deterministic metric name; it will be reported separately and excluded from overall.`,
        );
      }
    }
  }

  let weightSum = 0;
  let weightedTotal = 0;

  for (const [key, weight] of Object.entries(deterministicWeights)) {
    const score = deterministic[key];
    if (score === undefined) continue;
    weightedTotal += score * weight;
    weightSum += weight;
  }

  if (judge && judgeConfig?.includeInOverall !== false) {
    for (const [key, score] of Object.entries(judge)) {
      if (key in deterministic) continue;
      const weight = judgeWeights[key] ?? judgeDefaultWeight;
      weightedTotal += score * weight;
      weightSum += weight;
    }
  }

  const overall = weightSum > 0 ? Math.round(weightedTotal / weightSum) : 0;

  return {
    deterministic,
    ...(judge && Object.keys(judge).length > 0 ? { judge } : {}),
    overall,
    issues,
  };
}
