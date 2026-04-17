import { json } from "@sveltejs/kit";
import { initEvalDir, InitError } from "../../../../../cli/init.js";
import { addOrUpdateProject } from "$lib/server/projects.js";
import { projectWatchers } from "$lib/server/runtime.js";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { repoRoot?: string };
  if (!body.repoRoot) {
    return json({ error: "repoRoot is required" }, { status: 400 });
  }

  try {
    const result = await initEvalDir(body.repoRoot);
    const { registry, project } = addOrUpdateProject(result.evalDir);
    projectWatchers.syncProjects(registry.projects);
    return json({ registry, project, extensionName: result.extensionName });
  } catch (error) {
    if (error instanceof InitError) {
      return json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Scaffold failed";
    return json({ error: message }, { status: 500 });
  }
};
