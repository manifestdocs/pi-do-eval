import type { SuiteDefinition } from "$eval/suite-files.js";
import type { TrialMeta } from "$eval/trial-meta.js";
import type {
  AgentSnapshot,
  BenchIndexEntry,
  BenchReport,
  BudgetConfig,
  EvalEvent,
  EvalReport,
  EvalRunStatus,
  EvalSession,
  LauncherConfig,
  LauncherSuiteDef,
  LauncherTrial,
  RunEnvironment,
  RunIndexEntry,
  RunRequest,
  SuiteIndexEntry,
  SuiteReport,
} from "$eval/types.js";
import type { PersistedActiveRun } from "$lib/server/launcher.js";
import type { ProjectRegistry, RegisteredProject } from "$lib/server/projects.js";
import {
  asBoolean,
  asFiniteNumber,
  asObject,
  asOptionalBoolean,
  asOptionalFiniteNumber,
  asOptionalString,
  asOptionalStringArray,
  asString,
  asStringArray,
  fail,
  failIssues,
  isRecord,
  type JsonCodec,
  mergeIssues,
  ok,
  type ParseResult,
} from "./codec.js";

const RUN_STATUSES = new Set(["completed", "timeout", "crashed", "stalled"]);
const REGRESSION_STATUSES = new Set(["improved", "stable", "regressed", "baseline"]);
const SUITE_SOURCES = new Set(["file", "config"]);

function optional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function parseTrialRef(value: unknown, path: string): ParseResult<{ trial: string; variant: string }> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const trial = asString(object.value.trial, `${path}.trial`);
  const variant = asString(object.value.variant, `${path}.variant`);
  const issues = mergeIssues(trial, variant);
  if (issues.length > 0) return failIssues(issues);
  return ok({ trial: trial.value, variant: variant.value });
}

function parseTrialRefs(value: unknown, path: string): ParseResult<Array<{ trial: string; variant: string }>> {
  if (!Array.isArray(value)) return fail(`${path} must be an array`);
  const parsed = value.map((entry, index) => parseTrialRef(entry, `${path}[${index}]`));
  const issues = mergeIssues(...parsed);
  if (issues.length > 0) return failIssues(issues);
  return ok(parsed.map((entry) => entry.value));
}

function parseOptionalModel(
  value: unknown,
  path: string,
): ParseResult<{ provider?: string; model?: string } | undefined> {
  if (value === undefined) return ok(undefined);
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const provider = asOptionalString(object.value.provider, `${path}.provider`);
  const model = asOptionalString(object.value.model, `${path}.model`);
  const issues = mergeIssues(provider, model);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    ...(provider.value ? { provider: provider.value } : {}),
    ...(model.value ? { model: model.value } : {}),
  });
}

function parseModelList(value: unknown, path: string): ParseResult<Array<{ provider?: string; model?: string }>> {
  if (!Array.isArray(value)) return fail(`${path} must be an array`);
  const parsed = value.map((entry, index) => parseOptionalModel(entry, `${path}[${index}]`));
  const issues = mergeIssues(...parsed);
  if (issues.length > 0) return failIssues(issues);
  return ok(parsed.flatMap((entry) => (entry.value ? [entry.value] : [])));
}

function parseNumberRecord(value: unknown, path: string): ParseResult<Record<string, number>> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const result: Record<string, number> = {};
  const issues: string[] = [];
  for (const [key, entry] of Object.entries(object.value)) {
    const parsed = asFiniteNumber(entry, `${path}.${key}`);
    if (parsed.ok) result[key] = parsed.value;
    else issues.push(...parsed.issues);
  }
  return issues.length > 0 ? failIssues(issues) : ok(result);
}

function parseBudgetConfig(value: unknown, path: string): ParseResult<BudgetConfig | undefined> {
  if (value === undefined) return ok(undefined);
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const result: BudgetConfig = {};
  const keys: Array<keyof BudgetConfig> = [
    "maxInputTokens",
    "maxOutputTokens",
    "maxTotalTokens",
    "maxDurationMs",
    "maxToolCalls",
    "maxBlockedCalls",
    "maxFileWrites",
  ];
  const issues: string[] = [];
  for (const key of keys) {
    const parsed = asOptionalFiniteNumber(object.value[key], `${path}.${key}`);
    if (parsed.ok) optional(result, key, parsed.value);
    else issues.push(...parsed.issues);
  }
  return issues.length > 0 ? failIssues(issues) : ok(result);
}

function parseAgentSnapshot(value: unknown, path: string): ParseResult<AgentSnapshot | undefined> {
  if (value === undefined) return ok(undefined);
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const worker = parseOptionalAgentModel(object.value.worker, `${path}.worker`);
  const judge = parseOptionalAgentModel(object.value.judge, `${path}.judge`);
  const budgets = parseBudgetConfig(object.value.budgets, `${path}.budgets`);
  const epochs = asOptionalFiniteNumber(object.value.epochs, `${path}.epochs`);
  const regressionThreshold = asOptionalFiniteNumber(object.value.regressionThreshold, `${path}.regressionThreshold`);
  const timeouts = parseTimeouts(object.value.timeouts, `${path}.timeouts`);
  const issues = mergeIssues(worker, judge, budgets, epochs, regressionThreshold, timeouts);
  if (issues.length > 0) return failIssues(issues);
  const result: AgentSnapshot = {};
  optional(result, "worker", worker.value);
  optional(result, "judge", judge.value);
  optional(result, "budgets", budgets.value);
  optional(result, "epochs", epochs.value);
  optional(result, "regressionThreshold", regressionThreshold.value);
  optional(result, "timeouts", timeouts.value);
  return ok(result);
}

