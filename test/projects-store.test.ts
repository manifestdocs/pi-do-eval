import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeProject,
  activeProjectId,
  loadProjects,
  projects,
  projectsBusy,
  projectsError,
  selectActiveProject,
} from "../src/stores/projects.js";

const registryPayload = {
  activeProjectId: "project-2",
  projects: [
    {
      id: "project-1",
      name: "alpha",
      projectRoot: "/tmp/alpha",
      evalDir: "/tmp/alpha/eval",
      addedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastSelectedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "project-2",
      name: "beta",
      projectRoot: "/tmp/beta",
      evalDir: "/tmp/beta/eval",
      addedAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      lastSelectedAt: "2026-01-02T00:00:00.000Z",
    },
  ],
};

afterEach(() => {
  projects.set([]);
  activeProjectId.set(null);
  projectsBusy.set(false);
  projectsError.set(null);
  vi.restoreAllMocks();
});

describe("project stores", () => {
  it("restores the persisted active project from the registry response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(registryPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await loadProjects();

    expect(get(activeProjectId)).toBe("project-2");
    expect(get(activeProject)?.name).toBe("beta");
    expect(get(projects).map((project) => project.id)).toEqual(["project-1", "project-2"]);
  });

  it("updates the selected project from the selection endpoint response", async () => {
    projects.set(registryPayload.projects);
    activeProjectId.set("project-1");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(registryPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await selectActiveProject("project-2");

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "project-2" }),
    });
    expect(get(activeProjectId)).toBe("project-2");
    expect(get(activeProject)?.name).toBe("beta");
  });
});
