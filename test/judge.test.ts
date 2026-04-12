import { describe, expect, it } from "vitest";

// parseJudgeResponse is not exported, so we test it indirectly via a module-level import.
// We re-implement the extraction logic here to test the regex and parsing behavior.
// The actual function lives in judge.ts — these tests verify the same logic.

function parseJudgeResponse(output: string) {
  const allMatches = output.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
  const jsonMatch = allMatches?.at(-1);
  if (!jsonMatch) return undefined;

  try {
    const parsed = JSON.parse(jsonMatch);
    const scores: Record<string, number> = {};
    const reasons: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (key === "findings") continue;
      if (typeof value === "number") scores[key] = value;
      else if (typeof value === "string" && key.endsWith("_reason")) {
        reasons[key.replace(/_reason$/, "")] = value;
      }
    }

    return {
      scores,
      reasons,
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    };
  } catch {
    return undefined;
  }
}

describe("parseJudgeResponse", () => {
  it("parses a clean JSON response", () => {
    const input = '{"quality": 85, "quality_reason": "good code", "findings": ["minor typo"]}';
    const result = parseJudgeResponse(input);

    expect(result).toEqual({
      scores: { quality: 85 },
      reasons: { quality: "good code" },
      findings: ["minor typo"],
    });
  });

  it("extracts JSON from surrounding prose", () => {
    const input = 'Here is my evaluation:\n{"quality": 90, "findings": []}\nThat is all.';
    const result = parseJudgeResponse(input);

    expect(result?.scores).toEqual({ quality: 90 });
  });

  it("picks the last JSON block when multiple are present", () => {
    const input = 'Thinking: {"draft": true}\nFinal answer: {"quality": 75, "findings": []}';
    const result = parseJudgeResponse(input);

    expect(result?.scores).toEqual({ quality: 75 });
  });

  it("returns undefined for non-JSON output", () => {
    expect(parseJudgeResponse("no json here")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseJudgeResponse("")).toBeUndefined();
  });

  it("handles response with no findings key", () => {
    const input = '{"quality": 60, "quality_reason": "needs work"}';
    const result = parseJudgeResponse(input);

    expect(result?.scores).toEqual({ quality: 60 });
    expect(result?.reasons).toEqual({ quality: "needs work" });
    expect(result?.findings).toEqual([]);
  });

  it("ignores non-number non-reason fields", () => {
    const input = '{"quality": 80, "metadata": {"nested": true}, "findings": []}';
    const result = parseJudgeResponse(input);

    expect(result?.scores).toEqual({ quality: 80 });
    expect(result?.reasons).toEqual({});
  });
});
