import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSessionLines } from "./parser.js";
import { updateRunIndex } from "./reporter.js";
import { assertSandboxAvailable, buildSandboxedCommand } from "./sandbox.js";
import type { EvalEvent, EvalMeta, EvalPlugin, EvalSession, SandboxOptions } from "./types.js";

export interface LiveOptions {
  runDir: string;
  runsDir: string;
  intervalMs?: number;
  meta: Pick<EvalMeta, "trial" | "variant" | "suite" | "suiteRunId" | "epoch" | "totalEpochs"> & {
    workerModel?: string;
  };
  emit?: (event: EvalEvent) => void;
}

export interface RunOptions {
  trialDir: string;
  workDir: string;
  prompt: string;
  extensionPath: string;
  timeoutMs?: number;
  inactivityMs?: number;
  live?: LiveOptions;
  plugin?: EvalPlugin;
  provider?: string;
  model?: string;
  thinking?: string;
  sandbox?: boolean | SandboxOptions;
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
  const scaffoldDir = path.join(opts.trialDir, "scaffold");
  if (fs.existsSync(scaffoldDir)) {
    copyDirSync(scaffoldDir, opts.workDir);
  }

  // Build pi command
  const args = ["-p", "--mode", "json", "--no-extensions", "-e", opts.extensionPath, "--no-session"];
  if (opts.provider) args.push("--provider", opts.provider);
  if (opts.model) args.push("--model", opts.model);
  if (opts.thinking) args.push("--thinking", opts.thinking);
  args.push(opts.prompt);

  const lines: string[] = [];
  let stderr = "";
  let lastActivity = Date.now();

  // Live mode setup
  const live = opts.live;
  let liveInterval: ReturnType<typeof setInterval> | undefined;
  let sessionStream: fs.WriteStream | undefined;

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  if (live) {
    fs.mkdirSync(live.runDir, { recursive: true });
    fs.writeFileSync(
      path.join(live.runDir, "status.json"),
      JSON.stringify({ status: "running", startedAt, ...live.meta }),
    );
    sessionStream = fs.createWriteStream(path.join(live.runDir, "session.jsonl"), { flags: "a" });
    updateRunIndex(live.runsDir, live.emit);
    live.emit?.({
      type: "run_started",
      timestamp: Date.now(),
      dir: path.basename(live.runDir),
      trial: live.meta.trial,
      variant: live.meta.variant,
      suite: live.meta.suite,
      suiteRunId: live.meta.suiteRunId,
      workerModel: live.meta.workerModel,
    });
  }

  function writeLiveSnapshot() {
    if (!live) return;
    const session = parseSessionLines(lines, opts.plugin);
    const snapshot = {
      meta: { ...live.meta, startedAt, status: "running", durationMs: Date.now() - startMs },
      session: { ...session, rawLines: undefined },
      lastUpdated: Date.now(),
    };
    const tmpPath = path.join(live.runDir, "live.json.tmp");
    fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmpPath, path.join(live.runDir, "live.json"));
    live.emit?.({
      type: "run_progress",
      timestamp: Date.now(),
      dir: path.basename(live.runDir),
      durationMs: Date.now() - startMs,
      toolCount: session.toolCalls.length,
      fileCount: session.fileWrites.length,
    });
  }

  return new Promise<RunResult>((resolve) => {
    assertSandboxAvailable(opts.sandbox);
    let command = "pi";
    let spawnArgs = args;
    if (opts.sandbox) {
      const sandboxOpts = opts.sandbox === true ? undefined : opts.sandbox;
      ({ command, args: spawnArgs } = buildSandboxedCommand("pi", args, {
        workDir: opts.workDir,
        workDirAccess: "rw",
        options: sandboxOpts,
      }));
    }

    const proc = spawn(command, spawnArgs, {
      cwd: opts.workDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (live) {
      liveInterval = setInterval(writeLiveSnapshot, live.intervalMs ?? 2000);
    }

    let settled = false;
    function finish(status: RunResult["status"], code: number | null) {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearInterval(idleCheck);
      if (liveInterval) clearInterval(liveInterval);
      sessionStream?.end();
      const session = parseSessionLines(lines, opts.plugin);
      session.exitCode = code;
      if (live) {
        writeLiveSnapshot();
        updateRunIndex(live.runsDir, live.emit);
        live.emit?.({
          type: "run_completed",
          timestamp: Date.now(),
          dir: path.basename(live.runDir),
          status,
          durationMs: Date.now() - startMs,
        });
      }
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
        if (line.trim()) {
          lines.push(line);
          sessionStream?.write(`${line}\n`);
        }
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
