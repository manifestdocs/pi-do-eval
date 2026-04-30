import { json } from "@sveltejs/kit";
import { projectPathRequestCodec } from "$lib/contracts/domain.js";
import { issuesMessage, jsonError, parseJsonBody } from "$lib/server/api.js";
import { addOrUpdateProject, loadProjectRegistry } from "$lib/server/projects.js";
import { projectWatchers } from "$lib/server/runtime.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = () => {
  const registry = loadProjectRegistry();
  return json(registry);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await parseJsonBody(request, projectPathRequestCodec);
  if (!body.ok) {
    return jsonError(issuesMessage(body.issues), 400);
  }

  try {
    const { registry } = addOrUpdateProject(body.value.path);
    projectWatchers.syncProjects(registry.projects);
    return json(registry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add project";
    return json({ error: message }, { status: 400 });
  }
};