function parseOptionalAgentModel(
  value: unknown,
  path: string,
): ParseResult<{ provider?: string; model?: string; thinking?: string } | undefined> {
  if (value === undefined) return ok(undefined);
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const provider = asOptionalString(object.value.provider, `${path}.provider`);
  const model = asOptionalString(object.value.model, `${path}.model`);
  const thinking = asOptionalString(object.value.thinking, `${path}.thinking`);
  const issues = mergeIssues(provider, model, thinking);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    ...(provider.value ? { provider: provider.value } : {}),
    ...(model.value ? { model: model.value } : {}),
    ...(thinking.value ? { thinking: thinking.value } : {}),
  });
}

function parseTimeouts(
  value: unknown,
  path: string,
): ParseResult<{ workerMs?: number; inactivityMs?: number; judgeMs?: number } | undefined> {
  if (value === undefined) return ok(undefined);
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const workerMs = asOptionalFiniteNumber(object.value.workerMs, `${path}.workerMs`);
  const inactivityMs = asOptionalFiniteNumber(object.value.inactivityMs, `${path}.inactivityMs`);
  const judgeMs = asOptionalFiniteNumber(object.value.judgeMs, `${path}.judgeMs`);
  const issues = mergeIssues(workerMs, inactivityMs, judgeMs);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    ...(workerMs.value !== undefined ? { workerMs: workerMs.value } : {}),
    ...(inactivityMs.value !== undefined ? { inactivityMs: inactivityMs.value } : {}),
    ...(judgeMs.value !== undefined ? { judgeMs: judgeMs.value } : {}),
  });
}

function parseEnvironment(value: unknown, path: string): ParseResult<RunEnvironment | undefined> {
  if (value === undefined) return ok(undefined);
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const nodeVersion = asString(object.value.nodeVersion, `${path}.nodeVersion`);
  const platform = asString(object.value.platform, `${path}.platform`);
  const runtime = asOptionalString(object.value.runtime, `${path}.runtime`);
  const piVersion = asOptionalString(object.value.piVersion, `${path}.piVersion`);
  const issues = mergeIssues(nodeVersion, platform, runtime, piVersion);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    nodeVersion: nodeVersion.value,
    platform: platform.value,
    ...(runtime.value ? { runtime: runtime.value } : {}),
    ...(piVersion.value ? { piVersion: piVersion.value } : {}),
  });
}

export const trialMetaCodec: JsonCodec<TrialMeta> = {
  parse(value) {
    const object = asObject(value, "meta");
    if (!object.ok) return failIssues(object.issues);
    const result: TrialMeta = {};
    if (typeof object.value.description === "string") result.description = object.value.description;
    if (Array.isArray(object.value.tags)) {
      result.tags = object.value.tags.filter((tag): tag is string => typeof tag === "string");
    }
    if (typeof object.value.enabled === "boolean") result.enabled = object.value.enabled;
    return ok(result);
  },
  serialize(value) {
    return value;
  },
};

export const partialTrialMetaCodec: JsonCodec<TrialMeta> = {
  parse(value) {
    const object = asObject(value, "meta");
    if (!object.ok) return failIssues(object.issues);
    const description = asOptionalString(object.value.description, "meta.description");
    const tags = asOptionalStringArray(object.value.tags, "meta.tags");
    const enabled = asOptionalBoolean(object.value.enabled, "meta.enabled");
    const issues = mergeIssues(description, tags, enabled);
    if (issues.length > 0) return failIssues(issues);
    return ok({
      ...(description.value !== undefined ? { description: description.value } : {}),
      ...(tags.value ? { tags: tags.value } : {}),
      ...(enabled.value !== undefined ? { enabled: enabled.value } : {}),
    });
  },
  serialize(value) {
    return value;
  },
};

export const suiteDefinitionCodec: JsonCodec<SuiteDefinition> = {
  parse(value) {
    const object = asObject(value, "suite");
    if (!object.ok) return failIssues(object.issues);
    const name = asOptionalString(object.value.name, "suite.name");
    const description = asOptionalString(object.value.description, "suite.description");
    const trials = parseTrialRefs(object.value.trials, "suite.trials");
    const regressionThreshold = asOptionalFiniteNumber(object.value.regressionThreshold, "suite.regressionThreshold");
    const issues = mergeIssues(name, description, trials, regressionThreshold);
    if (issues.length > 0) return failIssues(issues);
    if (!name.value) return fail("suite.name must be a string");
    return ok({
      name: name.value,
      ...(description.value ? { description: description.value } : {}),
      trials: trials.value,
      ...(regressionThreshold.value !== undefined ? { regressionThreshold: regressionThreshold.value } : {}),
    });
  },
  serialize(value) {
    return value;
  },
};

export function parseSuiteDefinitionWithFallbackName(
  value: unknown,
  fallbackName: string,
): ParseResult<SuiteDefinition> {
  if (!isRecord(value)) return fail("suite must be an object");
  return suiteDefinitionCodec.parse({ ...value, name: typeof value.name === "string" ? value.name : fallbackName });
}

