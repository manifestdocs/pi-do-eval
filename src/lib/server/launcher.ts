import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LauncherConfig, RunRequest } from "$eval/types.js";
import { parseJsonWith } from "$lib/contracts/codec.js";
import { activeRunsRegistryCodec } from "$lib/contracts/domain.js";

interface ActiveRun {
  id: string;
  projectId: string;
  process: ChildProcess;
  command: string;
  startedAt: string;
  runDir: string;
  forceKillTimer?: ReturnType<typeof setTimeout>;
}

export interface PersistedActiveRun {
  id: string;
  projectId: string;
  pid: number;
  command: string;
  startedAt: string;
  runDir: string;
}

const ACTIVE_RUNS_FILE = "active-runs.json";
const activeRuns = new Map<string, ActiveRun>();

function getConfigRoot(): string {
  return process.env.PI_DO_EVAL_CONFIG_HOME ?? process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}

export function getActiveRunsRegistryPath(): string {
  return path.join(getConfigRoot(), "pi-do-eval", ACTIVE_RUNS_FILE);
}

function loadActiveRunsRegistry(): Record<string, PersistedActiveRun> {
  const registryPath = getActiveRunsRegistryPath();
  if (!fs.existsSync(registryPath)) return {};
  try {
    const parsed = parseJsonWith(fs.readFileSync(registryPath, "utf-8"), registryPath, activeRunsRegistryCodec);
    return parsed.ok ? parsed.value : {};
  } catch {
    return {};
  }
}

function saveActiveRunsRegistry(registry: Record<string, PersistedActiveRun>): void {
  const registryPath = getActiveRunsRegistryPath();
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(activeRunsRegistryCodec.serialize(registry), null, 2));
}

function persistActiveRun(run: ActiveRun): void {
  const registry = loadActiveRunsRegistry();
  registry[run.projectId] = {
    id: run.id,
    projectId: run.projectId,
    pid: run.process.pid ?? -1,
    command: run.command,
    startedAt: run.startedAt,
    runDir: run.runDir,
  };
  saveActiveRunsRegistry(registry);
}

function clearPersistedActiveRun(projectId: string): void {
  const registry = loadActiveRunsRegistry();
  if (!registry[projectId]) return;
  delete registry[projectId];
  saveActiveRunsRegistry(registry);
}

function clearActiveRun(projectId: string, runId?: string, activeRun = activeRuns.get(projectId)): void {
  if (!activeRun) return;
  if (runId && activeRun.id !== runId) return;
  if (activeRun.forceKillTimer) {
    clearTimeout(activeRun.forceKillTimer);
  }
  activeRuns.delete(projectId);
  clearPersistedActiveRun(projectId);
}

export function resetLauncherState(): void {
  for (const activeRun of activeRuns.values()) {
    if (activeRun.forceKillTimer) {
      clearTimeout(activeRun.forceKillTimer);
    }
  }
  activeRuns.clear();
  const registryPath = getActiveRunsRegistryPath();
  if (fs.existsSync(registryPath)) {
    fs.rmSync(registryPath, { force: true });
  }
}

export function recoverActiveRuns(): void {
  const registry = loadActiveRunsRegistry();
  let changed = false;

  for (const [projectId, run] of Object.entries(registry)) {
    try {
      process.kill(run.pid, 0);
    } catch {
      delete registry[projectId];
      changed = true;
    }
  }

  if (changed) {
    saveActiveRunsRegistry(registry);
  }
}

recoverActiveRuns();

export function getRunStatus(projectId: string): { active: boolean; id?: string; command?: string } {
  const activeRun = activeRuns.get(projectId);
  if (!activeRun) return { active: false };
  return { active: true, id: activeRun.id, command: activeRun.command };
}

