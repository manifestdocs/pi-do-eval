import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseProjectEvalConfig } from "../src/lib/eval/load-config.js";
import { createWorkspaceHandle } from "../src/lib/eval/workspace.js";

describe("workspace config", () => {
  it("parses the experimental agentfs-fuse provider", () => {
    const parsed = parseProjectEvalConfig({
      workspace: {
        provider: "agentfs-fuse",
        root: ".agentfs-runs",
        agentfsCommand: "/usr/local/bin/agentfs",
        mountTimeoutMs: 250,
      },
    });

    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.value.workspace).toEqual({
      provider: "agentfs-fuse",
      root: ".agentfs-runs",
      agentfsCommand: "/usr/local/bin/agentfs",
      mountTimeoutMs: 250,
    });
  });

  it("rejects unknown workspace providers", () => {
    const parsed = parseProjectEvalConfig({ workspace: { provider: "tmpfs" } });

    expect(parsed.ok).toBe(false);
    expect(parsed.issues.join("\n")).toContain('workspace.provider must be "local-fs" or "agentfs-fuse"');
  });
});

describe("bench config", () => {
  it("parses benchmark gates", () => {
    const parsed = parseProjectEvalConfig({
      benches: {
        smoke: {
          profiles: ["baseline", "withLayer"],
          baseline: "baseline",
          requireJudge: true,
          requiredDeterministicScores: {
            baseline_isolation: 100,
            abp_activation: 100,
          },
        },
      },
    });

    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.value.benches?.smoke).toEqual({
      profiles: ["baseline", "withLayer"],
      baseline: "baseline",
      requireJudge: true,
      requiredDeterministicScores: {
        baseline_isolation: 100,
        abp_activation: 100,
      },
    });
  });

  it("rejects invalid benchmark gate thresholds", () => {
    const parsed = parseProjectEvalConfig({
      benches: {
        smoke: {
          profiles: ["baseline", "withLayer"],
          requiredDeterministicScores: { abp_activation: "yes" },
        },
      },
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.issues.join("\n")).toContain(
      "benches.smoke.requiredDeterministicScores.abp_activation must be a finite number",
    );
  });
});

describe("createWorkspaceHandle", () => {
  it("creates the default local filesystem workdir", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-workspace-"));
    const runDir = path.join(tmpDir, "runs", "run-1");
    const workDir = path.join(runDir, "workdir");

    try {
      const handle = await createWorkspaceHandle(undefined, {
        evalDir: tmpDir,
        runsDir: path.join(tmpDir, "runs"),
        runId: "run-1",
        runDir,
        workDir,
        trialName: "trial",
        variantName: "default",
      });

      expect(handle.workDir).toBe(workDir);
      expect(fs.existsSync(workDir)).toBe(true);
      await handle.cleanup();
      expect(fs.existsSync(workDir)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails clearly when agentfs-fuse is selected but the command is missing", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-workspace-"));
    const runDir = path.join(tmpDir, "runs", "run-1");

    try {
      await expect(
        createWorkspaceHandle(
          { provider: "agentfs-fuse", agentfsCommand: "definitely-missing-agentfs" },
          {
            evalDir: tmpDir,
            runsDir: path.join(tmpDir, "runs"),
            runId: "run-1",
            runDir,
            workDir: path.join(runDir, "workdir"),
            trialName: "trial",
            variantName: "default",
          },
        ),
      ).rejects.toThrow(/Failed to run definitely-missing-agentfs/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
