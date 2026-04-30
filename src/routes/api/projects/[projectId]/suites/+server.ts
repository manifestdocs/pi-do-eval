import { json } from "@sveltejs/kit";
import { loadFileSuites, type SuiteDefinition, writeFileSuite } from "$eval/suite-files.js";
import { suiteDefinitionCodec } from "$lib/contracts/domain.js";
import { issuesMessage, jsonError, parseJsonBody } from "$lib/server/api.js";
import { getRegisteredProject } from "$lib/server/projects.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ params }) => {
  const project = getRegisteredProject(params.projectId);
  if (!project) return jsonError("Project not found", 404);

  return json({ suites: loadFileSuites(project.evalDir) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const project = getRegisteredProject(params.projectId);
  if (!project) return json({ error: "Project not found" }, { status: 404 });

  const body = await parseJsonBody(request, suiteDefinitionCodec);
  if (!body.ok) {
    return jsonError(issuesMessage(body.issues), 400);
  }

  const suite: SuiteDefinition = {
    name: body.value.name,
    ...(body.value.description ? { description: body.value.description } : {}),
    trials: body.value.trials,
    ...(body.value.regressionThreshold !== undefined ? { regressionThreshold: body.value.regressionThreshold } : {}),
  };

  const existing = loadFileSuites(project.evalDir).find((entry) => entry.name === suite.name);
  if (existing) {
    return json({ error: `Suite "${suite.name}" already exists` }, { status: 409 });
  }

  try {
    writeFileSuite(project.evalDir, suite);
    return json({ suite });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write suite";
    return json({ error: message }, { status: 400 });
  }
};
