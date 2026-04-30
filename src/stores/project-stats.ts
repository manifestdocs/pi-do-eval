import { derived, get, writable } from "svelte/store";
import type { LauncherConfig, SuiteIndexEntry } from "$eval/types.js";
import { launcherConfigCodec, suiteIndexCodec } from "$lib/contracts/domain.js";
import { computeProjectStats, type ProjectStats } from "$lib/project-stats.js";
import { readJson } from "./api.js";
import { projectApiPath, projects } from "./projects.js";

type StatsByProject = Record<string, ProjectStats>;

export const allProjectStats = writable<StatsByProject>({});
export const projectStatsLoading = writable<Record<string, boolean>>({});

export const activeProjectsWithStats = derived([projects, allProjectStats], ([$projects, $stats]) =>
  $projects.map((project) => ({
    project,
    stats: $stats[project.id] ?? null,
  })),
);

export async function loadProjectStats(projectId: string): Promise<void> {
  const launcherUrl = projectApiPath("/launcher", projectId);
  const suitesUrl = projectApiPath("/runs/suites/index.json", projectId);
  if (!launcherUrl || !suitesUrl) return;

  projectStatsLoading.update((state) => ({ ...state, [projectId]: true }));

  try {
    const [launcherResp, suitesResp] = await Promise.all([
      fetch(launcherUrl).catch(() => null),
      fetch(suitesUrl).catch(() => null),
    ]);

    const config: LauncherConfig | null = launcherResp?.ok
      ? await readJson(launcherResp, launcherConfigCodec, "Invalid launcher config")
      : null;
    const suiteIndex: SuiteIndexEntry[] = suitesResp?.ok
      ? await readJson(suitesResp, suiteIndexCodec, "Invalid suite index")
      : [];

    const stats = computeProjectStats(config, suiteIndex);
    allProjectStats.update((state) => ({ ...state, [projectId]: stats }));
  } finally {
    projectStatsLoading.update((state) => ({ ...state, [projectId]: false }));
  }
}

export async function loadAllProjectStats(): Promise<void> {
  const list = get(projects);
  await Promise.all(list.map((project) => loadProjectStats(project.id)));
}

export function resetProjectStats(): void {
  allProjectStats.set({});
  projectStatsLoading.set({});
}
