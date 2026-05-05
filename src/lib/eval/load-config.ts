import {
  asObject,
  asOptionalBoolean,
  asOptionalFiniteNumber,
  asOptionalString,
  fail,
  failIssues,
  isRecord,
  mergeIssues,
  ok,
  type ParseResult,
  withSuggestion,
} from "../contracts/codec.js";
import { parseBudgetConfig, parseOptionalAgentModel, parseProfileLayer, parseTimeouts } from "../contracts/domain.js";
import type { AgentRuntimeConfig } from "./harnesses/types.js";
import type {
  BenchConfig,
  ExecutionProfile,
  ExecutionProfileFactors,
  ModelConfig,
  ProfileSetup,
  ProfileSetupLayer,
  ProjectEvalConfig,
  WorkspaceConfig,
  WorkspaceProviderKind,
} from "./types.js";

const LAUNCH_TYPES = new Set(["suite", "trial", "bench"] as const);
const WORKSPACE_PROVIDERS = new Set(["local-fs", "agentfs-fuse"] as const);
const KNOWN_KEYS = new Set([
  "worker",
  "judge",
  "models",
  "timeouts",
  "epochs",
  "budgets",
  "profiles",
  "benches",
  "regressions",
  "defaultLaunchType",
  "defaultProfile",
  "defaultPlugin",
  "runsDir",
  "workspace",
]);

export function parseProjectEvalConfig(value: unknown, label = "eval.config.ts"): ParseResult<ProjectEvalConfig> {
  const object = asObject(value, label);
  if (!object.ok) return failIssues(object.issues);

  const unknownKeys = Object.keys(object.value).filter((key) => !KNOWN_KEYS.has(key));
  if (unknownKeys.includes("suites") || unknownKeys.includes("runSets")) {
    return fail(`${label}: define suites in eval/suites/*.yaml, not eval.config.ts suites/runSets`);
  }
  if (unknownKeys.length > 0) {
    return fail(`${label}: unknown key(s): ${unknownKeys.join(", ")}`);
  }

  const worker = parseOptionalModelConfig(object.value.worker, `${label}.worker`);
  const judge = parseOptionalModelConfig(object.value.judge, `${label}.judge`);
  const models = withSuggestion(
    parseOptionalModelArray(object.value.models, `${label}.models`),
    `${label}.models must be an array`,
    'set `models: [{ provider: "anthropic", model: "claude-..." }]`',
  );
  const timeouts = withSuggestion(
    parseTimeouts(object.value.timeouts, `${label}.timeouts`),
    `${label}.timeouts must be an object`,
    "set `timeouts: { workerMs: 900000 }` (15 min) or omit the key for defaults",
  );
  const epochs = asOptionalFiniteNumber(object.value.epochs, `${label}.epochs`);
  const budgets = withSuggestion(
    parseBudgetConfig(object.value.budgets, `${label}.budgets`),
    `${label}.budgets must be an object`,
    "set `budgets: { maxToolCalls: 200 }` (or another budget field) — see BudgetConfig for the full list",
  );
  const profiles = parseOptionalProfiles(object.value.profiles, `${label}.profiles`);
  const benches = parseOptionalBenches(object.value.benches, `${label}.benches`);
  const regressions = withSuggestion(
    parseRegressions(object.value.regressions, `${label}.regressions`),
    `${label}.regressions must be an object`,
    "set `regressions: { threshold: 3 }` or omit the key entirely",
  );
  const defaultLaunchType = parseOptionalLaunchType(object.value.defaultLaunchType, `${label}.defaultLaunchType`);
  const defaultProfile = asOptionalString(object.value.defaultProfile, `${label}.defaultProfile`);
  const defaultPlugin = asOptionalString(object.value.defaultPlugin, `${label}.defaultPlugin`);
  const runsDir = asOptionalString(object.value.runsDir, `${label}.runsDir`);
  const workspace = parseOptionalWorkspaceConfig(object.value.workspace, `${label}.workspace`);

  const issues = mergeIssues(
    worker,
    judge,
    models,
    timeouts,
    epochs,
    budgets,
    profiles,
    benches,
    regressions,
    defaultLaunchType,
    defaultProfile,
    defaultPlugin,
    runsDir,
    workspace,
  );
  if (issues.length > 0) return failIssues(issues);

  const result: ProjectEvalConfig = {};
  if (worker.value) result.worker = worker.value;
  if (judge.value) result.judge = judge.value;
  if (models.value) result.models = models.value;
  if (timeouts.value) result.timeouts = timeouts.value;
  if (epochs.value !== undefined) result.epochs = epochs.value;
  if (budgets.value) result.budgets = budgets.value;
  if (profiles.value) result.profiles = profiles.value;
  if (benches.value) result.benches = benches.value;
  if (regressions.value) result.regressions = regressions.value;
  if (defaultLaunchType.value) result.defaultLaunchType = defaultLaunchType.value;
  if (defaultProfile.value) result.defaultProfile = defaultProfile.value;
  if (defaultPlugin.value) result.defaultPlugin = defaultPlugin.value;
  if (runsDir.value) result.runsDir = runsDir.value;
  if (workspace.value) result.workspace = workspace.value;
  return ok(result);
}