export const partialSuiteDefinitionCodec: JsonCodec<Partial<SuiteDefinition>> = {
  parse(value) {
    const object = asObject(value, "suite");
    if (!object.ok) return failIssues(object.issues);
    const name = asOptionalString(object.value.name, "suite.name");
    const description = asOptionalString(object.value.description, "suite.description");
    const trials =
      object.value.trials === undefined ? ok(undefined) : parseTrialRefs(object.value.trials, "suite.trials");
    const regressionThreshold = asOptionalFiniteNumber(object.value.regressionThreshold, "suite.regressionThreshold");
    const issues = mergeIssues(name, description, trials, regressionThreshold);
    if (issues.length > 0) return failIssues(issues);
    return ok({
      ...(name.value ? { name: name.value } : {}),
      ...(description.value !== undefined ? { description: description.value } : {}),
      ...(trials.value ? { trials: trials.value } : {}),
      ...(regressionThreshold.value !== undefined ? { regressionThreshold: regressionThreshold.value } : {}),
    });
  },
  serialize(value) {
    return value;
  },
};

function parseRegisteredProject(value: unknown, path: string): ParseResult<RegisteredProject> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const id = asString(object.value.id, `${path}.id`);
  const name = asString(object.value.name, `${path}.name`);
  const projectRoot = asString(object.value.projectRoot, `${path}.projectRoot`);
  const evalDir = asString(object.value.evalDir, `${path}.evalDir`);
  const addedAt = asString(object.value.addedAt, `${path}.addedAt`);
  const updatedAt = asString(object.value.updatedAt, `${path}.updatedAt`);
  const lastSelectedAt = asString(object.value.lastSelectedAt, `${path}.lastSelectedAt`);
  const issues = mergeIssues(id, name, projectRoot, evalDir, addedAt, updatedAt, lastSelectedAt);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    id: id.value,
    name: name.value,
    projectRoot: projectRoot.value,
    evalDir: evalDir.value,
    addedAt: addedAt.value,
    updatedAt: updatedAt.value,
    lastSelectedAt: lastSelectedAt.value,
  });
}

export const projectRegistryCodec: JsonCodec<ProjectRegistry> = {
  parse(value) {
    const object = asObject(value, "registry");
    if (!object.ok) return failIssues(object.issues);
    const rawProjects = Array.isArray(object.value.projects) ? object.value.projects : [];
    const projects = rawProjects
      .map((entry, index) => parseRegisteredProject(entry, `registry.projects[${index}]`))
      .flatMap((entry) => (entry.ok ? [entry.value] : []));
    const activeProjectId =
      typeof object.value.activeProjectId === "string" &&
      projects.some((project) => project.id === object.value.activeProjectId)
        ? object.value.activeProjectId
        : (projects[0]?.id ?? null);
    return ok({ activeProjectId, projects });
  },
  serialize(value) {
    return {
      activeProjectId:
        value.activeProjectId && value.projects.some((project) => project.id === value.activeProjectId)
          ? value.activeProjectId
          : (value.projects[0]?.id ?? null),
      projects: value.projects,
    };
  },
};

function parsePersistedActiveRun(value: unknown, path: string): ParseResult<PersistedActiveRun> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const id = asString(object.value.id, `${path}.id`);
  const projectId = asString(object.value.projectId, `${path}.projectId`);
  const pid = asFiniteNumber(object.value.pid, `${path}.pid`);
  const command = asString(object.value.command, `${path}.command`);
  const startedAt = asString(object.value.startedAt, `${path}.startedAt`);
  const runDir = asString(object.value.runDir, `${path}.runDir`);
  const issues = mergeIssues(id, projectId, pid, command, startedAt, runDir);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    id: id.value,
    projectId: projectId.value,
    pid: pid.value,
    command: command.value,
    startedAt: startedAt.value,
    runDir: runDir.value,
  });
}

export const activeRunsRegistryCodec: JsonCodec<Record<string, PersistedActiveRun>> = {
  parse(value) {
    const object = asObject(value, "activeRuns");
    if (!object.ok) return failIssues(object.issues);
    const result: Record<string, PersistedActiveRun> = {};
    for (const [projectId, entry] of Object.entries(object.value)) {
      const parsed = parsePersistedActiveRun(entry, `activeRuns.${projectId}`);
      if (parsed.ok) result[projectId] = parsed.value;
    }
    return ok(result);
  },
  serialize(value) {
    return value;
  },
};

export const runRequestCodec: JsonCodec<RunRequest> = {
  parse(value) {
    const object = asObject(value, "request");
    if (!object.ok) return failIssues(object.issues);
    const type = asString(object.value.type, "request.type");
    if (!type.ok) return failIssues(type.issues);
    const model = asOptionalString(object.value.model, "request.model");
    const noJudge = asOptionalBoolean(object.value.noJudge, "request.noJudge");
    const commonIssues = mergeIssues(model, noJudge);
    if (commonIssues.length > 0) return failIssues(commonIssues);
    if (type.value === "trial") {
      const trial = asString(object.value.trial, "request.trial");
      const variant = asString(object.value.variant, "request.variant");
      const issues = mergeIssues(trial, variant);
      if (issues.length > 0) return failIssues(issues);
      return ok({
        type: "trial",
        trial: trial.value,
        variant: variant.value,
        ...(model.value ? { model: model.value } : {}),
        ...(noJudge.value !== undefined ? { noJudge: noJudge.value } : {}),
      });
    }
    if (type.value === "suite" || type.value === "bench") {
      const suite = asString(object.value.suite, "request.suite");
      if (!suite.ok) return failIssues(suite.issues);
      return ok({
        type: type.value,
        suite: suite.value,
        ...(model.value ? { model: model.value } : {}),
        ...(noJudge.value !== undefined ? { noJudge: noJudge.value } : {}),
      });
    }
    return fail('request.type must be "trial", "suite", or "bench"');
  },
  serialize(value) {
    return value;
  },
};

