import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileWritesFromDiff } from "../ingest/diff-file-writes.js";
import type { EvalSession, PluginEvent, ToolCallRecord } from "../types.js";
import type { AgentHarness, SessionIngestContext, WorkerCommandContext } from "./types.js";

interface CodexEvent {
  type?: string;
  timestamp?: string | number;
  item?: unknown;
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    input?: number;
    output?: number;
  };
}

export const codexHarness: AgentHarness = {
  id: "codex",
  requiresFileSnapshot: true,

  prepare(ctx) {
    const codexHome = resolveEffectiveCodexHome(ctx.workDir, ctx.agent);
    const homeEnv = resolveHomeEnv(ctx.workDir, ctx.agent, codexHome);
    prepareCodexHome(ctx.workDir, ctx.agent, codexHome);

    for (const marketplace of ctx.agent?.codex?.pluginMarketplaces ?? []) {
      const result = spawnSync("codex", ["plugin", "marketplace", "add", normalizeMarketplaceSource(marketplace)], {
        env: {
          ...process.env,
          ...ctx.agent?.env,
          ...ctx.agent?.codex?.env,
          ...(homeEnv ? { HOME: homeEnv } : {}),
          ...(codexHome ? { CODEX_HOME: codexHome } : {}),
        },
        encoding: "utf-8",
      });
      if (result.status !== 0) {
        const message = result.stderr || result.stdout || `codex plugin marketplace add ${marketplace} failed`;
        throw new Error(message.trim());
      }
    }
  },

  buildWorkerCommand(ctx: WorkerCommandContext) {
    const codexHome = resolveEffectiveCodexHome(ctx.workDir, ctx.agent);
    const homeEnv = resolveHomeEnv(ctx.workDir, ctx.agent, codexHome);
    const args = [
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--cd",
      ctx.workDir,
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "--ephemeral",
    ];
    const model = ctx.agent?.model ?? ctx.model;
    const profile = ctx.agent?.codex?.profile;
    if (model) args.push("--model", model);
    if (profile) args.push("--profile", profile);
    if (ctx.agent?.codex?.ignoreUserConfig) args.push("--ignore-user-config");
    args.push(...(ctx.agent?.args ?? []), ...(ctx.agent?.codex?.extraArgs ?? []), ctx.prompt);

    return {
      command: "codex",
      args,
      env: {
        ...ctx.agent?.env,
        ...ctx.agent?.codex?.env,
        CODEX_THREAD_ID: undefined,
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: undefined,
        CODEX_SHELL: undefined,
        ...(homeEnv ? { HOME: homeEnv } : {}),
        ...(codexHome ? { CODEX_HOME: codexHome } : {}),
      },
    };
  },

  ingestWorkerSession(ctx) {
    return parseCodexSession(ctx);
  },

  cleanup(ctx) {
    cleanupCodexHome(ctx.workDir, ctx.agent);
  },
};

function resolveEffectiveCodexHome(workDir: string, agent: WorkerCommandContext["agent"]): string | undefined {
  const home = agent?.codex?.home;
  const isolateHome = agent?.codex?.isolateHome;
  if (home && isolateHome) {
    throw new Error("codex.home and codex.isolateHome cannot both be set");
  }
  if (home) return resolveCodexHome(home);
  if (isolateHome) return isolatedCodexHomeForWorkDir(workDir);
  return undefined;
}

