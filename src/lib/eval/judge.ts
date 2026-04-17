import { spawn } from "node:child_process";
import { assertSandboxAvailable, buildSandboxedCommand } from "./sandbox.js";
import type { JudgeOutcome, JudgeResult, SandboxOptions } from "./types.js";

export interface JudgeOptions {
  workDir: string;
  prompt: string;
  timeoutMs?: number;
  provider?: string;
  model?: string;
  thinking?: string;
  sandbox?: boolean | SandboxOptions;
}

export function findBalancedJsonObjects(output: string): string[] {
  const matches: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < output.length; i++) {
    const char = output[i];
    if (start === -1) {
      if (char === "{") {
        start = i;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        matches.push(output.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return matches;
}

export function parseJudgeResponse(output: string): JudgeResult | undefined {
  const candidates = findBalancedJsonObjects(output);

  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      const scores: Record<string, number> = {};
      const reasons: Record<string, string> = {};

      for (const [key, value] of Object.entries(parsed)) {
        if (key === "findings") continue;
        if (typeof value === "number") scores[key] = value;
        else if (typeof value === "string" && key.endsWith("_reason")) {
          reasons[key.replace(/_reason$/, "")] = value;
        }
      }

      if (Object.keys(scores).length === 0) continue;

      return {
        scores,
        reasons,
        findings: Array.isArray(parsed.findings)
          ? parsed.findings.filter((finding: unknown): finding is string => typeof finding === "string")
          : [],
      };
    } catch {
      // Try the next-most-recent candidate.
    }
  }

  return undefined;
}

export function finalizeJudgeOutcome(stdout: string): JudgeOutcome {
  const assistantText = extractAssistantText(stdout);
  if (!assistantText) {
    return { ok: false, reason: stdout.trim() ? "parse_error" : "empty_response", ...(stdout ? { stdout } : {}) };
  }

  const result = parseJudgeResponse(assistantText);
  if (result) {
    return { ok: true, result };
  }

  return { ok: false, reason: "parse_error", ...(stdout ? { stdout } : {}) };
}

export async function runJudge(opts: JudgeOptions): Promise<JudgeOutcome> {
  const args = ["-p", "--mode", "json", "--no-extensions", "--no-session"];
  if (opts.provider) args.push("--provider", opts.provider);
  if (opts.model) args.push("--model", opts.model);
  if (opts.thinking) args.push("--thinking", opts.thinking);
  args.push(opts.prompt);

  const timeout = opts.timeoutMs ?? 120_000;

  return new Promise<JudgeOutcome>((resolve) => {
    assertSandboxAvailable(opts.sandbox);
    let command = "pi";
    let spawnArgs = args;
    if (opts.sandbox) {
      const sandboxOpts = opts.sandbox === true ? undefined : opts.sandbox;
      ({ command, args: spawnArgs } = buildSandboxedCommand("pi", args, {
        workDir: opts.workDir,
        workDirAccess: "ro",
        options: sandboxOpts,
      }));
    }

    const proc = spawn(command, spawnArgs, {
      cwd: opts.workDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let settled = false;

    function finish(outcome: JudgeOutcome) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("close", () => finish(finalizeJudgeOutcome(stdout)));

    proc.on("error", () => finish({ ok: false, reason: "crash", ...(stdout ? { stdout } : {}) }));

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      finish({ ok: false, reason: "timeout", ...(stdout ? { stdout } : {}) });
    }, timeout);
  });
}

function extractAssistantText(jsonlOutput: string): string {
  const parts: string[] = [];
  for (const line of jsonlOutput.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if ((event.type === "message_end" || event.type === "message") && event.message?.role === "assistant") {
        for (const block of event.message.content ?? []) {
          if (block.type === "text" && block.text) parts.push(block.text);
        }
      }
    } catch {
      // Non-JSON lines in JSONL output are expected (e.g. startup banners)
    }
  }
  return parts.join("\n");
}
