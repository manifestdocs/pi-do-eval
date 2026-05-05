import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCodexSession } from "../src/lib/eval/harnesses/codex.js";
import { codexHarness, piHarness, registerHarness, resolveHarness } from "../src/lib/eval/harnesses/index.js";
import type { AgentHarness } from "../src/lib/eval/harnesses/types.js";
import type { EvalPlugin } from "../src/lib/eval/types.js";

const scoringPlugin: EvalPlugin = {
  name: "test",
  extensionPath: "/extension.ts",
  classifyFile(filePath) {
    return filePath.endsWith(".test.ts") ? "test" : "source";
  },
  scoreSession() {
    return { scores: {}, weights: {}, findings: [] };
  },
  buildJudgePrompt() {
    return "";
  },
};

describe("agent harnesses", () => {
  it("resolves Pi as the default harness", () => {
    expect(resolveHarness()).toBe(piHarness);
    expect(resolveHarness("pi")).toBe(piHarness);
  });

  it("allows callers to register and remove a custom harness", () => {
    const customHarness: AgentHarness = {
      id: "custom",
      buildWorkerCommand(ctx) {
        return {
          command: "custom-agent",
          args: [String(ctx.agent?.options?.mode ?? "default"), ctx.prompt],
        };
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
    };

    const unregister = registerHarness(customHarness);
    try {
      expect(resolveHarness("custom")).toBe(customHarness);
      expect(
        customHarness.buildWorkerCommand({
          workDir: "/tmp/work",
          prompt: "Do the task",
          extensionPath: "/unused.ts",
          agent: { harness: "custom", options: { mode: "strict" } },
        }),
      ).toEqual({ command: "custom-agent", args: ["strict", "Do the task"] });
    } finally {
      unregister();
    }
    expect(() => resolveHarness("custom")).toThrow(/Unknown agent harness/);
  });

  it("rejects duplicate harness registrations", () => {
    expect(() => registerHarness(piHarness)).toThrow(/already registered/);
  });

  it("builds the current Pi worker command", () => {
    const spec = piHarness.buildWorkerCommand({
      workDir: "/tmp/work",
      prompt: "Do the task",
      extensionPath: "/ext/index.ts",
      provider: "anthropic",
      model: "claude",
      thinking: "high",
    });

    expect(spec).toEqual({
      command: "pi",
      args: [
        "-p",
        "--mode",
        "json",
        "--no-extensions",
        "-e",
        "/ext/index.ts",
        "--no-session",
        "--provider",
        "anthropic",
        "--model",
        "claude",
        "--thinking",
        "high",
        "Do the task",
      ],
      env: {},
    });
  });

  it("builds a Codex worker command with the supported argv ordering", () => {
    const spec = codexHarness.buildWorkerCommand({
      workDir: "/tmp/work",
      prompt: "Do the task",
      extensionPath: "/unused.ts",
      model: "gpt-5.2",
      agent: {
        harness: "codex",
        codex: {
          ignoreUserConfig: true,
        },
      },
    });

    expect(spec.command).toBe("codex");
    expect(spec.args).toEqual([
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--cd",
      "/tmp/work",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "--ephemeral",
      "--model",
      "gpt-5.2",
      "--ignore-user-config",
      "Do the task",
    ]);
    expect(spec.env?.CODEX_HOME).toBeUndefined();
    expect(spec.env?.CODEX_THREAD_ID).toBeUndefined();
    expect(spec.env?.CODEX_INTERNAL_ORIGINATOR_OVERRIDE).toBeUndefined();
    expect(spec.env?.CODEX_SHELL).toBeUndefined();
  });

  it("builds an isolated Codex command without ignoring user config by default", () => {
    const workDir = path.join(os.tmpdir(), "do-eval-work");
    const spec = codexHarness.buildWorkerCommand({
      workDir,
      prompt: "Do the task",
      extensionPath: "/unused.ts",
      model: "gpt-5.2",
      agent: {
        harness: "codex",
        codex: {
          isolateHome: true,
        },
      },
    });

    expect(spec.env?.CODEX_HOME).toContain(path.join(os.tmpdir(), "do-eval-codex-home"));
    expect(spec.env?.HOME).toBe(spec.env?.CODEX_HOME);
    const relativeHome = path.relative(workDir, spec.env?.CODEX_HOME ?? "");
    expect(relativeHome.startsWith("..") || path.isAbsolute(relativeHome)).toBe(true);
    // isolateHome alone no longer forces --ignore-user-config; the per-run
    // CODEX_HOME's config.toml is loaded so layered profile setup (e.g.
    // pluginMarketplaces) can take effect. Set ignoreUserConfig: true to opt
    // back in.
    expect(spec.args).not.toContain("--ignore-user-config");
  });

  it("ignores user config when ignoreUserConfig is set alongside isolateHome", () => {
    const workDir = path.join(os.tmpdir(), "do-eval-work");
    const spec = codexHarness.buildWorkerCommand({
      workDir,
      prompt: "Do the task",
      extensionPath: "/unused.ts",
      model: "gpt-5.2",
      agent: {
        harness: "codex",
        codex: {
          isolateHome: true,
          ignoreUserConfig: true,
        },
      },
    });

    expect(spec.args).toContain("--ignore-user-config");
    expect(spec.env?.HOME).toBe(spec.env?.CODEX_HOME);
  });
});

describe("parseCodexSession", () => {
  it("extracts tool calls, results, usage, model info, and diff-based file writes", () => {
    const beforeFiles = new Map([["src/calc.ts", "3:100"]]);
    const afterFiles = new Map([
      ["src/calc.ts", "4:200"],
      ["src/calc.test.ts", "10:300"],
    ]);

    const session = parseCodexSession({
      rawLines: [
        JSON.stringify({
          type: "session.started",
          timestamp: "2026-01-01T00:00:00.000Z",
          model: "gpt",
          provider: "openai",
        }),
        JSON.stringify({
          type: "item.started",
          timestamp: "2026-01-01T00:00:01.000Z",
          item: {
            id: "call-1",
            type: "command_execution",
            command: "/bin/zsh -lc npm test",
            aggregated_output: "",
            exit_code: null,
            status: "in_progress",
          },
        }),
        JSON.stringify({
          type: "item.completed",
          timestamp: "2026-01-01T00:00:02.000Z",
          item: {
            id: "call-1",
            type: "command_execution",
            command: "/bin/zsh -lc npm test",
            aggregated_output: "ok",
            exit_code: 0,
            status: "completed",
          },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5, reasoning_output_tokens: 1 },
        }),
      ],
      stderr: "",
      plugin: scoringPlugin,
      exitCode: 0,
      status: "completed",
      startedAt: Date.parse("2026-01-01T00:00:00.000Z"),
      endedAt: Date.parse("2026-01-01T00:00:03.000Z"),
      beforeFiles,
      afterFiles,
    });

    expect(session.modelInfo).toEqual({ model: "gpt", provider: "openai" });
    expect(session.tokenUsage).toEqual({ input: 10, output: 5 });
    expect(session.toolCalls).toHaveLength(1);
    expect(session.toolCalls[0]).toMatchObject({
      name: "command_execution",
      arguments: { command: "/bin/zsh -lc npm test" },
      resultText: "ok",
    });
    expect(session.fileWrites).toEqual([
      { timestamp: 0, path: "src/calc.test.ts", tool: "write", labels: ["test"] },
      { timestamp: 0, path: "src/calc.ts", tool: "write", labels: ["source"] },
    ]);
  });

  it("rejects unauthenticated isolated Codex homes", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-codex-"));
    try {
      expect(() =>
        codexHarness.prepare?.({
          workDir: tmpDir,
          agent: { harness: "codex", codex: { home: path.join(tmpDir, ".codex-home") } },
        }),
      ).toThrow(/is not authenticated/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("copies only auth into an isolated Codex home", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-codex-"));
    const authHome = path.join(tmpDir, "source-home");
    const workDir = path.join(tmpDir, "work");
    const agent = { harness: "codex" as const, codex: { isolateHome: true, authHome } };
    try {
      fs.mkdirSync(authHome, { recursive: true });
      fs.writeFileSync(path.join(authHome, "auth.json"), "{}");
      fs.writeFileSync(path.join(authHome, "config.toml"), "model = 'gpt'");

      codexHarness.prepare?.({
        workDir,
        agent,
      });

      const isolatedHome = codexHarness.buildWorkerCommand({
        workDir,
        prompt: "Do the task",
        extensionPath: "/unused.ts",
        agent,
      }).env?.CODEX_HOME;
      if (!isolatedHome) throw new Error("Expected isolated Codex home");
      expect(path.relative(workDir, isolatedHome).startsWith("..")).toBe(true);
      expect(fs.existsSync(path.join(isolatedHome, "auth.json"))).toBe(true);
      expect(fs.existsSync(path.join(isolatedHome, "config.toml"))).toBe(false);
    } finally {
      codexHarness.cleanup?.({ workDir, agent });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("cleans up isolated Codex homes", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-codex-"));
    const authHome = path.join(tmpDir, "source-home");
    const workDir = path.join(tmpDir, "work");
    const agent = { harness: "codex" as const, codex: { isolateHome: true, authHome } };
    try {
      fs.mkdirSync(authHome, { recursive: true });
      fs.writeFileSync(path.join(authHome, "auth.json"), "{}");

      codexHarness.prepare?.({ workDir, agent });
      const isolatedHome = codexHarness.buildWorkerCommand({
        workDir,
        prompt: "Do the task",
        extensionPath: "/unused.ts",
        agent,
      }).env?.CODEX_HOME;
      if (!isolatedHome) throw new Error("Expected isolated Codex home");
      expect(fs.existsSync(path.join(isolatedHome, "auth.json"))).toBe(true);

      codexHarness.cleanup?.({ workDir, agent });
      expect(fs.existsSync(isolatedHome)).toBe(false);
    } finally {
      codexHarness.cleanup?.({ workDir, agent });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects isolated Codex homes when auth is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-codex-"));
    try {
      expect(() =>
        codexHarness.prepare?.({
          workDir: path.join(tmpDir, "work"),
          agent: { harness: "codex", codex: { isolateHome: true, authHome: path.join(tmpDir, "missing-home") } },
        }),
      ).toThrow(/missing auth\.json/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects Codex configs that set both explicit and isolated homes", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-codex-"));
    try {
      expect(() =>
        codexHarness.prepare?.({
          workDir: path.join(tmpDir, "work"),
          agent: { harness: "codex", codex: { home: path.join(tmpDir, "home"), isolateHome: true } },
        }),
      ).toThrow(/cannot both be set/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