function prepareCodexHome(workDir: string, agent: WorkerCommandContext["agent"], codexHome: string | undefined): void {
  if (!codexHome) return;
  if (agent?.codex?.home) {
    if (!fs.existsSync(path.join(codexHome, "auth.json"))) {
      throw new Error(
        `Codex home ${codexHome} is not authenticated. Run codex login with CODEX_HOME=${codexHome}, or omit codex.home to use the default authenticated Codex home.`,
      );
    }
    return;
  }

  if (!agent?.codex?.isolateHome) return;
  const sourceAuth = path.join(resolveCodexAuthHome(agent), "auth.json");
  if (!fs.existsSync(sourceAuth)) {
    throw new Error(
      `Cannot create isolated Codex home for ${workDir}: missing auth.json at ${sourceAuth}. Set codex.authHome to an authenticated Codex home.`,
    );
  }
  fs.rmSync(codexHome, { recursive: true, force: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.copyFileSync(sourceAuth, path.join(codexHome, "auth.json"));
}

function cleanupCodexHome(workDir: string, agent: WorkerCommandContext["agent"]): void {
  if (!agent?.codex?.isolateHome || agent.codex.home) return;
  fs.rmSync(isolatedCodexHomeForWorkDir(workDir), { recursive: true, force: true });
}

function resolveHomeEnv(
  workDir: string,
  agent: WorkerCommandContext["agent"],
  codexHome: string | undefined,
): string | undefined {
  if (!agent?.codex?.isolateHome || agent.codex.home) return undefined;
  return codexHome ?? isolatedCodexHomeForWorkDir(workDir);
}

function resolveCodexAuthHome(agent: WorkerCommandContext["agent"]): string {
  if (agent?.codex?.authHome) return resolveCodexHome(agent.codex.authHome);
  if (process.env.CODEX_HOME) return resolveCodexHome(process.env.CODEX_HOME);
  return path.join(os.homedir(), ".codex");
}

export function parseCodexSession(ctx: SessionIngestContext): EvalSession {
  const entries: CodexEvent[] = [];
  let parseWarnings = 0;
  for (const line of ctx.rawLines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as CodexEvent);
    } catch {
      parseWarnings++;
    }
  }

  const toolCalls: ToolCallRecord[] = [];
  const callsById = new Map<string, ToolCallRecord>();
  const pluginEvents: PluginEvent[] = [];
  let startTime = ctx.startedAt;
  let endTime = ctx.endedAt;
  let input = 0;
  let output = 0;
  let modelInfo: { model: string; provider: string } | undefined;

  for (const entry of entries) {
    const ts = timestampOf(entry) ?? 0;
    if (ts > 0) {
      if (!startTime || ts < startTime) startTime = ts;
      if (ts > endTime) endTime = ts;
    }

    if (entry.usage) {
      input += entry.usage.input_tokens ?? entry.usage.input ?? 0;
      output += entry.usage.output_tokens ?? entry.usage.output ?? 0;
    }

    const discoveredModel = findModelInfo(entry);
    if (discoveredModel && !modelInfo) modelInfo = discoveredModel;

    const call = findCodexToolCall(entry) ?? findToolCall(entry);
    if (call) {
      const record: ToolCallRecord = {
        timestamp: ts || ctx.startedAt,
        name: call.name,
        arguments: call.arguments,
        resultText: "",
        wasBlocked: false,
      };
      toolCalls.push(record);
      if (call.id) callsById.set(call.id, record);
    }

    const result = findCodexToolResult(entry) ?? findToolResult(entry);
    if (result) {
      const record = result.id ? callsById.get(result.id) : findLastUnfilledCall(toolCalls, result.name);
      if (record && !record.resultText) record.resultText = result.text;
      if (ctx.plugin?.parseEvent) {
        pluginEvents.push(
          ...ctx.plugin.parseEvent(result.name ?? record?.name ?? "", result.text, ts || ctx.startedAt),
        );
      }
    }
  }

  const fileWrites = fileWritesFromDiff(ctx.beforeFiles, ctx.afterFiles, ctx.plugin);

  return {
    toolCalls,
    fileWrites,
    pluginEvents,
    rawLines: ctx.rawLines,
    startTime: startTime || ctx.startedAt,
    endTime: endTime || ctx.endedAt,
    exitCode: ctx.exitCode,
    tokenUsage: { input, output },
    modelInfo,
    parseWarnings,
  };
}

function timestampOf(entry: CodexEvent): number | undefined {
  if (typeof entry.timestamp === "number") return entry.timestamp;
  if (typeof entry.timestamp === "string") return new Date(entry.timestamp).getTime();
  return undefined;
}