function parseOptionalModelConfig(value: unknown, path: string): ParseResult<ModelConfig | undefined> {
  return parseOptionalAgentModel(value, path);
}

function parseOptionalModelArray(value: unknown, path: string): ParseResult<ModelConfig[] | undefined> {
  if (value === undefined) return ok(undefined);
  if (!Array.isArray(value)) return fail(`${path} must be an array`);
  const parsed = value.map((entry, index) => parseOptionalModelConfig(entry, `${path}[${index}]`));
  const issues = mergeIssues(...parsed);
  if (issues.length > 0) return failIssues(issues);
  return ok(parsed.flatMap((entry) => (entry.value ? [entry.value] : [])));
}

function parseOptionalProfiles(
  value: unknown,
  path: string,
): ParseResult<Record<string, ExecutionProfile> | undefined> {
  if (value === undefined) return ok(undefined);
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const result: Record<string, ExecutionProfile> = {};
  const issues: string[] = [];
  for (const [key, entry] of Object.entries(object.value)) {
    const parsed = parseExecutionProfile(entry, `${path}.${key}`, key);
    if (parsed.ok) result[key] = parsed.value;
    else issues.push(...parsed.issues);
  }
  return issues.length > 0 ? failIssues(issues) : ok(result);
}

function parseExecutionProfile(value: unknown, path: string, key: string): ParseResult<ExecutionProfile> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const idResult = asOptionalString(object.value.id, `${path}.id`);
  if (!idResult.ok) return failIssues(idResult.issues);
  const id = idResult.value ?? key;
  if (id !== key) {
    return fail(`${path}.id "${id}" must match key "${key}"`);
  }
  const labelResult = asOptionalString(object.value.label, `${path}.label`);
  if (!labelResult.ok) return failIssues(labelResult.issues);
  const label = labelResult.value ?? key;
  const agent = parseAgentRuntimeConfig(object.value.agent, `${path}.agent`);
  const factors = parseExecutionProfileFactors(object.value.factors, `${path}.factors`);
  const setup = parseOptionalProfileSetup(object.value.setup, `${path}.setup`);
  const issues = mergeIssues(agent, factors, setup);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    id,
    label,
    agent: agent.value,
    factors: factors.value,
    ...(setup.value ? { setup: setup.value } : {}),
  });
}

function parseAgentRuntimeConfig(value: unknown, path: string): ParseResult<AgentRuntimeConfig> {
  if (value === undefined) return ok({});
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  return ok(object.value as AgentRuntimeConfig);
}

function parseExecutionProfileFactors(value: unknown, path: string): ParseResult<ExecutionProfileFactors> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  if (!Array.isArray(object.value.layers)) {
    return fail(
      `${path}.layers must be an array\n  Suggestion: set \`layers: []\` for a baseline profile, or list layer descriptors`,
    );
  }
  const layers = object.value.layers.map((entry, index) => parseProfileLayer(entry, `${path}.layers[${index}]`));
  const issues = mergeIssues(...layers);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    ...object.value,
    layers: layers.map((entry) => entry.value),
  } as ExecutionProfileFactors);
}

function parseOptionalProfileSetup(value: unknown, path: string): ParseResult<ProfileSetup | undefined> {
  if (value === undefined) return ok(undefined);
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  if (object.value.layers === undefined) return ok({});
  if (!Array.isArray(object.value.layers)) return fail(`${path}.layers must be an array`);
  const layers: ProfileSetupLayer[] = [];
  const issues: string[] = [];
  for (const [index, entry] of object.value.layers.entries()) {
    const layer = parseProfileSetupLayer(entry, `${path}.layers[${index}]`);
    if (layer.ok) layers.push(layer.value);
    else issues.push(...layer.issues);
  }
  return issues.length > 0 ? failIssues(issues) : ok({ layers });
}

function parseProfileSetupLayer(value: unknown, path: string): ParseResult<ProfileSetupLayer> {
  const base = parseProfileLayer(value, path);
  if (!base.ok) return failIssues(base.issues);
  if (!isRecord(value)) return fail(`${path} must be an object`);
  const source = asOptionalString(value.source, `${path}.source`);
  const mode = asOptionalString(value.mode, `${path}.mode`);
  const target = asOptionalString(value.target, `${path}.target`);
  const issues = mergeIssues(source, mode, target);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    ...base.value,
    ...(source.value ? { source: source.value } : {}),
    ...(mode.value ? { mode: mode.value } : {}),
    ...(target.value ? { target: target.value } : {}),
  });
}

