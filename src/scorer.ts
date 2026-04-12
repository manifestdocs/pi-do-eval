import type { EvalPlugin, EvalScores, EvalSession, JudgeResult, VerifyResult } from "./types.js";

interface ScoreContext {
  session: EvalSession;
  verify: VerifyResult;
  plugin: EvalPlugin;
  judgeResult?: JudgeResult;
}

export function scoreSession(ctx: ScoreContext): EvalScores {
  const pluginResult = ctx.plugin.scoreSession(ctx.session, ctx.verify);
  const deterministic: Record<string, number> = { ...pluginResult.scores };
  const weights: Record<string, number> = { ...pluginResult.weights };

  let judge: Record<string, number> | undefined;
  if (ctx.judgeResult) {
    judge = { ...ctx.judgeResult.scores };
    for (const key of Object.keys(judge)) {
      if (!(key in weights)) weights[key] = 0.1;
    }
  }

  const allScores = { ...deterministic, ...judge };
  let weightSum = 0;
  let weightedTotal = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const score = allScores[key];
    if (score !== undefined) {
      weightedTotal += score * weight;
      weightSum += weight;
    }
  }
  const overall = weightSum > 0 ? Math.round(weightedTotal / weightSum) : 0;

  return { deterministic, judge, overall };
}