export const projectPathRequestCodec: JsonCodec<{ path: string }> = {
  parse(value) {
    const object = asObject(value, "request");
    if (!object.ok) return failIssues(object.issues);
    const projectPath = asString(object.value.path, "request.path");
    return projectPath.ok ? ok({ path: projectPath.value }) : failIssues(projectPath.issues);
  },
  serialize(value) {
    return value;
  },
};

export const projectIdRequestCodec: JsonCodec<{ projectId: string }> = {
  parse(value) {
    const object = asObject(value, "request");
    if (!object.ok) return failIssues(object.issues);
    const projectId = asString(object.value.projectId, "request.projectId");
    return projectId.ok ? ok({ projectId: projectId.value }) : failIssues(projectId.issues);
  },
  serialize(value) {
    return value;
  },
};

export const scaffoldRequestCodec: JsonCodec<{ repoRoot: string }> = {
  parse(value) {
    const object = asObject(value, "request");
    if (!object.ok) return failIssues(object.issues);
    const repoRoot = asString(object.value.repoRoot, "request.repoRoot");
    return repoRoot.ok ? ok({ repoRoot: repoRoot.value }) : failIssues(repoRoot.issues);
  },
  serialize(value) {
    return value;
  },
};

export const launcherActionResponseCodec: JsonCodec<{ ok: boolean; id?: string; error?: string }> = {
  parse(value) {
    const object = asObject(value, "launcherResponse");
    if (!object.ok) return failIssues(object.issues);
    const okValue = asBoolean(object.value.ok, "launcherResponse.ok");
    const id = asOptionalString(object.value.id, "launcherResponse.id");
    const error = asOptionalString(object.value.error, "launcherResponse.error");
    const issues = mergeIssues(okValue, id, error);
    if (issues.length > 0) return failIssues(issues);
    return ok({
      ok: okValue.value,
      ...(id.value ? { id: id.value } : {}),
      ...(error.value ? { error: error.value } : {}),
    });
  },
  serialize(value) {
    return value;
  },
};

function parseLauncherTrial(value: unknown, path: string): ParseResult<LauncherTrial> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const name = asString(object.value.name, `${path}.name`);
  const description = asString(object.value.description, `${path}.description`);
  const variants = asStringArray(object.value.variants, `${path}.variants`);
  const tags = asOptionalStringArray(object.value.tags, `${path}.tags`);
  const enabled = asOptionalBoolean(object.value.enabled, `${path}.enabled`);
  const issues = mergeIssues(name, description, variants, tags, enabled);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    name: name.value,
    description: description.value,
    variants: variants.value,
    ...(tags.value ? { tags: tags.value } : {}),
    ...(enabled.value !== undefined ? { enabled: enabled.value } : {}),
  });
}

function parseLauncherSuiteDef(value: unknown, path: string): ParseResult<LauncherSuiteDef> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const name = asString(object.value.name, `${path}.name`);
  const description = asOptionalString(object.value.description, `${path}.description`);
  const trials = parseTrialRefs(object.value.trials, `${path}.trials`);
  const regressionThreshold = asOptionalFiniteNumber(object.value.regressionThreshold, `${path}.regressionThreshold`);
  const source = asString(object.value.source, `${path}.source`);
  const issues = mergeIssues(name, description, trials, regressionThreshold, source);
  if (issues.length > 0) return failIssues(issues);
  if (!SUITE_SOURCES.has(source.value)) return fail(`${path}.source must be file or config`);
  return ok({
    name: name.value,
    ...(description.value ? { description: description.value } : {}),
    trials: trials.value,
    ...(regressionThreshold.value !== undefined ? { regressionThreshold: regressionThreshold.value } : {}),
    source: source.value as "file" | "config",
  });
}