function parseOptionalBenches(value: unknown, path: string): ParseResult<Record<string, BenchConfig> | undefined> {
  if (value === undefined) return ok(undefined);
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const result: Record<string, BenchConfig> = {};
  const issues: string[] = [];
  for (const [key, entry] of Object.entries(object.value)) {
    const parsed = parseBenchConfig(entry, `${path}.${key}`);
    if (parsed.ok) result[key] = parsed.value;
    else issues.push(...parsed.issues);
  }
  return issues.length > 0 ? failIssues(issues) : ok(result);
}

function parseBenchConfig(value: unknown, path: string): ParseResult<BenchConfig> {
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  if (!Array.isArray(object.value.profiles)) {
    return fail(
      `${path}.profiles must be an array of strings\n  Suggestion: list profile ids defined in \`profiles\`, e.g. \`profiles: ["codexBaseline", "codexWithSkills"]\``,
    );
  }
  const profiles = object.value.profiles;
  if (!profiles.every((entry): entry is string => typeof entry === "string")) {
    return fail(`${path}.profiles must contain only strings (profile ids defined in \`profiles\`)`);
  }
  const baseline = asOptionalString(object.value.baseline, `${path}.baseline`);
  const epochs = asOptionalFiniteNumber(object.value.epochs, `${path}.epochs`);
  const reuseBaseline = asOptionalBoolean(object.value.reuseBaseline, `${path}.reuseBaseline`);
  const requireJudge = asOptionalBoolean(object.value.requireJudge, `${path}.requireJudge`);
  const requiredDeterministicScores = parseOptionalNumberRecord(
    object.value.requiredDeterministicScores,
    `${path}.requiredDeterministicScores`,
  );
  const issues = mergeIssues(baseline, epochs, reuseBaseline, requireJudge, requiredDeterministicScores);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    profiles,
    ...(baseline.value ? { baseline: baseline.value } : {}),
    ...(epochs.value !== undefined ? { epochs: epochs.value } : {}),
    ...(reuseBaseline.value !== undefined ? { reuseBaseline: reuseBaseline.value } : {}),
    ...(requireJudge.value !== undefined ? { requireJudge: requireJudge.value } : {}),
    ...(requiredDeterministicScores.value !== undefined
      ? { requiredDeterministicScores: requiredDeterministicScores.value }
      : {}),
  });
}

function parseOptionalNumberRecord(value: unknown, path: string): ParseResult<Record<string, number> | undefined> {
  if (value === undefined) return ok(undefined);
  if (!isRecord(value)) return fail(`${path} must be an object of metric names to finite numbers`);
  const result: Record<string, number> = {};
  const issues: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry)) result[key] = entry;
    else issues.push(`${path}.${key} must be a finite number`);
  }
  return issues.length > 0 ? failIssues(issues) : ok(result);
}

function parseRegressions(value: unknown, path: string): ParseResult<{ threshold?: number } | undefined> {
  if (value === undefined) return ok(undefined);
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const threshold = asOptionalFiniteNumber(object.value.threshold, `${path}.threshold`);
  if (!threshold.ok) return failIssues(threshold.issues);
  return ok(threshold.value !== undefined ? { threshold: threshold.value } : {});
}

function parseOptionalWorkspaceConfig(value: unknown, path: string): ParseResult<WorkspaceConfig | undefined> {
  if (value === undefined) return ok(undefined);
  const object = asObject(value, path);
  if (!object.ok) return failIssues(object.issues);
  const providerValue = object.value.provider;
  if (typeof providerValue !== "string" || !WORKSPACE_PROVIDERS.has(providerValue as WorkspaceProviderKind)) {
    return fail(`${path}.provider must be "local-fs" or "agentfs-fuse"`);
  }
  const root = asOptionalString(object.value.root, `${path}.root`);
  const agentfsCommand = asOptionalString(object.value.agentfsCommand, `${path}.agentfsCommand`);
  const mountTimeoutMs = asOptionalFiniteNumber(object.value.mountTimeoutMs, `${path}.mountTimeoutMs`);
  const issues = mergeIssues(root, agentfsCommand, mountTimeoutMs);
  if (issues.length > 0) return failIssues(issues);
  return ok({
    provider: providerValue as WorkspaceProviderKind,
    ...(root.value ? { root: root.value } : {}),
    ...(agentfsCommand.value ? { agentfsCommand: agentfsCommand.value } : {}),
    ...(mountTimeoutMs.value !== undefined ? { mountTimeoutMs: mountTimeoutMs.value } : {}),
  });
}

function parseOptionalLaunchType(value: unknown, path: string): ParseResult<"suite" | "trial" | "bench" | undefined> {
  if (value === undefined) return ok(undefined);
  if (typeof value !== "string" || !LAUNCH_TYPES.has(value as "suite" | "trial" | "bench")) {
    return fail(`${path} must be "suite", "trial", or "bench"`);
  }
  return ok(value as "suite" | "trial" | "bench");
}

export function projectEvalConfigOrThrow(value: unknown, label = "eval.config.ts"): ProjectEvalConfig {
  const result = parseProjectEvalConfig(value, label);
  if (!result.ok) throw new Error(result.issues.join("; "));
  return result.value;
}
