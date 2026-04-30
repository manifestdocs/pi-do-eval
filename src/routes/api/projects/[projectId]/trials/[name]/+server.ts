import { json } from "@sveltejs/kit";
import { loadTrialMeta, type TrialMeta, writeTrialMeta } from "$eval/trial-meta.js";
import { partialTrialMetaCodec } from "$lib/contracts/domain.js";
import { issuesMessage, jsonError, parseJsonBody } from "$lib/server/api.js";
import { getRegisteredProject } from "$lib/server/projects.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ params }) => {
  const project = getRegisteredProject(params.projectId);
  if (!project) return jsonError("Project not found", 404);

  const meta = loadTrialMeta(project.evalDir, params.name);
  return json({ meta: meta ?? {} });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const project = getRegisteredProject(params.projectId);
  if (!project) return jsonError("Project not found", 404);

  const body = await parseJsonBody(request, partialTrialMetaCodec);
  if (!body.ok) {
    return jsonError(issuesMessage(body.issues), 400);
  }
  const existing = loadTrialMeta(project.evalDir, params.name) ?? {};
  const next: TrialMeta = {
    description: body.value.description !== undefined ? body.value.description : existing.description,
    tags: body.value.tags !== undefined ? body.value.tags : existing.tags,
    enabled: body.value.enabled !== undefined ? body.value.enabled : existing.enabled,
  };

  try {
    writeTrialMeta(project.evalDir, params.name, next);
    return json({ meta: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write trial meta";
    return json({ error: message }, { status: 400 });
  }
};
