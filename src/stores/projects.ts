import { derived, get, writable } from "svelte/store";
import { projectRegistryCodec } from "$lib/contracts/domain.js";
import { readError, readJson } from "./api.js";

export interface ProjectSummary {
  id: string;
  name: string;
  projectRoot: string;
  evalDir: string;
  addedAt: string;
  updatedAt: string;
  lastSelectedAt: string;
}

interface ProjectRegistryResponse {
  activeProjectId: string | null;
  projects: ProjectSummary[];
}

export const projects = writable<ProjectSummary[]>([]);
export const activeProjectId = writable<string | null>(null);
export const projectsLoading = writable(false);
export const projectsBusy = writable(false);
export const projectsError = writable<string | null>(null);

export const activeProject = derived([projects, activeProjectId], ([$projects, $activeProjectId]) => {
  return $projects.find((project) => project.id === $activeProjectId) ?? null;
});

export async function loadProjects(): Promise<void> {
  projectsLoading.set(true);
  try {
    const resp = await fetch("/api/projects");
    if (!resp.ok) {
      throw new Error("Failed to load projects");
    }

    applyRegistry(await readJson(resp, projectRegistryCodec, "Failed to load projects"));
  } catch (error) {
    projectsError.set(error instanceof Error ? error.message : "Failed to load projects");
  } finally {
    projectsLoading.set(false);
  }
}

export async function addProject(projectPath: string): Promise<string | null> {
  let newProjectId: string | null = null;
  await withProjectMutation(async () => {
    const resp = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath }),
    });

    if (!resp.ok) {
      throw new Error(await readError(resp, "Failed to add project"));
    }

    const registry = await readJson(resp, projectRegistryCodec, "Failed to add project");
    newProjectId = registry.activeProjectId;
    applyRegistry(registry);
  });
  return newProjectId;
}

export async function selectActiveProject(projectId: string): Promise<void> {
  await withProjectMutation(async () => {
    const resp = await fetch("/api/projects/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });

    if (!resp.ok) {
      throw new Error(await readError(resp, "Failed to select project"));
    }

    applyRegistry(await readJson(resp, projectRegistryCodec, "Failed to select project"));
  });
}

export async function removeProject(projectId: string): Promise<void> {
  await withProjectMutation(async () => {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    if (!resp.ok) {
      throw new Error(await readError(resp, "Failed to remove project"));
    }

    applyRegistry(await readJson(resp, projectRegistryCodec, "Failed to remove project"));
  });
}

export function projectApiPath(pathname: string, projectId = get(activeProjectId)): string | null {
  if (!projectId) return null;
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `/api/projects/${encodeURIComponent(projectId)}${normalizedPath}`;
}

function applyRegistry(payload: ProjectRegistryResponse): void {
  projects.set(payload.projects ?? []);
  activeProjectId.set(payload.activeProjectId ?? null);
  projectsError.set(null);
}

async function withProjectMutation(action: () => Promise<void>): Promise<void> {
  projectsBusy.set(true);
  try {
    await action();
  } catch (error) {
    projectsError.set(error instanceof Error ? error.message : "Project update failed");
  } finally {
    projectsBusy.set(false);
  }
}
