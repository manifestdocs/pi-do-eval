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

  // First pass: aggregate `findings` strings from every parseable candidate.
  // Some judges emit findings in an early explanatory JSON object and scores
  // in a later summary object; without aggregation we would silently drop
  // the findings whenever the scores-bearing object lacks its own array.
  const aggregatedFindings: string[] = [];
  const seenFindings = new Set<string>();
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed.findings)) continue;
      for (const finding of parsed.findings) {
        if (typeof finding !== "string") continue;
        if (seenFindings.has(finding)) continue;
        seenFindings.add(finding);
        aggregatedFindings.push(finding);
      }
    } catch {
      // Skip unparseable candidates.
    }
  }

  // Second pass: return the most recent candidate with at least one score.
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
        findings: aggregatedFindings,
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
    // Keep raw stdout on success too so callers can persist it for diagnosis.
    return { ok: true, result, stdout };
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
    let stdoutBuffer = "";
    let settled = false;

    function finish(outcome: JudgeOutcome, terminate = false) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminate) proc.kill("SIGTERM");
      resolve(outcome);
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (isCompletionEvent(line)) {
          const outcome = finalizeJudgeOutcome(stdout);
          if (outcome.ok) {
            finish(outcome, true);
            return;
          }
        }
      }
    });

    proc.stderr.on("data", () => {
      // Drain stderr so a noisy judge process cannot block on an unread pipe.
    });

    proc.on("close", () => finish(finalizeJudgeOutcome(stdout)));

    proc.on("error", () => finish({ ok: false, reason: "crash", ...(stdout ? { stdout } : {}) }));

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      finish({ ok: false, reason: "timeout", ...(stdout ? { stdout } : {}) });
    }, timeout);
  });
}

function isCompletionEvent(line: string): boolean {
  try {
    const event = JSON.parse(line);
    if (event.type === "agent_end" || event.type === "turn_end") return true;
    if (event.type !== "message_end") return false;
    return event.message?.role === "assistant";
  } catch {
    return false;
  }
}

function extractAssistantText(jsonlOutput: string): string {
  const parts: string[] = [];
  let fallbackParts: string[] = [];
  for (const line of jsonlOutput.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const message = event.message ?? event.assistantMessageEvent?.partial;
      if ((event.type === "message_end" || event.type === "message") && message?.role === "assistant") {
        for (const block of message.content ?? []) {
          if (block.type === "text" && block.text) parts.push(block.text);
        }
      } else if (event.type === "message_update" && message?.role === "assistant") {
        const textBlocks: string[] = [];
        for (const block of message.content ?? []) {
          if (block.type === "text" && block.text) textBlocks.push(block.text);
        }
        if (textBlocks.length > 0) fallbackParts = textBlocks;
      }
    } catch {
      // Non-JSON lines in JSONL output are expected (e.g. startup banners)
    }
  }
  return (parts.length > 0 ? parts : fallbackParts).join("\n");
}
