import { json } from "@sveltejs/kit";
import { addOrUpdateProject, loadProjectRegistry } from "$lib/server/projects.js";
import { projectWatchers } from "$lib/server/runtime.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = () => {
  const registry = loadProjectRegistry();
  return json(registry);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { path?: string };
  if (!body.path) {
    return json({ error: "Project path is required" }, { status: 400 });
  }

  try {
    const { registry } = addOrUpdateProject(body.path);
    projectWatchers.syncProjects(registry.projects);
    return json(registry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add project";
    return json({ error: message }, { status: 400 });
  }
};
