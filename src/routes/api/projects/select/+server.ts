import { json } from "@sveltejs/kit";
import { setActiveProject } from "$lib/server/projects.js";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { projectId?: string };
  if (!body.projectId) {
    return json({ error: "Project id is required" }, { status: 400 });
  }

  try {
    const { registry } = setActiveProject(body.projectId);
    return json(registry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to select project";
    return json({ error: message }, { status: 404 });
  }
};
