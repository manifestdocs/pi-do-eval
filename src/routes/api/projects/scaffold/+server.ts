import { json } from "@sveltejs/kit";
import { scaffoldRequestCodec } from "$lib/contracts/domain.js";
import { issuesMessage, jsonError, parseJsonBody } from "$lib/server/api.js";
import { addOrUpdateProject } from "$lib/server/projects.js";
import { projectWatchers } from "$lib/server/runtime.js";
import { InitError, initEvalDir } from "../../../../../cli/init.js";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ request }) => {
  const body = await parseJsonBody(request, scaffoldRequestCodec);
  if (!body.ok) {
    return jsonError(issuesMessage(body.issues), 400);
  }

  try {
    const result = await initEvalDir(body.value.repoRoot);
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
