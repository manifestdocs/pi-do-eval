import { derived, get, writable } from "svelte/store";

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

    applyRegistry((await resp.json()) as ProjectRegistryResponse);
  } catch (error) {
    projectsError.set(error instanceof Error ? error.message : "Failed to load projects");
  } finally {
    projectsLoading.set(false);
  }
}

export async function addProject(projectPath: string): Promise<void> {
  await withProjectMutation(async () => {
    const resp = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath }),
    });

    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "Failed to add project");
    }

    applyRegistry((await resp.json()) as ProjectRegistryResponse);
  });
}

export async function selectActiveProject(projectId: string): Promise<void> {
  await withProjectMutation(async () => {
    const resp = await fetch("/api/projects/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });

    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "Failed to select project");
    }

    applyRegistry((await resp.json()) as ProjectRegistryResponse);
  });
}

export async function removeProject(projectId: string): Promise<void> {
  await withProjectMutation(async () => {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "Failed to remove project");
    }

    applyRegistry((await resp.json()) as ProjectRegistryResponse);
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
