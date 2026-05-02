import { get, writable } from "svelte/store";
import type { LauncherConfig, RunRequest } from "$eval/types.js";
import { launcherActionResponseCodec, launcherConfigCodec } from "$lib/contracts/domain.js";
import { readJson } from "./api.js";
import { activeProjectId, projectApiPath } from "./projects.js";
import { resetCurrentReports } from "./runs.js";
import { setAutoSelect } from "./sse.js";

export const launcherConfig = writable<LauncherConfig | null>(null);
export const launcherBusy = writable(false);
/**
 * Populated when `loadLauncherConfig` fails — typically when `eval.config.ts`
 * or a trial.yaml fails to parse. The viewer surfaces this so users see the
 * file path and reason instead of a blank launcher panel.
 */
export const launcherError = writable<string | null>(null);

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
    const result = await readJson(resp, launcherActionResponseCodec, "Failed to start run");
    if (!result.ok) {
      return { ok: false, error: result.error ?? "Failed to start run" };
    }

    resetCurrentReports();
    const config = get(launcherConfig);
    const modelLabel =
      request.type === "bench"
        ? undefined
        : (request.model ?? (config?.defaultWorker ? formatModel(config.defaultWorker) : "agent default"));
    setAutoSelect({
      id: result.id ?? "pending",
      type: request.type,
      suite: request.type === "suite" || request.type === "bench" ? request.suite : undefined,
      trial: request.type === "trial" ? request.trial : undefined,
      variant: request.type === "trial" ? request.variant : undefined,
      modelLabel,
      startedAt: new Date().toISOString(),
    });
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
    launcherError.set(null);
    return;
  }

  let nextConfig: LauncherConfig | null = null;
  let nextError: string | null = null;
  try {
    const resp = await fetch(url);
    if (resp.ok) {
      nextConfig = await readJson(resp, launcherConfigCodec, "Invalid launcher config");
    } else {
      // 5xx from getProjectRuntime → eval.config.ts or trial.yaml is malformed.
      // 404 ("Launcher not configured") is the expected empty state, not an error.
      try {
        const body = (await resp.json()) as { error?: string };
        if (resp.status >= 500 && body.error) nextError = body.error;
      } catch {
        if (resp.status >= 500) nextError = `Failed to load launcher (HTTP ${resp.status})`;
      }
    }
  } catch (error) {
    nextError = error instanceof Error ? error.message : "Failed to reach launcher";
  }

  if (projectId === get(activeProjectId)) {
    launcherConfig.set(nextConfig);
    launcherError.set(nextError);
  }
}

export function resetLauncherConfig(): void {
  launcherConfig.set(null);
  launcherError.set(null);
}
