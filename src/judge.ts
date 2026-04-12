import { spawn } from "node:child_process";
import type { JudgeResult } from "./types.js";

export interface JudgeOptions {
  workDir: string;
  prompt: string;
  timeoutMs?: number;
}

function parseJudgeResponse(output: string): JudgeResult | undefined {
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return undefined;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
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

export async function runJudge(opts: JudgeOptions): Promise<JudgeResult | undefined> {
  const args = ["-p", "--mode", "json", "--no-extensions", "--no-session"];
  args.push(opts.prompt);

  const timeout = opts.timeoutMs ?? 120_000;

  return new Promise<JudgeResult | undefined>((resolve) => {
    const proc = spawn("pi", args, {
      cwd: opts.workDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let settled = false;

    function finish(result: JudgeResult | undefined) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("close", () => {
      const assistantText = extractAssistantText(stdout);
      finish(parseJudgeResponse(assistantText) ?? parseJudgeResponse(stdout));
    });

    proc.on("error", () => finish(undefined));

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      finish(undefined);
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
    } catch {}
  }
  return parts.join("\n");
}
