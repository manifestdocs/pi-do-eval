import { json } from "@sveltejs/kit";
import { projectIdRequestCodec } from "$lib/contracts/domain.js";
import { issuesMessage, jsonError, parseJsonBody } from "$lib/server/api.js";
import { setActiveProject } from "$lib/server/projects.js";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ request }) => {
  const body = await parseJsonBody(request, projectIdRequestCodec);
  if (!body.ok) {
    return jsonError(issuesMessage(body.issues), 400);
  }

  try {
    const { registry } = setActiveProject(body.value.projectId);
    return json(registry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to select project";
    return json({ error: message }, { status: 404 });
  }
};
