import type { LauncherConfig } from "$eval/types.js";

let cachedConfig: LauncherConfig | null = null;
let cachedRunCommand: string | null = null;
let cachedRunsDir: string | null = null;

export function setServerConfig(config: LauncherConfig, runCommand: string, runsDir: string): void {
  cachedConfig = config;
  cachedRunCommand = runCommand;
  cachedRunsDir = runsDir;

  // Persist to env so SvelteKit server hooks can read it in the same process
  process.env.EVAL_LAUNCHER_CONFIG = JSON.stringify(config);
  process.env.EVAL_RUN_COMMAND = runCommand;
  process.env.EVAL_RUNS_DIR = runsDir;
}

export function getLauncherConfig(): LauncherConfig | null {
  if (cachedConfig) return cachedConfig;

  // Try loading from env (set by consumer's eval.ts view command)
  const envConfig = process.env.EVAL_LAUNCHER_CONFIG;
  if (envConfig) {
    try {
      cachedConfig = JSON.parse(envConfig) as LauncherConfig;
      return cachedConfig;
    } catch {
      return null;
    }
  }
  return null;
}

export function getRunCommand(): string | null {
  return cachedRunCommand ?? process.env.EVAL_RUN_COMMAND ?? null;
}

export function getRunsDir(): string {
  return cachedRunsDir ?? process.env.EVAL_RUNS_DIR ?? ".";
}