export const launcherConfigCodec: JsonCodec<LauncherConfig> = {
  parse(value) {
    const object = asObject(value, "launcherConfig");
    if (!object.ok) return failIssues(object.issues);
    const trials = Array.isArray(object.value.trials)
      ? object.value.trials.map((entry, index) => parseLauncherTrial(entry, `launcherConfig.trials[${index}]`))
      : [fail("launcherConfig.trials must be an array")];
    const suitesObject = asObject(object.value.suites, "launcherConfig.suites");
    const models = parseModelList(object.value.models, "launcherConfig.models");
    const defaultWorker = parseOptionalModel(object.value.defaultWorker, "launcherConfig.defaultWorker");
    const judge = parseOptionalModel(object.value.judge, "launcherConfig.judge");
    const timeouts = parseTimeouts(object.value.timeouts, "launcherConfig.timeouts");
    const epochs = asOptionalFiniteNumber(object.value.epochs, "launcherConfig.epochs");
    const budgets = parseBudgetConfig(object.value.budgets, "launcherConfig.budgets");
    const regressionThreshold = asOptionalFiniteNumber(
      object.value.regressionThreshold,
      "launcherConfig.regressionThreshold",
    );
    const suiteDefs =
      object.value.suiteDefs === undefined
        ? ok(undefined)
        : Array.isArray(object.value.suiteDefs)
          ? parseArray(object.value.suiteDefs, "launcherConfig.suiteDefs", parseLauncherSuiteDef)
          : fail("launcherConfig.suiteDefs must be an array");
    const issues = mergeIssues(
      ...trials,
      suitesObject,
      models,
      defaultWorker,
      judge,
      timeouts,
      epochs,
      budgets,
      regressionThreshold,
      suiteDefs,
    );
    if (issues.length > 0) return failIssues(issues);
    const suites: Record<string, Array<{ trial: string; variant: string }>> = {};
    for (const [name, entries] of Object.entries(suitesObject.value)) {
      const parsed = parseTrialRefs(entries, `launcherConfig.suites.${name}`);
      if (!parsed.ok) return failIssues(parsed.issues);
      suites[name] = parsed.value;
    }
    return ok({
      trials: trials.map((entry) => entry.value),
      suites,
      ...(suiteDefs.value ? { suiteDefs: suiteDefs.value } : {}),
      models: models.value,
      ...(defaultWorker.value ? { defaultWorker: defaultWorker.value } : {}),
      ...(judge.value ? { judge: judge.value } : {}),
      ...(timeouts.value ? { timeouts: timeouts.value } : {}),
      ...(epochs.value !== undefined ? { epochs: epochs.value } : {}),
      ...(budgets.value ? { budgets: budgets.value } : {}),
      ...(regressionThreshold.value !== undefined ? { regressionThreshold: regressionThreshold.value } : {}),
    });
  },
  serialize(value) {
    return value;
  },
};

function parseArray<T>(
  value: unknown[],
  path: string,
  parseEntry: (value: unknown, path: string) => ParseResult<T>,
): ParseResult<T[]> {
  const parsed = value.map((entry, index) => parseEntry(entry, `${path}[${index}]`));
  const issues = mergeIssues(...parsed);
  if (issues.length > 0) return failIssues(issues);
  return ok(parsed.map((entry) => entry.value));
}

export const runIndexEntryCodec: JsonCodec<RunIndexEntry> = {
  parse(value) {
    const object = asObject(value, "run");
    if (!object.ok) return failIssues(object.issues);
    const dir = asString(object.value.dir, "run.dir");
    const runId = asOptionalString(object.value.runId, "run.runId");
    const trial = asString(object.value.trial, "run.trial");
    const variant = asString(object.value.variant, "run.variant");
    const status = asString(object.value.status, "run.status");
    const overall = asFiniteNumber(object.value.overall, "run.overall");
    const durationMs = asFiniteNumber(object.value.durationMs, "run.durationMs");
    const startedAt = asString(object.value.startedAt, "run.startedAt");
    const workerModel = asString(object.value.workerModel, "run.workerModel");
    const judgeModel = asOptionalString(object.value.judgeModel, "run.judgeModel");
    const suite = asOptionalString(object.value.suite, "run.suite");
    const suiteRunId = asOptionalString(object.value.suiteRunId, "run.suiteRunId");
    const epoch = asOptionalFiniteNumber(object.value.epoch, "run.epoch");
    const totalEpochs = asOptionalFiniteNumber(object.value.totalEpochs, "run.totalEpochs");
    const agentSnapshot = parseAgentSnapshot(object.value.agentSnapshot, "run.agentSnapshot");
    const environment = parseEnvironment(object.value.environment, "run.environment");
    const issues = mergeIssues(
      dir,
      runId,
      trial,
      variant,
      status,
      overall,
      durationMs,
      startedAt,
      workerModel,
      judgeModel,
      suite,
      suiteRunId,
      epoch,
      totalEpochs,
      agentSnapshot,
      environment,
    );
    if (issues.length > 0) return failIssues(issues);
    return ok({
      dir: dir.value,
      ...(runId.value ? { runId: runId.value } : {}),
      trial: trial.value,
      variant: variant.value,
      status: status.value,
      overall: overall.value,
      durationMs: durationMs.value,
      startedAt: startedAt.value,
      workerModel: workerModel.value,
      ...(judgeModel.value ? { judgeModel: judgeModel.value } : {}),
      ...(suite.value ? { suite: suite.value } : {}),
      ...(suiteRunId.value ? { suiteRunId: suiteRunId.value } : {}),
      ...(epoch.value !== undefined ? { epoch: epoch.value } : {}),
      ...(totalEpochs.value !== undefined ? { totalEpochs: totalEpochs.value } : {}),
      ...(agentSnapshot.value ? { agentSnapshot: agentSnapshot.value } : {}),
      ...(environment.value ? { environment: environment.value } : {}),
    });
  },
  serialize(value) {
    return value;
  },
};

export const runIndexCodec: JsonCodec<RunIndexEntry[]> = arrayCodec(runIndexEntryCodec, "runs");

function parseEvalRunStatus(value: unknown, path: string): ParseResult<EvalRunStatus> {
  const parsed = asString(value, path);
  if (!parsed.ok) return failIssues(parsed.issues);
  return RUN_STATUSES.has(parsed.value) ? ok(parsed.value as EvalRunStatus) : fail(`${path} must be a run status`);
}

