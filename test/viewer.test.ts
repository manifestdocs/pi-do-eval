import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import { describe, expect, it } from "vitest";

function loadViewer() {
  const source = fs.readFileSync(path.join(import.meta.dirname, "../src/viewer.js"), "utf-8");
  const context = {
    console,
    window: { Alpine: { data() {} } },
    document: { addEventListener() {} },
    EventSource: function EventSource() {},
    Chart: function Chart() {},
    fetch: async () => {
      throw new Error("fetch not implemented in test");
    },
    setInterval,
    clearInterval,
  };

  vm.runInNewContext(source, context);
  const createEvalViewer = context.createEvalViewer;
  if (typeof createEvalViewer !== "function") {
    throw new Error("createEvalViewer was not defined");
  }
  return createEvalViewer();
}

describe("viewer validation", () => {
  it("accepts current-schema run reports", () => {
    const viewer = loadViewer();
    expect(
      viewer._isValidRunReport({
        meta: { trial: "todo", variant: "ts" },
        scores: { deterministic: { quality: 80 }, overall: 80, issues: [] },
        findings: [],
      }),
    ).toBe(true);
  });

  it("rejects reports missing meta or scores", () => {
    const viewer = loadViewer();
    expect(viewer._isValidRunReport({ meta: null, scores: null })).toBe(false);
    expect(viewer._isValidRunReport(null)).toBe(false);
  });

  it("normalizes old significant severity to clear", () => {
    const viewer = loadViewer();
    const comparison = {
      hardRegressionCount: 0,
      significantRegressionCount: 2,
      driftCount: 0,
      entries: [{ severity: "significant", trial: "todo", variant: "ts" }],
    };
    viewer._normalizeComparison(comparison);
    expect(comparison.clearRegressionCount).toBe(2);
    expect(comparison.significantRegressionCount).toBeUndefined();
    expect(comparison.entries[0].severity).toBe("clear");
  });
});