function resolveCodexHome(home: string): string {
  return path.resolve(home);
}

function isolatedCodexHomeForWorkDir(workDir: string): string {
  const resolvedWorkDir = path.resolve(workDir);
  const digest = createHash("sha256").update(resolvedWorkDir).digest("hex").slice(0, 16);
  const basename = path.basename(resolvedWorkDir).replace(/[^a-zA-Z0-9._-]+/g, "-") || "workdir";
  return path.join(os.tmpdir(), "do-eval-codex-home", `${basename}-${digest}`);
}

function normalizeMarketplaceSource(source: string): string {
  if (path.basename(source) === "marketplace.json") return path.dirname(source);
  return source;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function findCodexToolCall(
  entry: CodexEvent,
): { id?: string; name: string; arguments: Record<string, unknown> } | undefined {
  const item = asRecord(entry.item);
  if (!item || entry.type !== "item.started") return undefined;
  if (item.type !== "command_execution" || typeof item.command !== "string") return undefined;
  return {
    ...(typeof item.id === "string" ? { id: item.id } : {}),
    name: "command_execution",
    arguments: { command: item.command },
  };
}

function findCodexToolResult(entry: CodexEvent): { id?: string; name?: string; text: string } | undefined {
  const item = asRecord(entry.item);
  if (!item || entry.type !== "item.completed") return undefined;
  if (item.type !== "command_execution" || typeof item.aggregated_output !== "string") return undefined;
  return {
    ...(typeof item.id === "string" ? { id: item.id } : {}),
    name: "command_execution",
    text: item.aggregated_output,
  };
}

function findModelInfo(value: unknown): { model: string; provider: string } | undefined {
  const object = asRecord(value);
  if (!object) return undefined;
  const model = object.model;
  const provider = object.provider;
  if (typeof model === "string" && typeof provider === "string") return { model, provider };
  for (const child of Object.values(object)) {
    const found = findModelInfo(child);
    if (found) return found;
  }
  return undefined;
}

function findToolCall(value: unknown): { id?: string; name: string; arguments: Record<string, unknown> } | undefined {
  const object = asRecord(value);
  if (!object) return undefined;

  const type = typeof object.type === "string" ? object.type : "";
  const name = object.name ?? object.tool_name ?? object.toolName;
  if (
    typeof name === "string" &&
    (type.includes("tool_call") || type.includes("function_call") || object.arguments !== undefined)
  ) {
    const rawArgs = object.arguments ?? object.args ?? object.input;
    return {
      ...(typeof object.id === "string" ? { id: object.id } : {}),
      name,
      arguments: normalizeArguments(rawArgs),
    };
  }

  for (const child of Object.values(object)) {
    const found = findToolCall(child);
    if (found) return found;
  }
  return undefined;
}

function findToolResult(value: unknown): { id?: string; name?: string; text: string } | undefined {
  const object = asRecord(value);
  if (!object) return undefined;

  const type = typeof object.type === "string" ? object.type : "";
  const text = object.result ?? object.output ?? object.content ?? object.text;
  if ((type.includes("tool_result") || type.includes("function_result")) && typeof text === "string") {
    return {
      ...(typeof object.id === "string" ? { id: object.id } : {}),
      ...(typeof object.name === "string" ? { name: object.name } : {}),
      text,
    };
  }

  for (const child of Object.values(object)) {
    const found = findToolResult(child);
    if (found) return found;
  }
  return undefined;
}

function normalizeArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return asRecord(parsed) ?? {};
    } catch {
      return { value };
    }
  }
  return asRecord(value) ?? {};
}

function findLastUnfilledCall(toolCalls: ToolCallRecord[], name?: string): ToolCallRecord | undefined {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const call = toolCalls[i];
    if (!call) continue;
    if ((!name || call.name === name) && !call.resultText) return call;
  }
  return undefined;
}