function parseEvalSession(value: unknown, path: string): ParseResult<EvalSession> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const toolCalls = Array.isArray(object.value.toolCalls)
    ? ok(object.value.toolCalls as EvalSession["toolCalls"])
    : fail(`${path}.toolCalls must be an array`);
  const fileWrites = Array.isArray(object.value.fileWrites)
    ? ok(object.value.fileWrites as EvalSession["fileWrites"])
    : fail(`${path}.fileWrites must be an array`);
  const pluginEvents = Array.isArray(object.value.pluginEvents)
    ? ok(object.value.pluginEvents as EvalSession["pluginEvents"])
    : fail(`${path}.pluginEvents must be an array`);
  const rawLines =
    object.value.rawLines === undefined ? ok([]) : asStringArray(object.value.rawLines, `${path}.rawLines`);
  const startTime = asFiniteNumber(object.value.startTime, `${path}.startTime`);
  const endTime = asFiniteNumber(object.value.endTime, `${path}.endTime`);
  const exitCode =
    object.value.exitCode === null || object.value.exitCode === undefined
      ? ok(null)
      : asFiniteNumber(object.value.exitCode, `${path}.exitCode`);
  const tokenUsageObject = asObject(object.value.tokenUsage, `${path}.tokenUsage`);
  const tokenUsage = tokenUsageObject.ok
    ? parseTokenUsage(tokenUsageObject.value, `${path}.tokenUsage`)
    : failIssues<{ input: number; output: number }>(tokenUsageObject.issues);
  const parseWarnings = asFiniteNumber(object.value.parseWarnings, `${path}.parseWarnings`);
  const issues = mergeIssues(
    toolCalls,
    fileWrites,
    pluginEvents,
    rawLines,
    startTime,
    endTime,
    exitCode,
    tokenUsage,
    parseWarnings,
  );
  if (issues.length > 0) return failIssues(issues);
  return ok({
    toolCalls: toolCalls.value,
    fileWrites: fileWrites.value,
    pluginEvents: pluginEvents.value,
    rawLines: rawLines.value,
    startTime: startTime.value,
    endTime: endTime.value,
    exitCode: exitCode.value,
    tokenUsage: tokenUsage.value,
    parseWarnings: parseWarnings.value,
  });
}

function parseTokenUsage(value: Record<string, unknown>, path: string): ParseResult<{ input: number; output: number }> {
  const input = asFiniteNumber(value.input, `${path}.input`);
  const output = asFiniteNumber(value.output, `${path}.output`);
  const issues = mergeIssues(input, output);
  if (issues.length > 0) return failIssues(issues);
  return ok({ input: input.value, output: output.value });
}

function parseEvalReport(value: unknown, path: string): ParseResult<EvalReport> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const metaObject = asObject(object.value.meta, `${path}.meta`);
  const scoresObject = asObject(object.value.scores, `${path}.scores`);
  const session = parseEvalSession(object.value.session, `${path}.session`);
  const findings = asStringArray(object.value.findings, `${path}.findings`);
  const issues = mergeIssues(metaObject, scoresObject, session, findings);
  if (issues.length > 0) return failIssues(issues);
  const meta = parseEvalMeta(metaObject.value, `${path}.meta`);
  const scores = parseEvalScores(scoresObject.value, `${path}.scores`);
  const nextIssues = mergeIssues(meta, scores);
  if (nextIssues.length > 0) return failIssues(nextIssues);
  return ok({ meta: meta.value, scores: scores.value, session: session.value, findings: findings.value });
}

function parseEvalMeta(value: Record<string, unknown>, path: string): ParseResult<EvalReport["meta"]> {
  const runId = asOptionalString(value.runId, `${path}.runId`);
  const trial = asString(value.trial, `${path}.trial`);
  const variant = asString(value.variant, `${path}.variant`);
  const workerModel = asString(value.workerModel, `${path}.workerModel`);
  const judgeModel = asOptionalString(value.judgeModel, `${path}.judgeModel`);
  const startedAt = asString(value.startedAt, `${path}.startedAt`);
  const durationMs = asFiniteNumber(value.durationMs, `${path}.durationMs`);
  const status = parseEvalRunStatus(value.status, `${path}.status`);
  const verifyPassed = asBoolean(value.verifyPassed, `${path}.verifyPassed`);
  const suite = asOptionalString(value.suite, `${path}.suite`);
  const suiteRunId = asOptionalString(value.suiteRunId, `${path}.suiteRunId`);
  const epoch = asOptionalFiniteNumber(value.epoch, `${path}.epoch`);
  const totalEpochs = asOptionalFiniteNumber(value.totalEpochs, `${path}.totalEpochs`);
  const agentSnapshot = parseAgentSnapshot(value.agentSnapshot, `${path}.agentSnapshot`);
  const environment = parseEnvironment(value.environment, `${path}.environment`);
  const issues = mergeIssues(
    runId,
    trial,
    variant,
    workerModel,
    judgeModel,
    startedAt,
    durationMs,
    status,
    verifyPassed,
    suite,
    suiteRunId,
    epoch,
    totalEpochs,
    agentSnapshot,
    environment,
  );
  if (issues.length > 0) return failIssues(issues);
  return ok({
    ...(runId.value ? { runId: runId.value } : {}),
    trial: trial.value,
    variant: variant.value,
    workerModel: workerModel.value,
    ...(judgeModel.value ? { judgeModel: judgeModel.value } : {}),
    startedAt: startedAt.value,
    durationMs: durationMs.value,
    status: status.value,
    verifyPassed: verifyPassed.value,
    ...(suite.value ? { suite: suite.value } : {}),
    ...(suiteRunId.value ? { suiteRunId: suiteRunId.value } : {}),
    ...(epoch.value !== undefined ? { epoch: epoch.value } : {}),
    ...(totalEpochs.value !== undefined ? { totalEpochs: totalEpochs.value } : {}),
    ...(agentSnapshot.value ? { agentSnapshot: agentSnapshot.value } : {}),
    ...(environment.value ? { environment: environment.value } : {}),
  });
}

