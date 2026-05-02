import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { registerHarness } from "../src/lib/eval/harnesses/index.js";
import type { AgentHarness } from "../src/lib/eval/harnesses/types.js";
import { runEval } from "../src/lib/eval/runner.js";

function makeHarness(id: string, events: string[]): AgentHarness {
  return {
    id,
    prepare(ctx) {
      events.push("harness.prepare");
      expect(fs.existsSync(path.join(ctx.workDir, "scaffold.txt"))).toBe(true);
      expect(fs.existsSync(path.join(ctx.workDir, "layer.txt"))).toBe(true);
    },
    buildWorkerCommand() {
      events.push("harness.build");
      return { command: process.execPath, args: ["-e", ""] };
    },
    ingestWorkerSession(ctx) {
      return {
        toolCalls: [],
        fileWrites: [],
        pluginEvents: [],
        rawLines: ctx.rawLines,
        startTime: ctx.startedAt,
        endTime: ctx.endedAt,
        exitCode: ctx.exitCode,
        tokenUsage: { input: 0, output: 0 },
        parseWarnings: 0,
      };
    },
    cleanup() {
      events.push("harness.cleanup");
    },
  };
}

describe("runEval", () => {
  it("runs workdir preparation after scaffold copy and before harness prepare", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-runner-"));
    const trialDir = path.join(tmpDir, "trial");
    const scaffoldDir = path.join(trialDir, "scaffold");
    const workDir = path.join(tmpDir, "work");
    const events: string[] = [];
    const harnessId = `runner-lifecycle-${Date.now()}`;
    const unregister = registerHarness(makeHarness(harnessId, events));

    try {
      fs.mkdirSync(scaffoldDir, { recursive: true });
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(path.join(scaffoldDir, "scaffold.txt"), "from scaffold");

      const result = await runEval({
        trialDir,
        workDir,
        prompt: "Do the task",
        extensionPath: "/unused.ts",
        agent: { harness: harnessId },
        timeoutMs: 5_000,
        inactivityMs: 5_000,
        prepareWorkDir(preparedWorkDir) {
          events.push("prepareWorkDir");
          expect(fs.existsSync(path.join(preparedWorkDir, "scaffold.txt"))).toBe(true);
          fs.writeFileSync(path.join(preparedWorkDir, "layer.txt"), "from profile layer");
        },
      });

      expect(result.status).toBe("completed");
      expect(events).toEqual(["prepareWorkDir", "harness.prepare", "harness.build", "harness.cleanup"]);
    } finally {
      unregister();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("cleans up harness state when prepare fails", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-runner-"));
    const trialDir = path.join(tmpDir, "trial");
    const workDir = path.join(tmpDir, "work");
    const events: string[] = [];
    const harnessId = `runner-prepare-failure-${Date.now()}`;
    const unregister = registerHarness({
      ...makeHarness(harnessId, events),
      prepare() {
        events.push("harness.prepare");
        throw new Error("prepare failed");
      },
    });

    try {
      fs.mkdirSync(trialDir, { recursive: true });
      fs.mkdirSync(workDir, { recursive: true });

      await expect(
        runEval({
          trialDir,
          workDir,
          prompt: "Do the task",
          extensionPath: "/unused.ts",
          agent: { harness: harnessId },
          timeoutMs: 5_000,
          inactivityMs: 5_000,
        }),
      ).rejects.toThrow(/prepare failed/);
      expect(events).toEqual(["harness.prepare", "harness.cleanup"]);
    } finally {
      unregister();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
