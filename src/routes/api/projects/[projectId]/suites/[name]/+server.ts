import { json } from "@sveltejs/kit";
import { deleteFileSuite, loadFileSuites, type SuiteDefinition, writeFileSuite } from "$eval/suite-files.js";
import { partialSuiteDefinitionCodec } from "$lib/contracts/domain.js";
import { issuesMessage, jsonError, parseJsonBody } from "$lib/server/api.js";
import { getRegisteredProject } from "$lib/server/projects.js";
import type { RequestHandler } from "./$types.js";

export const PATCH: RequestHandler = async ({ params, request }) => {
  const project = getRegisteredProject(params.projectId);
  if (!project) return jsonError("Project not found", 404);

  const body = await parseJsonBody(request, partialSuiteDefinitionCodec);
  if (!body.ok) {
    return jsonError(issuesMessage(body.issues), 400);
  }
  const existing = loadFileSuites(project.evalDir).find((entry) => entry.name === params.name);
  if (!existing) {
    return json({ error: `Suite "${params.name}" is not file-backed or does not exist` }, { status: 404 });
  }

  const next: SuiteDefinition = {
    name: body.value.name ?? existing.name,
    ...(body.value.description !== undefined
      ? { description: body.value.description }
      : existing.description
        ? { description: existing.description }
        : {}),
    trials: Array.isArray(body.value.trials) ? body.value.trials : existing.trials,
    ...(body.value.regressionThreshold !== undefined
      ? { regressionThreshold: body.value.regressionThreshold }
      : existing.regressionThreshold !== undefined
        ? { regressionThreshold: existing.regressionThreshold }
        : {}),
  };

  try {
    // Rename case: delete old, write new
    if (next.name !== existing.name) {
      deleteFileSuite(project.evalDir, existing.name);
    }
    writeFileSuite(project.evalDir, next);
    return json({ suite: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write suite";
    return json({ error: message }, { status: 400 });
  }
};

export const DELETE: RequestHandler = ({ params }) => {
  const project = getRegisteredProject(params.projectId);
  if (!project) return jsonError("Project not found", 404);

  const existing = loadFileSuites(project.evalDir).find((entry) => entry.name === params.name);
  if (!existing) {
    return json({ error: `Suite "${params.name}" is not file-backed or does not exist` }, { status: 404 });
  }

  try {
    deleteFileSuite(project.evalDir, existing.name);
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete suite";
    return json({ error: message }, { status: 400 });
  }
};