function parseEvalScores(value: Record<string, unknown>, path: string): ParseResult<EvalReport["scores"]> {
  const deterministic = parseNumberRecord(value.deterministic, `${path}.deterministic`);
  const judge = value.judge === undefined ? ok(undefined) : parseNumberRecord(value.judge, `${path}.judge`);
  const overall = asFiniteNumber(value.overall, `${path}.overall`);
  const issuesList = asStringArray(value.issues ?? [], `${path}.issues`);
  const issues = mergeIssues(deterministic, judge, overall, issuesList);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    deterministic: deterministic.value,
    ...(judge.value ? { judge: judge.value } : {}),
    overall: overall.value,
    issues: issuesList.value,
  });
}

export const evalReportCodec: JsonCodec<EvalReport> = {
  parse(value) {
    return parseEvalReport(value, "report");
  },
  serialize(value) {
    return value;
  },
};

function parseSuiteIndexEntry(value: unknown, path: string): ParseResult<SuiteIndexEntry> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const suite = asString(object.value.suite, `${path}.suite`);
  const suiteRunId = asString(object.value.suiteRunId, `${path}.suiteRunId`);
  const workerModel = asOptionalString(object.value.workerModel, `${path}.workerModel`);
  const dir = asString(object.value.dir, `${path}.dir`);
  const startedAt = asString(object.value.startedAt, `${path}.startedAt`);
  const completedAt = asString(object.value.completedAt, `${path}.completedAt`);
  const totalRuns = asFiniteNumber(object.value.totalRuns, `${path}.totalRuns`);
  const hardFailureCount = asFiniteNumber(object.value.hardFailureCount, `${path}.hardFailureCount`);
  const averageOverall = asFiniteNumber(object.value.averageOverall, `${path}.averageOverall`);
  const epochs = asOptionalFiniteNumber(object.value.epochs, `${path}.epochs`);
  const regressionStatus = asOptionalString(object.value.regressionStatus, `${path}.regressionStatus`);
  const regressionDelta = asOptionalFiniteNumber(object.value.regressionDelta, `${path}.regressionDelta`);
  const comparedToSuiteRunId = asOptionalString(object.value.comparedToSuiteRunId, `${path}.comparedToSuiteRunId`);
  const issues = mergeIssues(
    suite,
    suiteRunId,
    workerModel,
    dir,
    startedAt,
    completedAt,
    totalRuns,
    hardFailureCount,
    averageOverall,
    epochs,
    regressionStatus,
    regressionDelta,
    comparedToSuiteRunId,
  );
  if (issues.length > 0) return failIssues(issues);
  if (regressionStatus.value && !REGRESSION_STATUSES.has(regressionStatus.value))
    return fail(`${path}.regressionStatus is invalid`);
  return ok({
    suite: suite.value,
    suiteRunId: suiteRunId.value,
    ...(workerModel.value ? { workerModel: workerModel.value } : {}),
    dir: dir.value,
    startedAt: startedAt.value,
    completedAt: completedAt.value,
    totalRuns: totalRuns.value,
    hardFailureCount: hardFailureCount.value,
    averageOverall: averageOverall.value,
    ...(epochs.value !== undefined ? { epochs: epochs.value } : {}),
    ...(regressionStatus.value
      ? { regressionStatus: regressionStatus.value as SuiteIndexEntry["regressionStatus"] }
      : {}),
    ...(regressionDelta.value !== undefined ? { regressionDelta: regressionDelta.value } : {}),
    ...(comparedToSuiteRunId.value ? { comparedToSuiteRunId: comparedToSuiteRunId.value } : {}),
  });
}

export const suiteIndexCodec: JsonCodec<SuiteIndexEntry[]> = arrayCodec(
  { parse: (value) => parseSuiteIndexEntry(value, "suiteIndexEntry"), serialize: (value) => value },
  "suiteIndex",
);

function parseBenchIndexEntry(value: unknown, path: string): ParseResult<BenchIndexEntry> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const suite = asString(object.value.suite, `${path}.suite`);
  const benchRunId = asString(object.value.benchRunId, `${path}.benchRunId`);
  const dir = asString(object.value.dir, `${path}.dir`);
  const completedAt = asString(object.value.completedAt, `${path}.completedAt`);
  const models = asStringArray(object.value.models, `${path}.models`);
  const averages = parseNumberRecord(object.value.averages, `${path}.averages`);
  const issues = mergeIssues(suite, benchRunId, dir, completedAt, models, averages);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    suite: suite.value,
    benchRunId: benchRunId.value,
    dir: dir.value,
    completedAt: completedAt.value,
    models: models.value,
    averages: averages.value,
  });
}

