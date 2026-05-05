import * as fs from "node:fs";
import * as path from "node:path";
import { captureEnvironment } from "./environment.js";
import { resolveHarness } from "./harnesses/index.js";
import type { AgentRuntimeConfig } from "./harnesses/types.js";
import { runProcessWithTimeouts } from "./process.js";
import { updateRunIndex } from "./reporter.js";
import type { AgentSnapshot, EvalEvent, EvalMeta, EvalPlugin, EvalSession, SandboxOptions } from "./types.js";

export interface LiveOptions {
  runDir: string;
  runsDir: string;
  intervalMs?: number;
  emitCompletion?: boolean;
  meta: Pick<EvalMeta, "trial" | "variant" | "suite" | "suiteRunId" | "epoch" | "totalEpochs" | "runId"> & {
    workerModel?: string;
    agentSnapshot?: AgentSnapshot;
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
  agent?: AgentRuntimeConfig;
  sandbox?: boolean | SandboxOptions;
  prepareWorkDir?: (workDir: string) => void | Promise<void>;
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
  const harness = resolveHarness(opts.agent?.harness ?? "pi");

  let liveInterval: ReturnType<typeof setInterval> | undefined;
  let sessionStream: fs.WriteStream | undefined;

  try {
    const scaffoldDir = path.join(opts.trialDir, "scaffold");
    if (fs.existsSync(scaffoldDir)) {
      copyDirSync(scaffoldDir, opts.workDir);
    }

    await opts.prepareWorkDir?.(opts.workDir);
    await harness.prepare?.({ workDir: opts.workDir, agent: opts.agent });

    const lines: string[] = [];
    const beforeFiles = harness.requiresFileSnapshot ? listFiles(opts.workDir) : undefined;

    const live = opts.live;

    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const environment = captureEnvironment();

    if (live) {
      fs.mkdirSync(live.runDir, { recursive: true });
      fs.writeFileSync(
        path.join(live.runDir, "status.json"),
        JSON.stringify({ status: "running", startedAt, environment, ...live.meta }),
      );
      sessionStream = fs.createWriteStream(path.join(live.runDir, "session.jsonl"), { flags: "a" });
      updateRunIndex(live.runsDir, live.emit);
      live.emit?.({
        type: "run_started",
        timestamp: Date.now(),
        dir: path.basename(live.runDir),
        runsDir: live.runsDir,
        trial: live.meta.trial,
        variant: live.meta.variant,
        suite: live.meta.suite,
        suiteRunId: live.meta.suiteRunId,
        workerModel: live.meta.workerModel,
      });
    }

    function ingestSnapshot(exitCode: number | null, endedAt: number): EvalSession {
      return harness.ingestWorkerSession({
        rawLines: lines,
        stderr: "",
        plugin: opts.plugin,
        exitCode,
        status: "completed",
        startedAt: startMs,
        endedAt,
        beforeFiles,
        afterFiles: harness.requiresFileSnapshot ? listFiles(opts.workDir) : undefined,
      });
    }

    function writeLiveSnapshot() {
      if (!live) return;
      const session = ingestSnapshot(null, Date.now());
      const snapshot = {
        meta: {
          ...live.meta,
          startedAt,
          status: "running",
          durationMs: Date.now() - startMs,
          environment,
        },
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

    const spawnSpec = harness.buildWorkerCommand({
      workDir: opts.workDir,
      prompt: opts.prompt,
      extensionPath: opts.extensionPath,
      provider: opts.provider,
      model: opts.model,
      thinking: opts.thinking,
      agent: opts.agent,
    });

    if (live) {
      liveInterval = setInterval(writeLiveSnapshot, live.intervalMs ?? 2000);
    }

    const result = await runProcessWithTimeouts({
      spawnSpec,
      workDir: opts.workDir,
      timeoutMs: timeout,
      inactivityMs: inactivity,
      sandbox: opts.sandbox,
      onStdoutLine(line) {
        lines.push(line);
        sessionStream?.write(`${line}\n`);
      },
    });

    if (liveInterval) {
      clearInterval(liveInterval);
      liveInterval = undefined;
    }
    sessionStream?.end();
    sessionStream = undefined;

    const session = harness.ingestWorkerSession({
      rawLines: lines,
      stderr: result.stderr,
      plugin: opts.plugin,
      exitCode: result.exitCode,
      status: result.status,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      beforeFiles,
      afterFiles: harness.requiresFileSnapshot ? listFiles(opts.workDir) : undefined,
    });

    if (live) {
      writeLiveSnapshot();
      updateRunIndex(live.runsDir, live.emit);
      if (live.emitCompletion !== false) {
        live.emit?.({
          type: "run_completed",
          timestamp: Date.now(),
          dir: path.basename(live.runDir),
          status: result.status,
          durationMs: Date.now() - startMs,
        });
      }
    }

    return { session, status: result.status, exitCode: result.exitCode, stderr: result.stderr, workDir: opts.workDir };
  } finally {
    if (liveInterval) clearInterval(liveInterval);
    sessionStream?.end();
    await harness.cleanup?.({ workDir: opts.workDir, agent: opts.agent });
  }
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

function listFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!fs.existsSync(root)) return files;
  collectFiles(root, root, files);
  return files;
}

function collectFiles(root: string, current: string, files: Map<string, string>) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (entry.isDirectory()) {
      collectFiles(root, fullPath, files);
    } else if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      files.set(relativePath, `${stat.size}:${stat.mtimeMs}`);
    }
  }
}
