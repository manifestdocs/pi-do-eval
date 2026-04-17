import { json } from "@sveltejs/kit";
import { removeProject } from "$lib/server/projects.js";
import { projectWatchers } from "$lib/server/runtime.js";
import type { RequestHandler } from "./$types.js";

export const DELETE: RequestHandler = ({ params }) => {
  try {
    const { registry } = removeProject(params.projectId);
    projectWatchers.syncProjects(registry.projects);
    return json(registry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove project";
    return json({ error: message }, { status: 404 });
  }
};
