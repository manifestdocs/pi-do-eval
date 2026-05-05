import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkspaceConfig } from "./types.js";

export interface WorkspaceContext {
  evalDir: string;
  runsDir: string;
  runId: string;
  runDir: string;
  workDir: string;
  trialName: string;
  variantName: string;
}

export interface WorkspaceHandle {
  workDir: string;
  cleanup(): Promise<void>;
}

export async function createWorkspaceHandle(
  config: WorkspaceConfig | undefined,
  ctx: WorkspaceContext,
): Promise<WorkspaceHandle> {
  const provider = config?.provider ?? "local-fs";
  if (provider === "local-fs") return createLocalWorkspace(ctx);
  if (provider === "agentfs-fuse") return createAgentFsFuseWorkspace(config ?? { provider }, ctx);
  const unreachable: never = provider;
  throw new Error(`Unsupported workspace provider: ${unreachable}`);
}

function createLocalWorkspace(ctx: WorkspaceContext): WorkspaceHandle {
  fs.mkdirSync(ctx.workDir, { recursive: true });
  return {
    workDir: ctx.workDir,
    async cleanup() {
      // The local workspace is part of the run artifact and intentionally persists.
    },
  };
}

async function createAgentFsFuseWorkspace(config: WorkspaceConfig, ctx: WorkspaceContext): Promise<WorkspaceHandle> {
  const command = config.agentfsCommand ?? "agentfs";
  const root = path.resolve(ctx.evalDir, config.root ?? path.join(ctx.runsDir, ".agentfs-workspaces"));
  const agentId = workspaceAgentId(ctx);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(ctx.workDir, { recursive: true });

  runAgentFs(command, ["init", agentId], root);
  const mountProcess = spawn(command, ["mount", agentId, ctx.workDir], {
    cwd: root,
    stdio: "ignore",
    detached: true,
  });
  mountProcess.unref();
  await waitForMountStartup(mountProcess, config.mountTimeoutMs ?? 1_000);

  return {
    workDir: ctx.workDir,
    async cleanup() {
      unmountWorkspace(ctx.workDir);
      stopMountProcess(mountProcess);
    },
  };
}

function runAgentFs(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf-8" });
  if (result.error) {
    throw new Error(`Failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    throw new Error(`${command} ${args.join(" ")} failed${details ? `: ${details}` : ""}`);
  }
}

function waitForMountStartup(proc: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    proc.once("error", (error) => finish(error));
    proc.once("exit", (code) => {
      if (code === 0) finish();
      else finish(new Error(`agentfs mount exited with status ${code ?? "unknown"}`));
    });
  });
}

function unmountWorkspace(workDir: string): void {
  const umount = spawnSync("umount", [workDir], { encoding: "utf-8" });
  if (umount.status === 0) return;
  const fuseUnmount = spawnSync("fusermount3", ["-u", workDir], { encoding: "utf-8" });
  if (fuseUnmount.status !== 0 && fuseUnmount.error && fuseUnmount.error.message !== "spawnSync fusermount3 ENOENT") {
    throw fuseUnmount.error;
  }
}

function stopMountProcess(proc: ChildProcess): void {
  if (!proc.pid || proc.killed) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    try {
      process.kill(proc.pid, "SIGTERM");
    } catch {
      // The mount command may daemonize or exit after registering the mount.
    }
  }
}

function workspaceAgentId(ctx: WorkspaceContext): string {
  return [ctx.trialName, ctx.variantName, ctx.runId].map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, "-")).join("-");
}
