import { get, writable } from "svelte/store";
import type { LauncherConfig, RunRequest } from "$eval/types.js";
import { activeProjectId, projectApiPath } from "./projects.js";
import { resetCurrentReports } from "./runs.js";
import { setAutoSelect } from "./sse.js";

export const launcherConfig = writable<LauncherConfig | null>(null);
export const launcherBusy = writable(false);

export interface LauncherActionResult {
  ok: boolean;
  error?: string;
}

function formatModel(m: { provider?: string; model?: string } | undefined): string {
  if (!m || (!m.provider && !m.model)) return "agent default";
  if (m.provider && m.model) return `${m.provider}/${m.model}`;
  return m.model ?? m.provider ?? "agent default";
}

export async function launchRun(request: RunRequest): Promise<LauncherActionResult> {
  const projectId = get(activeProjectId);
  const url = projectApiPath("/launcher", projectId);
  if (!url || !projectId) return { ok: false, error: "Select a project first" };

  launcherBusy.set(true);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const result = (await resp.json()) as { ok: boolean; id?: string; error?: string };
    if (!result.ok) {
      return { ok: false, error: result.error ?? "Failed to start run" };
    }

    resetCurrentReports();
    if (request.type !== "bench") {
      const config = get(launcherConfig);
      const modelLabel =
        request.model ?? (config?.defaultWorker ? formatModel(config.defaultWorker) : "agent default");
      setAutoSelect({
        id: result.id ?? "pending",
        type: request.type,
        suite: request.type === "suite" ? request.suite : undefined,
        trial: request.type === "trial" ? request.trial : undefined,
        variant: request.type === "trial" ? request.variant : undefined,
        modelLabel,
        startedAt: new Date().toISOString(),
      });
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Network error" };
  } finally {
    launcherBusy.set(false);
  }
}

export async function loadLauncherConfig(projectId = get(activeProjectId)): Promise<void> {
  const url = projectApiPath("/launcher", projectId);
  if (!url || !projectId) {
    launcherConfig.set(null);
    return;
  }

  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const config = (await resp.json()) as LauncherConfig;
      if (projectId === get(activeProjectId)) {
        launcherConfig.set(config);
      }
      return;
    }
  } catch {
    // Launcher not available
  }

  if (projectId === get(activeProjectId)) {
    launcherConfig.set(null);
  }
}

export function resetLauncherConfig(): void {
  launcherConfig.set(null);
}