export const benchIndexCodec: JsonCodec<BenchIndexEntry[]> = arrayCodec(
  { parse: (value) => parseBenchIndexEntry(value, "benchIndexEntry"), serialize: (value) => value },
  "benchIndex",
);

export const suiteReportCodec: JsonCodec<SuiteReport> = looseReportCodec<SuiteReport>("suiteReport", [
  "suite",
  "suiteRunId",
  "startedAt",
  "completedAt",
  "entries",
  "summary",
]);
export const benchReportCodec: JsonCodec<BenchReport> = looseReportCodec<BenchReport>("benchReport", [
  "suite",
  "benchRunId",
  "startedAt",
  "completedAt",
  "models",
  "suiteRunIds",
  "entries",
  "averages",
]);

function looseReportCodec<T>(label: string, requiredKeys: string[]): JsonCodec<T> {
  return {
    parse(value) {
      const object = asObject(value, label);
      if (!object.ok) return failIssues(object.issues);
      const issues = requiredKeys.flatMap((key) =>
        object.value[key] === undefined ? [`${label}.${key} is required`] : [],
      );
      return issues.length > 0 ? failIssues(issues) : ok(object.value as T);
    },
    serialize(value) {
      return value;
    },
  };
}

export const liveRunReportCodec: JsonCodec<{ meta: EvalReport["meta"]; session: EvalSession; lastUpdated?: number }> =
  looseReportCodec("liveReport", ["meta", "session"]);

export const evalEventCodec: JsonCodec<EvalEvent> = {
  parse(value) {
    const object = asObject(value, "event");
    if (!object.ok) return failIssues(object.issues);
    const type = asString(object.value.type, "event.type");
    const timestamp = asFiniteNumber(object.value.timestamp, "event.timestamp");
    const issues = mergeIssues(type, timestamp);
    if (issues.length > 0) return failIssues(issues);
    if (type.value === "index_updated") {
      const runs = runIndexCodec.parse(object.value.runs);
      if (!runs.ok) return failIssues(runs.issues);
      return ok({ type: "index_updated", timestamp: timestamp.value, runs: runs.value });
    }
    if (type.value === "run_started") {
      const dir = asString(object.value.dir, "event.dir");
      const trial = asString(object.value.trial, "event.trial");
      const variant = asString(object.value.variant, "event.variant");
      const suite = asOptionalString(object.value.suite, "event.suite");
      const suiteRunId = asOptionalString(object.value.suiteRunId, "event.suiteRunId");
      const workerModel = asOptionalString(object.value.workerModel, "event.workerModel");
      const startedIssues = mergeIssues(dir, trial, variant, suite, suiteRunId, workerModel);
      if (startedIssues.length > 0) return failIssues(startedIssues);
      return ok({
        type: "run_started",
        timestamp: timestamp.value,
        dir: dir.value,
        trial: trial.value,
        variant: variant.value,
        ...(suite.value ? { suite: suite.value } : {}),
        ...(suiteRunId.value ? { suiteRunId: suiteRunId.value } : {}),
        ...(workerModel.value ? { workerModel: workerModel.value } : {}),
      });
    }
    if (type.value === "run_progress") {
      const dir = asString(object.value.dir, "event.dir");
      const durationMs = asFiniteNumber(object.value.durationMs, "event.durationMs");
      const toolCount = asFiniteNumber(object.value.toolCount, "event.toolCount");
      const fileCount = asFiniteNumber(object.value.fileCount, "event.fileCount");
      const progressIssues = mergeIssues(dir, durationMs, toolCount, fileCount);
      if (progressIssues.length > 0) return failIssues(progressIssues);
      return ok({
        type: "run_progress",
        timestamp: timestamp.value,
        dir: dir.value,
        durationMs: durationMs.value,
        toolCount: toolCount.value,
        fileCount: fileCount.value,
      });
    }
    if (type.value === "run_completed") {
      const dir = asString(object.value.dir, "event.dir");
      const status = parseEvalRunStatus(object.value.status, "event.status");
      const overall = asOptionalFiniteNumber(object.value.overall, "event.overall");
      const durationMs = asFiniteNumber(object.value.durationMs, "event.durationMs");
      const completedIssues = mergeIssues(dir, status, overall, durationMs);
      if (completedIssues.length > 0) return failIssues(completedIssues);
      return ok({
        type: "run_completed",
        timestamp: timestamp.value,
        dir: dir.value,
        status: status.value,
        ...(overall.value !== undefined ? { overall: overall.value } : {}),
        durationMs: durationMs.value,
      });
    }
    return fail(`event.type "${type.value}" is not supported by this client`);
  },
  serialize(value) {
    return value;
  },
};

function arrayCodec<T>(entryCodec: JsonCodec<T>, label: string): JsonCodec<T[]> {
  return {
    parse(value) {
      if (!Array.isArray(value)) return fail(`${label} must be an array`);
      const parsed = value.map((entry, index) => prefixIssues(entryCodec.parse(entry), `${label}[${index}]`));
      const issues = mergeIssues(...parsed);
      if (issues.length > 0) return failIssues(issues);
      return ok(parsed.map((entry) => entry.value));
    },
    serialize(value) {
      return value.map((entry) => entryCodec.serialize(entry));
    },
  };
}

function prefixIssues<T>(result: ParseResult<T>, prefix: string): ParseResult<T> {
  return result.ok ? result : failIssues(result.issues.map((issue) => `${prefix}: ${issue}`));
}
