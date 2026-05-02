import { json } from "@sveltejs/kit";
import { loadTrialManifest, validateTrialName, writeTrialManifest } from "$eval/trial-manifest.js";
import { partialTrialMetaCodec, type TrialMeta } from "$lib/contracts/domain.js";
import { issuesMessage, jsonError, parseJsonBody } from "$lib/server/api.js";
import { getRegisteredProject } from "$lib/server/projects.js";
import type { RequestHandler } from "./$types.js";

function manifestToMeta(manifest: ReturnType<typeof loadTrialManifest>): TrialMeta {
  if (!manifest) return {};
  return {
    ...(manifest.description ? { description: manifest.description } : {}),
    ...(manifest.tags ? { tags: manifest.tags } : {}),
    ...(manifest.enabled !== undefined ? { enabled: manifest.enabled } : {}),
  };
}

export const GET: RequestHandler = ({ params }) => {
  const project = getRegisteredProject(params.projectId);
  if (!project) return jsonError("Project not found", 404);

  const manifest = loadTrialManifest(project.evalDir, params.name);
  return json({ meta: manifestToMeta(manifest) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const project = getRegisteredProject(params.projectId);
  if (!project) return jsonError("Project not found", 404);

  const body = await parseJsonBody(request, partialTrialMetaCodec);
  if (!body.ok) {
    return jsonError(issuesMessage(body.issues), 400);
  }

  try {
    validateTrialName(params.name);
    const existing = loadTrialManifest(project.evalDir, params.name) ?? {
      description: "",
      variants: { default: {} },
    };
    const nextManifest = {
      ...existing,
      ...(body.value.description !== undefined ? { description: body.value.description.trim() } : {}),
      ...(body.value.tags !== undefined ? { tags: body.value.tags } : {}),
      ...(body.value.enabled !== undefined ? { enabled: body.value.enabled } : {}),
    };
    writeTrialManifest(project.evalDir, params.name, nextManifest);
    return json({ meta: manifestToMeta(nextManifest) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write trial meta";
    return json({ error: message }, { status: 400 });
  }
};
