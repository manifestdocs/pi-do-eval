import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn();
}

let nextChild: FakeChildProcess | null = null;

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    nextChild ??= new FakeChildProcess();
    const child = nextChild;
    nextChild = null;
    return child;
  }),
}));

import { finalizeJudgeOutcome, findBalancedJsonObjects, parseJudgeResponse, runJudge } from "../src/lib/eval/judge.js";

beforeEach(() => {
  nextChild = null;
  vi.useRealTimers();
});

describe("findBalancedJsonObjects", () => {
  it("extracts nested objects without breaking on braces inside strings", () => {
    const input = [
      'draft: {"ignored": true}',
      "```json",
      '{"quality": 91, "quality_reason": "brace } still in string", "metadata": {"nested": {"ok": true}}, "findings": ["minor"]}',
      "```",
    ].join("\n");

    expect(findBalancedJsonObjects(input)).toEqual([
      '{"ignored": true}',
      '{"quality": 91, "quality_reason": "brace } still in string", "metadata": {"nested": {"ok": true}}, "findings": ["minor"]}',
    ]);
  });
});

describe("parseJudgeResponse", () => {
  it("parses the last valid JSON object from noisy output", () => {
    const input = [
      'draft: {"version": 1}',
      "```json",
      '{"quality": 87, "quality_reason": "brace } inside string", "metadata": {"nested": true}, "findings": ["minor typo"]}',
      "```",
    ].join("\n");

    expect(parseJudgeResponse(input)).toEqual({
      scores: { quality: 87 },
      reasons: { quality: "brace } inside string" },
      findings: ["minor typo"],
    });
  });

  it("returns undefined when no score fields are present", () => {
    expect(parseJudgeResponse('{"metadata":{"nested":true},"findings":["x"]}')).toBeUndefined();
  });
});

describe("finalizeJudgeOutcome", () => {
  it("returns a parsed result for valid assistant JSONL output", () => {
    const output = [
      '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"draft {\\"scratch\\":true}\\n{\\"quality\\":82,\\"quality_reason\\":\\"clear\\",\\"findings\\":[\\"ok\\"]}"}]}}',
    ].join("\n");

    expect(finalizeJudgeOutcome(output)).toEqual({
      ok: true,
      result: {
        scores: { quality: 82 },
        reasons: { quality: "clear" },
        findings: ["ok"],
      },
    });
  });

  it("preserves raw stdout on parse failures", () => {
    const output = [
      '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"not json"}]}}',
    ].join("\n");

    expect(finalizeJudgeOutcome(output)).toEqual({
      ok: false,
      reason: "parse_error",
      stdout: output,
    });
  });
});

describe("runJudge", () => {
  it("includes captured stdout when the judge times out", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    nextChild = child;

    const outcomePromise = runJudge({
      workDir: "/tmp/work",
      prompt: "Judge this",
      timeoutMs: 1000,
    });

    child.stdout.write(
      '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"partial output"}]}}\n',
    );
    await vi.advanceTimersByTimeAsync(1000);

    await expect(outcomePromise).resolves.toEqual({
      ok: false,
      reason: "timeout",
      stdout: '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"partial output"}]}}\n',
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
