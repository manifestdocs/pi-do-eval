import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createBenchReport,
  createProfileBenchReport,
  type ProfileSuiteReport,
  printBenchComparison,
  updateBenchIndex,
  writeBenchReport,
} from "./bench.js";
import { captureEnvironment, generateRunId } from "./environment.js";
import { runJudge } from "./judge.js";
import { parseProjectEvalConfig } from "./load-config.js";
import { printAggregatedSummary, printSuiteComparison, printSummary, updateRunIndex, writeReport } from "./reporter.js";
import { runEval } from "./runner.js";
import { scoreSession } from "./scorer.js";
import { loadFileSuites, type SuiteDefinition } from "./suite-files.js";
import {
  compareSuiteReports,
  createSuiteReport,
  listSuiteModels,
  loadLatestSuiteReport,
  loadPreviousSuiteReport,
  updateSuiteIndex,
  writeSuiteReport,
} from "./suites.js";
import { listTrialNames, readTrialManifest } from "./trial-manifest.js";
import type {
  AgentSnapshot,
  BenchConfig,
  EvalPlugin,
  EvalPluginConfigureContext,
  EvalReport,
  ExecutionProfile,
  JudgeResult,
  ModelConfig,
  ProfileSetupLayer,
  ProjectEvalConfig,
  SuiteReport,
  TrialManifest,
  TrialVariant,
} from "./types.js";
import { defaultVerify } from "./verifier.js";

export interface ProjectCommandOptions {
  projectPath?: string;
  profile?: string;
  variant?: string;
  noJudge?: boolean;
  model?: string;
  provider?: string;
}

export interface ProjectRunResult {
  report: EvalReport;
  runDir: string;
}

interface ProjectContext {
  evalDir: string;
  projectRoot: string;
  config: ProjectEvalConfig;
  suites: SuiteDefinition[];
  runsDir: string;
}

interface RunTrialOptions {
  profile?: ExecutionProfile;
  variant?: string;
  suite?: string;
  suiteRunId?: string;
  epoch?: number;
  totalEpochs?: number;
  noJudge?: boolean;
  worker?: ModelConfig;
}

function resolveEvalDir(inputPath?: string): string {
  const start = path.resolve(expandHome(inputPath ?? process.cwd()));
  const candidates = [start, path.join(start, "eval")];
  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isDirectory() &&
      fs.existsSync(path.join(candidate, "eval.config.ts")) &&
      fs.existsSync(path.join(candidate, "trials"))
    ) {
      return fs.realpathSync(candidate);
    }
  }
  throw new Error(`Could not find an eval project at ${inputPath ?? process.cwd()}`);
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function fileUrl(filePath: string): string {
  return `${pathToFileURL(filePath).href}?mtime=${fs.statSync(filePath).mtimeMs}`;
}

async function loadProjectConfig(evalDir: string): Promise<ProjectEvalConfig> {
  const configPath = path.join(evalDir, "eval.config.ts");
  if (!fs.existsSync(configPath)) return {};
  const mod = (await import(fileUrl(configPath))) as { default?: unknown };
  if (mod.default === undefined || mod.default === null) return {};
  const parsed = parseProjectEvalConfig(mod.default, configPath);
  if (!parsed.ok) throw new Error(parsed.issues.join("; "));
  return parsed.value;
}

