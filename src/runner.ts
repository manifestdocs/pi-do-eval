import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSessionLines } from "./parser.js";
import type { EvalSession } from "./types.js";

export interface RunOptions {
  projectDir: string;
  workDir: string;
  prompt: string;
  piTddPath: string;
  provider?: string;
  model?: string;
  timeoutMs?: number;
  inactivityMs?: number;
}

export interface RunResult {
  session: EvalSession;
  status: "completed" | "timeout" | "crashed" | "stalled";
  exitCode: number | null;
  stderr: string;
  workDir: string;
}

const DEFAULT_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const DEFAULT_INACTIVITY = 2 * 60 * 1000; // 2 minutes

export async function runEval(opts: RunOptions): Promise<RunResult> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const inactivity = opts.inactivityMs ?? DEFAULT_INACTIVITY;

  // Copy scaffold files if they exist
  const scaffoldDir = path.join(opts.projectDir, "scaffold");
  if (fs.existsSync(scaffoldDir)) {
    copyDirSync(scaffoldDir, opts.workDir);
  }

  // Copy PRD
  const prdSrc = path.join(opts.projectDir, "PRD.md");
  if (fs.existsSync(prdSrc)) {
    fs.copyFileSync(prdSrc, path.join(opts.workDir, "PRD.md"));
  }

  // Build pi command
  const args = ["-p", "--mode", "json", "-e", opts.piTddPath, "--no-session"];
  if (opts.provider) args.push("--provider", opts.provider);
  if (opts.model) args.push("--model", opts.model);
  args.push(opts.prompt);

  const lines: string[] = [];
  let stderr = "";
  let lastActivity = Date.now();

  return new Promise<RunResult>((resolve) => {
    const proc = spawn("pi", args, {
      cwd: opts.workDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    function finish(status: RunResult["status"], code: number | null) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearInterval(idleCheck);
      const session = parseSessionLines(lines);
      session.exitCode = code;
      resolve({ session, status, exitCode: code, stderr, workDir: opts.workDir });
    }

    // Buffer stdout lines
    let buffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      lastActivity = Date.now();
      buffer += chunk.toString();
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim()) lines.push(line);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      lastActivity = Date.now();
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      // Flush remaining buffer
      if (buffer.trim()) lines.push(buffer);
      finish("completed", code);
    });

    proc.on("error", () => {
      finish("crashed", null);
    });

    // Hard timeout
    const hardTimer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000);
      finish("timeout", null);
    }, timeout);

    // Inactivity check
    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivity > inactivity) {
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5000);
        finish("stalled", null);
      }
    }, 10_000);
  });
}

function copyDirSync(src: string, dest: string) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