export function killActiveRun(projectId: string, options: { forceAfterMs?: number } = {}): void {
  const activeRun = activeRuns.get(projectId);
  if (!activeRun) return;

  activeRun.process.kill("SIGTERM");
  const forceAfterMs = options.forceAfterMs ?? 0;
  if (forceAfterMs > 0) {
    const forceKillTimer = setTimeout(() => {
      activeRun.process.kill("SIGKILL");
    }, forceAfterMs);
    activeRun.forceKillTimer = forceKillTimer;
    const clearForceKill = () => clearTimeout(forceKillTimer);
    activeRun.process.once("exit", clearForceKill);
    activeRun.process.once("error", clearForceKill);
  }
  clearPersistedActiveRun(projectId);
  activeRuns.delete(projectId);
}

function buildArgs(request: RunRequest): string[] {
  const args: string[] = [];

  if (request.type === "trial") {
    args.push("run", "--trial", request.trial, "--variant", request.variant);
  } else if (request.type === "suite") {
    args.push("run", request.suite);
  } else if (request.type === "bench") {
    args.push("bench", request.suite);
  }

  if (request.model) {
    args.push("--model", request.model);
  }
  if (request.noJudge) {
    args.push("--no-judge");
  }

  return args;
}

function validateRequest(request: RunRequest, config: LauncherConfig): string | null {
  if (request.type === "trial") {
    const trial = config.trials.find((t) => t.name === request.trial);
    if (!trial) return `Unknown trial: ${request.trial}`;
    if (!trial.variants.includes(request.variant)) {
      return `Unknown variant "${request.variant}" for trial "${request.trial}"`;
    }
  } else {
    if (!config.suites[request.suite]) {
      return `Unknown suite: ${request.suite}`;
    }
  }
  return null;
}

export function spawnRun(
  projectId: string,
  request: RunRequest,
  runCommand: string,
  cwd: string,
  config: LauncherConfig,
): { ok: true; id: string } | { ok: false; error: string } {
  const activeRun = activeRuns.get(projectId);
  if (activeRun) {
    return { ok: false, error: "A run is already active" };
  }

  const validationError = validateRequest(request, config);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const parts = runCommand.split(/\s+/);
  const cmd = parts[0];
  if (!cmd) {
    return { ok: false, error: "Launcher command is empty" };
  }
  const baseArgs = parts.slice(1);
  const runArgs = buildArgs(request);
  const allArgs = [...baseArgs, ...runArgs];

  const id = `run-${Date.now()}`;
  const command = `${runCommand} ${runArgs.join(" ")}`;
  const runDir = path.join(cwd, "runs", id);
  fs.mkdirSync(runDir, { recursive: true });

  const child = spawn(cmd, allArgs, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  const stdoutLogPath = path.join(runDir, "launcher.stdout.log");
  const stderrLogPath = path.join(runDir, "launcher.stderr.log");
  fs.writeFileSync(stdoutLogPath, "");
  fs.writeFileSync(stderrLogPath, "");
  child.stdout?.on("data", (chunk: Buffer | string) => {
    fs.appendFileSync(stdoutLogPath, chunk);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    fs.appendFileSync(stderrLogPath, chunk);
  });

  const startedAt = new Date().toISOString();
  activeRuns.set(projectId, {
    id,
    projectId,
    process: child,
    command,
    startedAt,
    runDir,
  });
  persistActiveRun({
    id,
    projectId,
    process: child,
    command,
    startedAt,
    runDir,
  });

  let finalized = false;
  const finalize = (code: number | null, error?: Error) => {
    if (finalized) return;
    finalized = true;
    const currentRun = activeRuns.get(projectId);
    if (error) {
      console.error(`Run process error for ${id}: ${error.message}`);
    } else if (code !== null && code !== 0) {
      console.error(`Run ${id} exited with code ${code}. Logs: ${runDir}`);
    }
    clearActiveRun(projectId, id, currentRun);
  };

  child.on("exit", (code) => {
    finalize(code);
  });

  child.on("error", (err) => {
    finalize(null, err);
  });

  return { ok: true, id };
}
