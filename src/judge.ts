import { spawn } from "node:child_process";
import { buildSandboxedCommand } from "./sandbox.js";
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

function parseJudgeResponse(output: string): JudgeResult | undefined {
  // Match the last JSON object in the output (non-greedy would match the first/smallest;
  // we want the last one since the judge's final answer typically comes at the end)
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

    if (Object.keys(scores).length === 0) return undefined;

    return {
      scores,
      reasons,
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    };
  } catch {
    return undefined;
  }
}

export async function runJudge(opts: JudgeOptions): Promise<JudgeOutcome> {
  const args = ["-p", "--mode", "json", "--no-extensions", "--no-session"];
  if (opts.provider) args.push("--provider", opts.provider);
  if (opts.model) args.push("--model", opts.model);
  if (opts.thinking) args.push("--thinking", opts.thinking);
  args.push(opts.prompt);

  const timeout = opts.timeoutMs ?? 120_000;

  return new Promise<JudgeOutcome>((resolve) => {
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

    proc.on("close", () => {
      const assistantText = extractAssistantText(stdout);
      if (!assistantText) {
        finish({ ok: false, reason: stdout.trim() ? "parse_error" : "empty_response" });
        return;
      }
      const result = parseJudgeResponse(assistantText);
      if (result) {
        finish({ ok: true, result });
      } else {
        finish({ ok: false, reason: "parse_error" });
      }
    });

    proc.on("error", () => finish({ ok: false, reason: "crash" }));

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      finish({ ok: false, reason: "timeout" });
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
