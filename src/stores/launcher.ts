import { get, writable } from "svelte/store";
import type { LauncherConfig } from "$eval/types.js";
import { activeProjectId, projectApiPath } from "./projects.js";

export const launcherConfig = writable<LauncherConfig | null>(null);

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
