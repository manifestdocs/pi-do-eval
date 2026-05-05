import { describe, expect, it } from "vitest";
import {
  benchIndexCodec,
  evalReportCodec,
  launcherConfigCodec,
  partialTrialMetaCodec,
  projectRegistryCodec,
  runRequestCodec,
  suiteDefinitionCodec,
  trialMetaCodec,
} from "../src/lib/contracts/domain.js";

describe("contract codecs", () => {
  it("parses valid run request variants and rejects illegal combinations", () => {
    expect(runRequestCodec.parse({ type: "trial", trial: "a", variant: "default" })).toEqual({
      ok: true,
      value: { type: "trial", trial: "a", variant: "default" },
      issues: [],
    });
    expect(runRequestCodec.parse({ type: "suite", suite: "smoke", noJudge: true }).ok).toBe(true);
    expect(runRequestCodec.parse({ type: "trial", trial: "a" }).ok).toBe(false);
    expect(runRequestCodec.parse({ type: "bench" }).ok).toBe(false);
  });

  it("preserves optional benchmark profile metadata in bench indexes", () => {
    const parsed = benchIndexCodec.parse([
      {
        suite: "smoke",
        benchRunId: "bench-1",
        dir: "bench-1-smoke",
        completedAt: "2026-01-01T00:00:00Z",
        profiles: [
          {
            id: "baseline",
            label: "Baseline",
            factors: { harness: "codex", model: "gpt-5.4", layers: [] },
          },
          {
            id: "layered",
            label: "Layered",
            factors: {
              harness: "codex",
              model: "gpt-5.4",
              layers: [{ id: "quality-layer", kind: "skill-library", runtime: "codex" }],
            },
          },
        ],
        baselineProfileId: "baseline",
        models: ["baseline", "layered"],
        averages: { baseline: 70, layered: 84 },
        averageDeltas: { layered: 14 },
      },
    ]);

    expect(parsed.ok).toBe(true);
    expect(parsed.value[0]?.profiles?.[1]?.factors.layers[0]?.id).toBe("quality-layer");
    expect(parsed.value[0]?.baselineProfileId).toBe("baseline");
    expect(parsed.value[0]?.averageDeltas).toEqual({ layered: 14 });
  });

  it("preserves launcher bench definitions", () => {
    const parsed = launcherConfigCodec.parse({
      trials: [{ name: "example", description: "Example", variants: ["default"], enabled: true }],
      suites: { smoke: [{ trial: "example", variant: "default" }] },
      suiteDefs: [{ name: "smoke", trials: [{ trial: "example", variant: "default" }], source: "file" }],
      benchDefs: [
        {
          name: "smoke",
          profiles: ["baseline", "treatment"],
          baseline: "baseline",
          epochs: 2,
          trialCount: 1,
        },
      ],
      models: [],
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.value.benchDefs?.[0]).toEqual({
      name: "smoke",
      profiles: ["baseline", "treatment"],
      baseline: "baseline",
      epochs: 2,
      trialCount: 1,
    });
  });

  it("normalizes project registries and drops invalid entries", () => {
    const parsed = projectRegistryCodec.parse({
      activeProjectId: "missing",
      projects: [
        {
          id: "p1",
          name: "One",
          projectRoot: "/repo",
          evalDir: "/repo/eval",
          addedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          lastSelectedAt: "2026-01-02T00:00:00Z",
        },
        { id: "broken" },
      ],
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.value.projects).toHaveLength(1);
    expect(parsed.value.activeProjectId).toBe("p1");
  });

  it("validates and normalizes suite definition trial refs", () => {
    const parsed = suiteDefinitionCodec.parse({
      name: "smoke",
      trials: ["example", { trial: "other", variant: "edge" }],
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.value?.trials).toEqual([
      { trial: "example", variant: "default" },
      { trial: "other", variant: "edge" },
    ]);
    expect(suiteDefinitionCodec.parse({ name: "smoke", trials: [{ trial: "example" }] }).ok).toBe(false);
  });

  it("serializes default suite trial refs as strings", () => {
    expect(
      suiteDefinitionCodec.serialize({
        name: "smoke",
        trials: [
          { trial: "example", variant: "default" },
          { trial: "other", variant: "edge" },
        ],
      }),
    ).toEqual({ name: "smoke", trials: ["example", { trial: "other", variant: "edge" }] });
  });

  it("keeps tolerant trial meta loading separate from strict route meta parsing", () => {
    expect(trialMetaCodec.parse({ tags: ["ok", 1], enabled: "yes" }).value).toEqual({ tags: ["ok"] });
    expect(partialTrialMetaCodec.parse({ tags: ["ok", 1] }).ok).toBe(false);
  });

  it("preserves the report's judgeResult so the run detail UI can render judge reasoning", () => {
    const baseReport = {
      meta: {
        trial: "trial-a",
        variant: "default",
        workerModel: "codex",
        startedAt: "2026-04-30T22:52:08Z",
        durationMs: 73000,
        status: "completed",
        verifyPassed: true,
        agentSnapshot: { worker: { provider: "openai", model: "gpt-5.4" } },
        environment: { nodeVersion: "v25", platform: "darwin", runtime: "node/v25" },
      },
      scores: { deterministic: { verification: 100 }, overall: 84, issues: [] },
      session: {
        toolCalls: [],
        fileWrites: [],
        pluginEvents: [],
        startTime: 0,
        endTime: 0,
        tokenUsage: { input: 0, output: 0 },
        parseWarnings: 0,
      },
      findings: [],
      judgeResult: {
        scores: { engineering_maturity: 74, simplicity: 91 },
        reasons: { engineering_maturity: "Scoped change with targeted tests.", simplicity: "Clear control flow." },
        findings: ["Sparse arrays slip past validation"],
      },
    };

    const parsed = evalReportCodec.parse(baseReport);
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.value?.judgeResult).toEqual(baseReport.judgeResult);
  });

  it("treats reports without a judgeResult as valid (judge is optional)", () => {
    const parsed = evalReportCodec.parse({
      meta: {
        trial: "trial-b",
        variant: "default",
        workerModel: "codex",
        startedAt: "2026-04-30T22:00:00Z",
        durationMs: 50000,
        status: "completed",
        verifyPassed: true,
        agentSnapshot: { worker: { provider: "openai", model: "gpt-5.4" } },
        environment: { nodeVersion: "v25", platform: "darwin", runtime: "node/v25" },
      },
      scores: { deterministic: { verification: 100 }, overall: 100, issues: [] },
      session: {
        toolCalls: [],
        fileWrites: [],
        pluginEvents: [],
        startTime: 0,
        endTime: 0,
        tokenUsage: { input: 0, output: 0 },
        parseWarnings: 0,
      },
      findings: [],
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.judgeResult).toBeUndefined();
  });
});
