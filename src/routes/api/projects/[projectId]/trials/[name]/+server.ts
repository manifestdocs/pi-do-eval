import { json } from "@sveltejs/kit";
import { loadTrialMeta, type TrialMeta, writeTrialMeta } from "$eval/trial-meta.js";
import { getRegisteredProject } from "$lib/server/projects.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ params }) => {
  const project = getRegisteredProject(params.projectId);
  if (!project) return json({ error: "Project not found" }, { status: 404 });

  const meta = loadTrialMeta(project.evalDir, params.name);
  return json({ meta: meta ?? {} });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const project = getRegisteredProject(params.projectId);
  if (!project) return json({ error: "Project not found" }, { status: 404 });

  const body = (await request.json()) as Partial<TrialMeta>;
  const existing = loadTrialMeta(project.evalDir, params.name) ?? {};
  const next: TrialMeta = {
    description: body.description !== undefined ? body.description : existing.description,
    tags: body.tags !== undefined ? body.tags : existing.tags,
    enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
  };

  try {
    writeTrialMeta(project.evalDir, params.name, next);
    return json({ meta: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write trial meta";
    return json({ error: message }, { status: 400 });
  }
};
