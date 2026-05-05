import { type ChildProcess, type StdioOptions, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { probeDoEvalWeb } from "../src/lib/server/web-probe.js";

export type WebServerState = "disabled" | "ready" | "starting" | "unavailable";

export interface WebServerHandle {
  url: string;
  state: WebServerState;
  child?: ChildProcess;
  error?: string;
}

const packageDir = path.resolve(import.meta.dirname, "..");
const buildEntry = path.join(packageDir, "build", "index.js");

export async function ensureBuild(stdio: StdioOptions = "inherit"): Promise<void> {
  if (fs.existsSync(buildEntry)) return;

  const build = spawn("bun", ["run", "build"], {
    cwd: packageDir,
    stdio,
    env: { ...process.env },
  });
  const code = await new Promise<number | null>((resolve) => build.on("exit", resolve));
  if (code !== 0 || !fs.existsSync(buildEntry)) {
    throw new Error(`Failed to build web viewer${code === null ? "" : ` (exit ${code})`}`);
  }
}

export function startUiServerForeground(port: number): void {
  const server = spawn("bun", [buildEntry], {
    cwd: packageDir,
    stdio: "inherit",
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
  });
  server.on("exit", (code) => process.exit(code ?? 0));
  console.log(`Eval viewer: http://localhost:${port}`);
}

export function startUiDevServerForeground(host: string, port: number): void {
  const server = spawn("npm", ["run", "dev", "--", "--host", host, "--port", String(port)], {
    cwd: packageDir,
    stdio: "inherit",
    env: { ...process.env },
  });
  server.on("exit", (code) => process.exit(code ?? 0));
  console.log(`Eval viewer dev server: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
}

export async function startUiServerForTui(port: number): Promise<WebServerHandle> {
  const url = `http://localhost:${port}`;
  const existing = await probeDoEvalWeb(url);
  if (existing.ok) return { url, state: "ready" };

  try {
    await ensureBuild("ignore");
  } catch (error) {
    return { url, state: "unavailable", error: error instanceof Error ? error.message : "Failed to build web viewer" };
  }

  const child = spawn("bun", [buildEntry], {
    cwd: packageDir,
    stdio: "ignore",
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
  });

  return { url, state: "starting", child };
}