async function loadContext(projectPath?: string): Promise<ProjectContext> {
  const evalDir = resolveEvalDir(projectPath);
  const projectRoot = path.basename(evalDir) === "eval" ? path.dirname(evalDir) : evalDir;
  const config = await loadProjectConfig(evalDir);
  const runsDir = config.runsDir ? path.resolve(evalDir, config.runsDir) : path.join(evalDir, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  return { evalDir, projectRoot, config, suites: loadFileSuites(evalDir), runsDir };
}

async function loadPlugin(
  ctx: ProjectContext,
  name: string,
  manifest: TrialManifest,
  variantName: string,
  variant: TrialVariant,
): Promise<EvalPlugin> {
  const pluginPath = path.join(ctx.evalDir, "plugins", `${name}.ts`);
  if (!fs.existsSync(pluginPath)) throw new Error(`Plugin not found for trial: ${pluginPath}`);
  const mod = (await import(fileUrl(pluginPath))) as { default?: EvalPlugin };
  if (!mod.default) throw new Error(`Plugin ${name} does not export a default EvalPlugin`);
  const stacks = (variant as { stacks?: unknown }).stacks;
  const taskCount = manifest.taskCount;
  const context: EvalPluginConfigureContext = {
    manifest,
    variantName,
    variant,
    isMonorepo: Array.isArray(stacks) && stacks.length > 1,
    ...(taskCount !== undefined ? { taskCount } : {}),
  };
  mod.default.configure?.(context);
  return mod.default;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function profileDisplayName(profile: ExecutionProfile): string {
  return profile.label || profile.id;
}

function profileWorkerSnapshot(profile: ExecutionProfile): ModelConfig {
  return {
    ...((profile.agent.provider ?? profile.factors.provider)
      ? { provider: profile.agent.provider ?? String(profile.factors.provider) }
      : {}),
    ...((profile.agent.model ?? profile.factors.model)
      ? { model: profile.agent.model ?? String(profile.factors.model) }
      : {}),
    ...(profile.agent.thinking ? { thinking: profile.agent.thinking } : {}),
  };
}

function profileRuntimeAgent(profile: ExecutionProfile, evalDir: string): ExecutionProfile["agent"] {
  const pluginMarketplaces =
    profile.setup?.layers
      ?.filter((layer) => layer.kind === "plugin" && (layer.mode ?? "install") === "install")
      .map((layer) => resolveMarketplaceLayerSource(layer, evalDir)) ?? [];
  if (pluginMarketplaces.length === 0) return profile.agent;
  return {
    ...profile.agent,
    codex: {
      ...profile.agent.codex,
      pluginMarketplaces: [...(profile.agent.codex?.pluginMarketplaces ?? []), ...pluginMarketplaces],
    },
  };
}

function resolveLayerSource(layer: ProfileSetupLayer, evalDir: string): string {
  if (!layer.source) throw new Error(`Layer "${layer.id}" is missing a source path`);
  const source = path.isAbsolute(layer.source) ? layer.source : path.resolve(evalDir, layer.source);
  if (!fs.existsSync(source)) throw new Error(`Layer "${layer.id}" source does not exist: ${source}`);
  return source;
}

function resolveMarketplaceLayerSource(layer: ProfileSetupLayer, evalDir: string): string {
  if (!layer.source) throw new Error(`Layer "${layer.id}" is missing a source path`);
  if (path.isAbsolute(layer.source) || layer.source.startsWith(".")) return path.resolve(evalDir, layer.source);
  return layer.source;
}

function defaultLayerTarget(layer: ProfileSetupLayer): string {
  if (layer.kind === "skill-library") return path.join(".codex", "skills");
  throw new Error(`Layer "${layer.id}" requires target because kind "${layer.kind}" has no default`);
}

function resolveLayerTarget(workDir: string, layer: ProfileSetupLayer): string {
  const target = layer.target ?? defaultLayerTarget(layer);
  const resolved = path.resolve(workDir, target);
  const relative = path.relative(workDir, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Layer "${layer.id}" target escapes workDir: ${target}`);
  }
  return resolved;
}

function copyLayer(source: string, target: string): void {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function symlinkLayer(source: string, target: string): void {
  if (fs.existsSync(target)) throw new Error(`Cannot symlink layer because target already exists: ${target}`);
  const stat = fs.statSync(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(source, target, stat.isDirectory() ? "dir" : "file");
}

function prepareProfileWorkDir(evalDir: string, profile: ExecutionProfile | undefined, workDir: string): void {
  const layers = profile?.setup?.layers ?? [];
  for (const layer of layers) {
    const mode = layer.mode ?? (layer.kind === "plugin" ? "install" : "copy");
    if (layer.kind === "plugin" && mode === "install") {
      const source = resolveMarketplaceLayerSource(layer, evalDir);
      console.log(`  Layer: ${layer.id} -> Codex marketplace ${source} (install)`);
      continue;
    }
    if (mode !== "copy" && mode !== "symlink")
      throw new Error(`Layer "${layer.id}" uses unsupported setup mode: ${mode}`);
    const source = resolveLayerSource(layer, evalDir);
    const target = resolveLayerTarget(workDir, layer);
    if (mode === "copy") copyLayer(source, target);
    if (mode === "symlink") symlinkLayer(source, target);
    console.log(`  Layer: ${layer.id} -> ${path.relative(workDir, target)} (${mode})`);
  }
}

function getProfile(ctx: ProjectContext, profileId: string): ExecutionProfile {
  const profile = ctx.config.profiles?.[profileId];
  if (!profile)
    throw new Error(`Unknown profile "${profileId}". Available: ${Object.keys(ctx.config.profiles ?? {}).join(", ")}`);
  if (profile.id !== profileId) throw new Error(`Profile key "${profileId}" must match profile.id "${profile.id}"`);
  return profile;
}

function getSuite(ctx: ProjectContext, suiteName: string): SuiteDefinition {
  const suite = ctx.suites.find((entry) => entry.name === suiteName);
  if (!suite)
    throw new Error(`Unknown suite "${suiteName}". Available: ${ctx.suites.map((entry) => entry.name).join(", ")}`);
  return suite;
}

function getBench(ctx: ProjectContext, suiteName: string): BenchConfig {
  const bench = ctx.config.benches?.[suiteName];
  if (!bench)
    throw new Error(
      `Unknown bench suite "${suiteName}". Available: ${Object.keys(ctx.config.benches ?? {}).join(", ")}`,
    );
  if (bench.profiles.length === 0) throw new Error(`Bench "${suiteName}" must list at least one profile`);
  if (new Set(bench.profiles).size !== bench.profiles.length)
    throw new Error(`Bench "${suiteName}" contains duplicate profile ids`);
  if (bench.profiles.length > 1 && !bench.baseline)
    throw new Error(`Bench "${suiteName}" must set baseline when comparing multiple profiles`);
  if (bench.baseline && !bench.profiles.includes(bench.baseline))
    throw new Error(`Bench "${suiteName}" baseline must be one of its profiles`);
  return bench;
}

function defaultProfileId(ctx: ProjectContext): string | undefined {
  return ctx.config.defaultProfile ?? Object.keys(ctx.config.profiles ?? {})[0];
}

function buildRunWorker(ctx: ProjectContext, options: ProjectCommandOptions): ModelConfig {
  return {
    ...ctx.config.worker,
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
  };
}

function taskFileFor(manifest: TrialManifest): string {
  return manifest.taskFile ?? "task.md";
}

function defaultPrompt(taskDescription: string, taskFile: string): string {
  return [`Implement the task in ${taskFile}.`, "", taskDescription.trim()].join("\n");
}

function stageTaskFile(trialDir: string, workDir: string, taskFile: string): void {
  const source = path.join(trialDir, taskFile);
  if (!fs.existsSync(source)) return;
  const target = path.join(workDir, taskFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

async function runProjectTrial(
  ctx: ProjectContext,
  trialName: string,
  options: RunTrialOptions,
): Promise<ProjectRunResult> {
  const manifest = readTrialManifest(ctx.evalDir, trialName);
  const variantName = options.variant ?? "default";
  const variant = manifest.variants[variantName];
  if (!variant)
    throw new Error(
      `Unknown variant "${variantName}" for ${trialName}. Available: ${Object.keys(manifest.variants).join(", ")}`,
    );
  if (manifest.enabled === false) throw new Error(`Trial "${trialName}" is disabled`);

  const pluginName = manifest.plugin ?? ctx.config.defaultPlugin;
  if (!pluginName) throw new Error(`Trial "${trialName}" must set plugin or eval.config.ts defaultPlugin`);
  const plugin = await loadPlugin(ctx, pluginName, manifest, variantName, variant);

  const runId = generateRunId();
  const activeAgent = options.profile ? profileRuntimeAgent(options.profile, ctx.evalDir) : undefined;
  const activeWorker = options.profile ? profileWorkerSnapshot(options.profile) : (options.worker ?? ctx.config.worker);
  const agentSnapshot: AgentSnapshot = {
    ...(activeWorker ? { worker: activeWorker } : {}),
    ...(!options.noJudge && ctx.config.judge ? { judge: ctx.config.judge } : {}),
    ...(ctx.config.timeouts ? { timeouts: ctx.config.timeouts } : {}),
    ...(ctx.config.budgets ? { budgets: ctx.config.budgets } : {}),
    ...(options.totalEpochs !== undefined ? { epochs: options.totalEpochs } : {}),
    ...(ctx.config.regressions?.threshold !== undefined
      ? { regressionThreshold: ctx.config.regressions.threshold }
      : {}),
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runName = [
    timestamp,
    safeName(trialName),
    safeName(variantName),
    ...(options.profile ? [safeName(options.profile.id)] : []),
    runId,
  ].join("-");
  const runDir = path.join(ctx.runsDir, runName);
  const workDir = path.join(runDir, "workdir");
  const trialDir = path.join(ctx.evalDir, "trials", trialName);
  fs.mkdirSync(workDir, { recursive: true });

  const taskFile = taskFileFor(manifest);
  const taskPath = path.join(trialDir, taskFile);
  const taskDescription = fs.existsSync(taskPath) ? fs.readFileSync(taskPath, "utf-8") : "";
  const prompt =
    plugin.buildPrompt?.({
      evalDir: ctx.evalDir,
      trialDir,
      trialName,
      variantName,
      taskFile,
      taskDescription,
      manifest,
      variant,
      ...(options.profile ? { profile: options.profile } : {}),
    }) ?? defaultPrompt(taskDescription, taskFile);

  const prepareWorkDir = async (preparedWorkDir: string) => {
    stageTaskFile(trialDir, preparedWorkDir, taskFile);
    if (options.profile) prepareProfileWorkDir(ctx.evalDir, options.profile, preparedWorkDir);
  };

  const epochLabel =
    options.totalEpochs && options.totalEpochs > 1 ? ` [epoch ${options.epoch}/${options.totalEpochs}]` : "";
  console.log(`Running ${trialName}/${variantName}${epochLabel}`);
  console.log(`  Plugin: ${plugin.name}`);
  console.log(`  Work dir: ${workDir}`);
  if (options.profile) console.log(`  Profile: ${profileDisplayName(options.profile)}`);

  const result = await runEval({
    trialDir,
    workDir,
    prompt,
    extensionPath: plugin.extensionPath,
    plugin,
    timeoutMs: ctx.config.timeouts?.workerMs,
    inactivityMs: ctx.config.timeouts?.inactivityMs,
    provider: activeAgent?.provider ?? activeWorker?.provider,
    model: activeAgent?.model ?? activeWorker?.model,
    thinking: activeAgent?.thinking ?? activeWorker?.thinking,
    agent: activeAgent,
    prepareWorkDir,
    live: {
      runDir,
      runsDir: ctx.runsDir,
      meta: {
        runId,
        trial: trialName,
        variant: variantName,
        agentSnapshot,
        ...(options.suite ? { suite: options.suite, suiteRunId: options.suiteRunId } : {}),
        ...(options.epoch ? { epoch: options.epoch, totalEpochs: options.totalEpochs } : {}),
      },
    },
  });

  console.log(`  Worker: ${result.status} (exit ${result.exitCode})`);
  if (result.stderr) fs.writeFileSync(path.join(runDir, "stderr.txt"), result.stderr);
  fs.writeFileSync(path.join(runDir, "session.jsonl"), result.session.rawLines.join("\n"));

  await plugin.afterRun?.({
    evalDir: ctx.evalDir,
    runDir,
    workDir,
    trialName,
    variantName,
    manifest,
    variant,
    session: result.session,
  });

  const verify = plugin.verify ? plugin.verify(workDir) : defaultVerify();
  console.log(`  Verify: ${verify.passed ? "PASS" : "FAIL"}`);

  let judgeResult: JudgeResult | undefined;
  let judgeFailure: string | undefined;
  if (!options.noJudge) {
    console.log("  Judge: evaluating...");
    const judgeOutcome = await runJudge({
      workDir,
      prompt: plugin.buildJudgePrompt(taskDescription, workDir),
      timeoutMs: ctx.config.timeouts?.judgeMs,
      provider: ctx.config.judge?.provider,
      model: ctx.config.judge?.model,
      thinking: ctx.config.judge?.thinking,
    });
    if (judgeOutcome.ok) {
      judgeResult = judgeOutcome.result;
    } else {
      judgeFailure = judgeOutcome.reason;
      console.log(`  Judge: failed (${judgeFailure}), using deterministic scores only`);
    }
    if (judgeOutcome.stdout) fs.writeFileSync(path.join(runDir, "judge.stdout.txt"), judgeOutcome.stdout);
  }

  const scores = scoreSession({ session: result.session, verify, plugin, judgeResult, budgets: ctx.config.budgets });
  const pluginResult = plugin.scoreSession(result.session, verify);
  const findings = [
    ...scores.issues,
    ...pluginResult.findings,
    ...(verify.passed ? [] : ["Verification failed"]),
    ...(result.status === "completed" ? [] : [`Session ended with status: ${result.status}`]),
    ...(judgeResult?.findings ?? []),
    ...(judgeFailure ? [`Judge failed: ${judgeFailure}`] : []),
  ];

  const workerModel = result.session.modelInfo
    ? `${result.session.modelInfo.provider}/${result.session.modelInfo.model}`
    : (options.profile?.id ?? activeAgent?.model ?? activeWorker?.model ?? "default");
  const report: EvalReport = {
    meta: {
      runId,
      trial: trialName,
      variant: variantName,
      workerModel,
      ...(judgeResult && ctx.config.judge?.model ? { judgeModel: ctx.config.judge.model } : {}),
      startedAt: new Date(result.session.startTime).toISOString(),
      durationMs: result.session.endTime - result.session.startTime,
      status: result.status,
      verifyPassed: verify.passed,
      agentSnapshot,
      environment: captureEnvironment(),
      ...(options.suite ? { suite: options.suite, suiteRunId: options.suiteRunId } : {}),
      ...(options.epoch ? { epoch: options.epoch, totalEpochs: options.totalEpochs } : {}),
    },
    scores,
    ...(judgeResult ? { judgeResult } : {}),
    session: { ...result.session, rawLines: [] },
    findings,
  };

  writeReport(report, runDir);
  updateRunIndex(ctx.runsDir);
  printSummary(report);
  return { report, runDir: path.basename(runDir) };
}

async function runSuiteForProfile(
  ctx: ProjectContext,
  suiteName: string,
  profile: ExecutionProfile | undefined,
  options: { suiteRunId: string; label: string; epochs?: number; noJudge?: boolean; worker?: ModelConfig },
): Promise<ProfileSuiteReport | SuiteReport> {
  const suite = getSuite(ctx, suiteName);
  const globalEpochs = options.epochs ?? ctx.config.epochs ?? 1;
  const allResults: ProjectRunResult[] = [];
  let maxEpochs = 1;

  console.log(`\n=== ${options.label}${profile ? `: ${profileDisplayName(profile)}` : ""} ===\n`);
  for (const entry of suite.trials) {
    const epochs = globalEpochs;
    maxEpochs = Math.max(maxEpochs, epochs);
    for (let epoch = 1; epoch <= epochs; epoch++) {
      allResults.push(
        await runProjectTrial(ctx, entry.trial, {
          profile,
          variant: entry.variant,
          suite: suiteName,
          suiteRunId: options.suiteRunId,
          noJudge: options.noJudge,
          worker: options.worker,
          ...(epochs > 1 ? { epoch, totalEpochs: epochs } : {}),
        }),
      );
    }
  }

  const workerModel = profile?.id ?? allResults[0]?.report.meta.workerModel;
  const suiteReport = createSuiteReport(
    suiteName,
    options.suiteRunId,
    allResults,
    new Date().toISOString(),
    maxEpochs > 1 ? maxEpochs : undefined,
    workerModel,
  );

  if (!profile) {
    const previous = loadPreviousSuiteReport(ctx.runsDir, suiteName, options.suiteRunId, workerModel);
    if (previous) {
      const comparison = compareSuiteReports(suiteReport, previous, { threshold: ctx.config.regressions?.threshold });
      suiteReport.comparison = comparison;
      printSuiteComparison(comparison, workerModel);
      if (comparison.hasRegression) process.exitCode = 1;
    }
  }

  writeSuiteReport(suiteReport, ctx.runsDir);
  updateSuiteIndex(ctx.runsDir);
  if (suiteReport.aggregated) {
    const modelLabel = workerModel ? ` [${workerModel}]` : "";
    console.log(`\n--- Aggregated Results${modelLabel} ---`);
    for (const entry of suiteReport.aggregated) printAggregatedSummary(entry);
  }

  return profile ? { profile, report: suiteReport } : suiteReport;
}

export async function runProjectList(options: ProjectCommandOptions = {}): Promise<void> {
  const ctx = await loadContext(options.projectPath);
  console.log("Trials:");
  for (const trialName of listTrialNames(ctx.evalDir)) {
    const manifest = readTrialManifest(ctx.evalDir, trialName);
    const variants = Object.keys(manifest.variants).join(", ");
    const disabled = manifest.enabled === false ? " disabled" : "";
    console.log(`  ${trialName}${disabled}: ${manifest.description} -- variants: ${variants}`);
  }

  console.log("\nSuites:");
  for (const suite of ctx.suites) {
    const labels = suite.trials.map((entry) => `${entry.trial}/${entry.variant}`).join(", ");
    console.log(`  ${suite.name} (${suite.trials.length}): ${labels}`);
  }

  if (ctx.config.profiles && Object.keys(ctx.config.profiles).length > 0) {
    console.log("\nProfiles:");
    for (const profile of Object.values(ctx.config.profiles)) {
      console.log(`  ${profile.id}: ${profile.label} (${profile.factors.layers.length} layers)`);
    }
  }

  if (ctx.config.benches && Object.keys(ctx.config.benches).length > 0) {
    console.log("\nBenches:");
    for (const [suiteName, bench] of Object.entries(ctx.config.benches)) {
      const baseline = bench.baseline ? `, baseline=${bench.baseline}` : "";
      console.log(`  ${suiteName}: [${bench.profiles.join(", ")}]${baseline}`);
    }
  }
}

export async function runProjectTrialCommand(trialName: string, options: ProjectCommandOptions = {}): Promise<void> {
  const ctx = await loadContext(options.projectPath);
  const profile = options.profile ? getProfile(ctx, options.profile) : undefined;
  await runProjectTrial(ctx, trialName, {
    profile,
    variant: options.variant,
    noJudge: options.noJudge,
    worker: buildRunWorker(ctx, options),
  });
}

export async function runProjectRegressionCommand(
  suiteName: string,
  options: ProjectCommandOptions = {},
): Promise<void> {
  const ctx = await loadContext(options.projectPath);
  const profileId = options.profile ?? defaultProfileId(ctx);
  const profile = profileId ? getProfile(ctx, profileId) : undefined;
  const suiteRunId = `suite-${Date.now()}-${safeName(suiteName)}${profile ? `-${safeName(profile.id)}` : ""}`;
  await runSuiteForProfile(ctx, suiteName, profile, {
    suiteRunId,
    label: `Regression ${suiteName}`,
    noJudge: options.noJudge,
    worker: buildRunWorker(ctx, options),
  });
}

export async function runProjectBenchCommand(suiteName: string, options: ProjectCommandOptions = {}): Promise<void> {
  const ctx = await loadContext(options.projectPath);
  if (!ctx.config.benches?.[suiteName]) {
    await runProjectModelBenchCommand(suiteName, options);
    return;
  }
  const configuredBench = getBench(ctx, suiteName);
  const profiles = configuredBench.profiles.map((profileId) => getProfile(ctx, profileId));
  const benchRunId = `bench-${Date.now()}-${safeName(suiteName)}`;
  const benchStartedAt = new Date().toISOString();
  const profileReports: ProfileSuiteReport[] = [];

  for (const profile of profiles) {
    const suiteRunId = `suite-${Date.now()}-${safeName(suiteName)}-${safeName(profile.id)}`;
    const suiteReport = await runSuiteForProfile(ctx, suiteName, profile, {
      suiteRunId,
      label: `Bench ${suiteName}`,
      ...(configuredBench.epochs !== undefined ? { epochs: configuredBench.epochs } : {}),
      noJudge: options.noJudge,
    });
    profileReports.push(suiteReport as ProfileSuiteReport);
  }

  const benchReport = createProfileBenchReport(
    suiteName,
    benchRunId,
    profileReports,
    benchStartedAt,
    new Date().toISOString(),
    configuredBench.baseline,
  );
  printBenchComparison(benchReport);
  writeBenchReport(benchReport, ctx.runsDir);
  updateBenchIndex(ctx.runsDir);
}

export async function runProjectModelBenchCommand(
  suiteName: string,
  options: ProjectCommandOptions = {},
): Promise<void> {
  const ctx = await loadContext(options.projectPath);
  getSuite(ctx, suiteName);
  const modelsToRun = ctx.config.models ?? [];
  const suiteReportsMap = new Map<string, SuiteReport>();
  const benchRunId = `bench-${Date.now()}`;
  const benchStartedAt = new Date().toISOString();

  for (const [index, model] of modelsToRun.entries()) {
    const modelLabel = model.provider ? `${model.provider}/${model.model}` : (model.model ?? "default");
    const suiteRunId = `suite-${Date.now()}-${index}`;
    const suiteReport = (await runSuiteForProfile(ctx, suiteName, undefined, {
      suiteRunId,
      label: `Bench ${suiteName}: ${modelLabel}`,
      noJudge: options.noJudge,
      worker: model,
    })) as SuiteReport;
    suiteReportsMap.set(suiteReport.workerModel ?? modelLabel, suiteReport);
  }

  for (const model of listSuiteModels(ctx.runsDir, suiteName)) {
    if (suiteReportsMap.has(model)) continue;
    const report = loadLatestSuiteReport(ctx.runsDir, suiteName, model);
    if (report) suiteReportsMap.set(model, report);
  }
  if (suiteReportsMap.size === 0)
    throw new Error(`No suite runs found. Run a regression first with: do-eval regression ${suiteName}`);

  const benchReport = createBenchReport(suiteName, benchRunId, suiteReportsMap, benchStartedAt);
  printBenchComparison(benchReport);
  writeBenchReport(benchReport, ctx.runsDir);
  updateBenchIndex(ctx.runsDir);
}
