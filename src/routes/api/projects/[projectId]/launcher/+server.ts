import { json } from "@sveltejs/kit";
import { runRequestCodec } from "$lib/contracts/domain.js";
import { issuesMessage, launcherError, parseJsonBody } from "$lib/server/api.js";
import { getRunStatus, spawnRun } from "$lib/server/launcher.js";
import { getProjectRuntime, type ProjectRuntime } from "$lib/server/runtime.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = async ({ params, url }) => {
  let runtime: ProjectRuntime | null = null;
  try {
    runtime = await getProjectRuntime(params.projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load project config";
    return json({ error: message }, { status: 500 });
  }
  if (!runtime) {
    return json({ error: "Project not found" }, { status: 404 });
  }

  if (url.searchParams.has("status")) {
    return json(getRunStatus(runtime.project.id));
  }

  if (!runtime.launcherConfig) {
    return json({ error: "Launcher not configured" }, { status: 404 });
  }

  return json(runtime.launcherConfig);
};

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await parseJsonBody(request, runRequestCodec);
  if (!body.ok) {
    return launcherError(issuesMessage(body.issues), 400);
  }

  let runtime: ProjectRuntime | null = null;
  try {
    runtime = await getProjectRuntime(params.projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load project config";
    return launcherError(message, 500);
  }
  if (!runtime) {
    return launcherError("Project not found", 404);
  }

  if (!runtime.launcherConfig) {
    return launcherError("Launcher not configured", 404);
  }

  const result = spawnRun(runtime.project.id, body.value, runtime.runCommand, runtime.runsDir, runtime.launcherConfig);
  return json(result, { status: result.ok ? 200 : 409 });
};
