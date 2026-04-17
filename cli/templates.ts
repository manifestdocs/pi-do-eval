/** Template functions for `pi-do-eval init`. Each returns the file content as a string. */

export function packageJson(extensionName: string, piDoEvalRef: string): string {
  return JSON.stringify(
    {
      name: `${extensionName}-eval`,
      version: "0.1.0",
      description: `Eval suite for ${extensionName}`,
      type: "module",
      scripts: {
        eval: "bun eval.ts",
        test: "vitest run",
        view: "bun eval.ts view",
      },
      dependencies: {
        "pi-do-eval": piDoEvalRef,
      },
      devDependencies: {
        "@types/node": "^25.6.0",
        typescript: "^5.7.0",
        vitest: "^3.2.1",
      },
    },
    null,
    2,
  );
}

export function tsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022"],
        module: "Node16",
        moduleResolution: "Node16",
        strict: true,
        noUncheckedIndexedAccess: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["eval.ts", "plugins", "trials", "test"],
    },
    null,
    2,
  );
}

export function gitignore(): string {
  return `node_modules/
runs/
index.html
`;
}

export function types(): string {
  return `export interface TestStack {
  language: string;
  testFramework: string;
  scope?: string;
  setup?: string;
}

export interface VariantConfig {
  stacks: TestStack[] | TestStack;
}

export interface TrialConfig {
  name: string;
  description: string;
  taskFile: string;
  taskCount: number;
  scaffoldDir?: string;
  plugin: string;
  features: string[];
  variants: Record<string, VariantConfig>;
}

export function getStacks(variant: VariantConfig): TestStack[] {
  return Array.isArray(variant.stacks) ? variant.stacks : [variant.stacks];
}

export interface ModelConfig {
  provider?: string;
  model?: string;
  thinking?: string;
}

export interface SuiteEntry {
  trial: string;
  variant: string;
  epochs?: number;
}

export interface BudgetConfig {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxDurationMs?: number;
  maxToolCalls?: number;
  maxBlockedCalls?: number;
  maxFileWrites?: number;
}

export interface EvalConfig {
  worker?: ModelConfig;
  judge?: ModelConfig;
  models?: ModelConfig[];
  timeouts?: {
    workerMs?: number;
    inactivityMs?: number;
    judgeMs?: number;
  };
  epochs?: number;
  budgets?: BudgetConfig;
  suites?: Record<string, SuiteEntry[]>;
  runSets?: Record<string, SuiteEntry[]>;
  regressions?: {
    threshold?: number;
  };
}
`;
}

export function evalConfig(): string {
  return `import type { EvalConfig } from "./types.js";

const small = [{ trial: "example", variant: "default" }];

const config: EvalConfig = {
  worker: {
    // Omit to use Pi's default settings from ~/.pi/agent/settings.json
  },
  judge: {
    // Provider/model for the LLM judge
  },
  // models: [
  //   { provider: "anthropic", model: "claude-sonnet-4-5" },
  //   { provider: "openai", model: "gpt-4o" },
  // ],
  timeouts: {
    workerMs: 15 * 60 * 1000,
    inactivityMs: 2 * 60 * 1000,
    judgeMs: 2 * 60 * 1000,
  },
  // epochs: 3,  // Run each trial N times to measure stability on the same task
  // budgets: {
  //   maxTotalTokens: 100_000,
  //   maxDurationMs: 5 * 60 * 1000,
  //   maxToolCalls: 200,
  //   maxBlockedCalls: 0,
  // },
  suites: {
    small,
    quick: small,
  },
  regressions: {
    threshold: 3,
  },
};

export default config;
`;
}

export function evalScript(): string {
  return `import * as fs from "node:fs";
import * as path from "node:path";
import {
  compareSuiteReports,
  createBenchReport,
  createSuiteReport,
  defaultVerify,
  type EvalPlugin,
  type EvalReport,
  type JudgeResult,
  listSuiteModels,
  loadLatestSuiteReport,
  loadPreviousSuiteReport,
  parseSessionLines,
  printAggregatedSummary,
  printBenchComparison,
  printSuiteComparison,
  printSummary,
  runEval,
  runJudge,
  scoreSession,
  type SuiteReport,
  updateRunIndex,
  updateSuiteIndex,
  updateBenchIndex,
  writeBenchReport,
  writeReport,
  writeSuiteReport,
} from "pi-do-eval";

import { type EvalConfig, getStacks, type ModelConfig, type TrialConfig, type VariantConfig } from "./types.js";

const TRIALS_DIR = path.join(import.meta.dirname, "trials");
const PLUGINS_DIR = path.join(import.meta.dirname, "plugins");
const RUNS_DIR = path.join(import.meta.dirname, "runs");

async function loadConfig(trialName: string): Promise<TrialConfig> {
  const configPath = path.join(TRIALS_DIR, trialName, "config.ts");
  const mod = await import(configPath);
  return mod.default;
}

async function loadPlugin(pluginName: string, config: TrialConfig): Promise<EvalPlugin> {
  const pluginPath = path.join(PLUGINS_DIR, \`\${pluginName}.ts\`);
  const mod = await import(pluginPath);
  mod.configure?.({ taskCount: config.taskCount });
  return mod.default;
}

function listTrials(): string[] {
  return fs.readdirSync(TRIALS_DIR).filter((d) => {
    return (
      fs.statSync(path.join(TRIALS_DIR, d)).isDirectory() &&
      fs.existsSync(path.join(TRIALS_DIR, d, "config.ts"))
    );
  });
}

async function loadEvalConfig(): Promise<EvalConfig> {
  const configPath = path.join(import.meta.dirname, "eval.config.ts");
  if (!fs.existsSync(configPath)) return {};
  const mod = await import(configPath);
  return mod.default;
}

function buildPrompt(config: TrialConfig, variant: VariantConfig): string {
  const stacks = getStacks(variant);
  const stackInstructions = stacks.map((s) => {
    const prefix = s.scope ? \`For the \${s.scope}:\` : "";
    const core = \`Use \${s.language} with \${s.testFramework} for testing.\`;
    const parts = [prefix, core, s.setup ?? ""].filter(Boolean);
    return parts.join(" ");
  });
  return [\`Implement all user stories in the attached task. @\${config.taskFile}\`, ...stackInstructions, "Do not stop until the task is fully complete."].join(" ");
}

interface RunTrialOpts {
  noJudge?: boolean;
  worker?: ModelConfig;
  judge?: ModelConfig;
  timeouts?: EvalConfig["timeouts"];
  suite?: string;
  suiteRunId?: string;
  epoch?: number;
  totalEpochs?: number;
}

async function runTrial(trialName: string, variantName: string, opts: RunTrialOpts) {
  const config = await loadConfig(trialName);
  const variant = config.variants[variantName];
  if (!variant) {
    console.error(
      \`Unknown variant "\${variantName}" for \${trialName}. Available: \${Object.keys(config.variants).join(", ")}\`,
    );
    process.exit(1);
  }

  const plugin = await loadPlugin(config.plugin, config);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runName = \`\${timestamp}-\${trialName}-\${variantName}\`;
  const workDir = path.join(RUNS_DIR, runName, "workdir");
  const runDir = path.join(RUNS_DIR, runName);
  fs.mkdirSync(workDir, { recursive: true });

  const stackLabel = getStacks(variant)
    .map((s) => \`\${s.language}/\${s.testFramework}\`)
    .join(", ");
  const epochLabel = opts.totalEpochs && opts.totalEpochs > 1 ? \` [epoch \${opts.epoch}/\${opts.totalEpochs}]\` : "";
  console.log(\`Running \${trialName}/\${variantName} (\${stackLabel})\${epochLabel}\`);
  console.log(\`  Plugin: \${plugin.name}\`);
  console.log(\`  Work dir: \${workDir}\`);

  const prompt = buildPrompt(config, variant);
  const trialDir = path.join(TRIALS_DIR, trialName);

  const result = await runEval({
    trialDir,
    workDir,
    prompt,
    extensionPath: plugin.extensionPath,
    plugin,
    timeoutMs: opts.timeouts?.workerMs,
    inactivityMs: opts.timeouts?.inactivityMs,
    provider: opts.worker?.provider,
    model: opts.worker?.model,
    thinking: opts.worker?.thinking,
    live: {
      runDir,
      runsDir: RUNS_DIR,
      meta: {
        trial: trialName,
        variant: variantName,
        ...(opts.suite ? { suite: opts.suite, suiteRunId: opts.suiteRunId } : {}),
        ...(opts.epoch ? { epoch: opts.epoch, totalEpochs: opts.totalEpochs } : {}),
      },
    },
  });

  console.log(\`  Worker: \${result.status} (exit \${result.exitCode})\`);
  if (result.stderr) fs.writeFileSync(path.join(runDir, "stderr.txt"), result.stderr);
  fs.writeFileSync(path.join(runDir, "session.jsonl"), result.session.rawLines.join("\\n"));

  const session = parseSessionLines(result.session.rawLines, plugin);
  session.exitCode = result.exitCode;

  const verify = plugin.verify ? plugin.verify(workDir) : defaultVerify();
  console.log(\`  Verify: \${verify.passed ? "PASS" : "FAIL"}\`);

  let judgeResult: JudgeResult | undefined;
  let judgeFailure: string | undefined;
  if (!opts.noJudge) {
    const taskPath = path.join(workDir, config.taskFile);
    if (fs.existsSync(taskPath)) {
      console.log("  Judge: evaluating...");
      const taskDescription = fs.readFileSync(taskPath, "utf-8");
      const judgePrompt = plugin.buildJudgePrompt(taskDescription, workDir);
      const judgeOutcome = await runJudge({
        workDir,
        prompt: judgePrompt,
        timeoutMs: opts.timeouts?.judgeMs,
        provider: opts.judge?.provider,
        model: opts.judge?.model,
        thinking: opts.judge?.thinking,
      });
      if (judgeOutcome.ok) {
        judgeResult = judgeOutcome.result;
        for (const [key, value] of Object.entries(judgeResult.scores)) {
          const reason = judgeResult.reasons[key] ?? "";
          console.log(\`  Judge: \${key} = \${value}\${reason ? \` - \${reason}\` : ""}\`);
        }
        if (judgeResult.findings.length > 0) {
          for (const f of judgeResult.findings) console.log(\`  Judge finding: \${f}\`);
        }
      } else {
        judgeFailure = judgeOutcome.reason;
        console.log(\`  Judge: failed (\${judgeFailure}), using deterministic scores only\`);
        if (judgeOutcome.stdout) {
          fs.writeFileSync(path.join(runDir, "judge.stdout.txt"), judgeOutcome.stdout);
        }
      }
    }
  }

  const scores = scoreSession({ session, verify, plugin, judgeResult, budgets: evalConfig.budgets });

  const findings: string[] = [];
  findings.push(...scores.issues);
  const pluginResult = plugin.scoreSession(session, verify);
  findings.push(...pluginResult.findings);
  if (!verify.passed) findings.push("Verification failed");
  if (result.status !== "completed") findings.push(\`Session ended with status: \${result.status}\`);
  if (judgeResult?.findings) findings.push(...judgeResult.findings);
  if (judgeFailure) findings.push(\`Judge failed: \${judgeFailure}\`);

  const workerModel = session.modelInfo
    ? \`\${session.modelInfo.provider}/\${session.modelInfo.model}\`
    : (opts.worker?.model ?? "default");
  const judgeModel = opts.judge?.model ?? "default";

  const report: EvalReport = {
    meta: {
      trial: trialName,
      variant: variantName,
      workerModel,
      ...(judgeResult ? { judgeModel } : {}),
      startedAt: new Date(session.startTime).toISOString(),
      durationMs: session.endTime - session.startTime,
      status: result.status,
      verifyPassed: verify.passed,
      ...(opts.suite ? { suite: opts.suite, suiteRunId: opts.suiteRunId } : {}),
      ...(opts.epoch ? { epoch: opts.epoch, totalEpochs: opts.totalEpochs } : {}),
    },
    scores,
    ...(judgeResult ? { judgeResult } : {}),
    session: { ...session, rawLines: [] },
    findings,
  };

  writeReport(report, runDir);
  updateRunIndex(RUNS_DIR);
  printSummary(report);

  return { report, runDir: path.basename(runDir) };
}

// -- CLI -----------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(\`--\${name}\`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function getAllFlags(name: string): string[] {
  const out: string[] = [];
  const flag = \`--\${name}\`;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) out.push(args[++i]!);
  }
  return out;
}

function hasFlag(name: string): boolean {
  return args.includes(\`--\${name}\`);
}

const evalConfig = await loadEvalConfig();
const configuredSuites = {
  ...(evalConfig.runSets ?? {}),
  ...(evalConfig.suites ?? {}),
};

function buildRunOpts(workerOverride?: ModelConfig): RunTrialOpts {
  const worker: ModelConfig = { ...evalConfig.worker, ...workerOverride };
  if (!workerOverride) {
    const modelFlag = getFlag("model");
    const providerFlag = getFlag("provider");
    if (modelFlag) worker.model = modelFlag;
    if (providerFlag) worker.provider = providerFlag;
  }
  return {
    noJudge: hasFlag("no-judge"),
    worker,
    judge: evalConfig.judge,
    timeouts: evalConfig.timeouts,
  };
}

if (command === "list") {
  const trials = listTrials();
  for (const t of trials) {
    const config = await loadConfig(t);
    const variants = Object.keys(config.variants).join(", ");
    console.log(\`\${t} [\${config.plugin}] (\${config.taskCount} tasks) -- variants: \${variants}\`);
  }

  if (Object.keys(configuredSuites).length > 0) {
    console.log("\\nSuites:");
    for (const [name, entries] of Object.entries(configuredSuites)) {
      const labels = entries.map((e) => \`\${e.trial}/\${e.variant}\`).join(", ");
      console.log(\`  \${name} (\${entries.length}): \${labels}\`);
    }
  }
} else if (command === "run") {
  const trial = getFlag("trial");
  const variant = getFlag("variant");
  const setName = args[1] && !args[1].startsWith("--") ? args[1] : undefined;

  if (trial && variant) {
    await runTrial(trial, variant, buildRunOpts());
  } else if (setName) {
    const entries = configuredSuites[setName];
    if (!entries) {
      const available = Object.keys(configuredSuites).join(", ");
      console.error(\`Unknown suite "\${setName}". Available: \${available}\`);
      process.exit(1);
    }

    const suiteRunId = \`suite-\${Date.now()}\`;
    const globalEpochs = evalConfig.epochs ?? 1;
    const allResults: Array<{ report: EvalReport; runDir: string }> = [];
    let maxEpochs = 1;

    for (const entry of entries) {
      const epochs = entry.epochs ?? globalEpochs;
      if (epochs > maxEpochs) maxEpochs = epochs;
      for (let e = 1; e <= epochs; e++) {
        const result = await runTrial(entry.trial, entry.variant, {
          ...buildRunOpts(),
          suite: setName,
          suiteRunId,
          ...(epochs > 1 ? { epoch: e, totalEpochs: epochs } : {}),
        });
        allResults.push(result);
      }
    }

    const suiteWorkerModel = allResults[0]?.report.meta.workerModel;

    let comparison;
    const previous = loadPreviousSuiteReport(RUNS_DIR, setName, suiteRunId, suiteWorkerModel);

    // Create and write suite report
    const suiteReport = createSuiteReport(
      setName, suiteRunId, allResults,
      new Date().toISOString(),
      maxEpochs > 1 ? maxEpochs : undefined,
      suiteWorkerModel,
    );

    if (previous) {
      comparison = compareSuiteReports(
        suiteReport, previous,
        { threshold: evalConfig.regressions?.threshold },
      );
      suiteReport.comparison = comparison;
    }

    writeSuiteReport(suiteReport, RUNS_DIR);
    updateSuiteIndex(RUNS_DIR);

    // Print aggregated summaries when epochs > 1
    if (suiteReport.aggregated) {
      const modelLabel = suiteWorkerModel ? \` [\${suiteWorkerModel}]\` : "";
      console.log(\`\\n--- Aggregated Results\${modelLabel} ---\`);
      for (const agg of suiteReport.aggregated) {
        printAggregatedSummary(agg);
      }
    }

    // Compare with previous suite run
    if (comparison) {
      printSuiteComparison(comparison, suiteWorkerModel);
      if (comparison.hasRegression) {
        process.exit(1);
      }
    }
  } else {
    console.error("Usage: eval run <suite-name>  OR  eval run --trial <t> --variant <v>");
    process.exit(1);
  }
} else if (command === "run-all") {
  const trials = listTrials();
  for (const t of trials) {
    const config = await loadConfig(t);
    for (const v of Object.keys(config.variants)) {
      await runTrial(t, v, buildRunOpts());
    }
  }
} else if (command === "bench") {
  const suiteName = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  if (!suiteName) {
    console.error("Usage: eval bench <suite> [--model <model>...]");
    process.exit(1);
  }
  const entries = configuredSuites[suiteName];
  if (!entries) {
    const available = Object.keys(configuredSuites).join(", ");
    console.error(\`Unknown suite "\${suiteName}". Available: \${available}\`);
    process.exit(1);
  }

  function parseModelFlag(value: string): ModelConfig {
    const slashIdx = value.indexOf("/");
    if (slashIdx > 0) return { provider: value.slice(0, slashIdx), model: value.slice(slashIdx + 1) };
    return { model: value };
  }

  const cliModels = getAllFlags("model").map(parseModelFlag);
  const modelsToRun = cliModels.length > 0 ? cliModels : (evalConfig.models ?? []);

  const globalEpochs = evalConfig.epochs ?? 1;
  const benchRunId = \`bench-\${Date.now()}\`;
  const benchStartedAt = new Date().toISOString();
  const suiteReportsMap = new Map<string, SuiteReport>();

  // Run any models that were requested
  for (let mi = 0; mi < modelsToRun.length; mi++) {
    const m = modelsToRun[mi]!;
    const modelLabel = m.provider ? \`\${m.provider}/\${m.model}\` : (m.model ?? "default");
    console.log(\`\\n=== Benchmarking with \${modelLabel} ===\\n\`);

    const suiteRunId = \`suite-\${Date.now()}-\${mi}\`;
    const allResults: Array<{ report: EvalReport; runDir: string }> = [];
    let maxEpochs = 1;

    for (const entry of entries) {
      const epochs = entry.epochs ?? globalEpochs;
      if (epochs > maxEpochs) maxEpochs = epochs;
      for (let e = 1; e <= epochs; e++) {
        const result = await runTrial(entry.trial, entry.variant, {
          ...buildRunOpts({ provider: m.provider, model: m.model }),
          suite: suiteName,
          suiteRunId,
          ...(epochs > 1 ? { epoch: e, totalEpochs: epochs } : {}),
        });
        allResults.push(result);
      }
    }

    const suiteWorkerModel = allResults[0]?.report.meta.workerModel ?? modelLabel;
    const previous = loadPreviousSuiteReport(RUNS_DIR, suiteName, suiteRunId, suiteWorkerModel);

    const suiteReport = createSuiteReport(
      suiteName, suiteRunId, allResults,
      new Date().toISOString(),
      maxEpochs > 1 ? maxEpochs : undefined,
      suiteWorkerModel,
    );

    if (previous) {
      const comparison = compareSuiteReports(
        suiteReport, previous,
        { threshold: evalConfig.regressions?.threshold },
      );
      suiteReport.comparison = comparison;
    }

    writeSuiteReport(suiteReport, RUNS_DIR);
    updateSuiteIndex(RUNS_DIR);
    suiteReportsMap.set(suiteWorkerModel, suiteReport);
  }

  // Load latest suite reports for any models not just run (from prior runs)
  for (const model of listSuiteModels(RUNS_DIR, suiteName)) {
    if (suiteReportsMap.has(model)) continue;
    const report = loadLatestSuiteReport(RUNS_DIR, suiteName, model);
    if (report) suiteReportsMap.set(model, report);
  }

  if (suiteReportsMap.size === 0) {
    console.error("No suite runs found. Run the suite first with: eval run <suite> --model <model>");
    process.exit(1);
  }

  // Build and print cross-model comparison
  const benchReport = createBenchReport(suiteName, benchRunId, suiteReportsMap, benchStartedAt);
  printBenchComparison(benchReport);
  writeBenchReport(benchReport, RUNS_DIR);
  updateBenchIndex(RUNS_DIR);
} else if (command === "view") {
  const port = process.env.EVAL_PORT || "4242";
  // Resolve package root: export points to src/lib/eval/index.ts, go up 3 dirs.
  const piDoEvalDir = path.resolve(import.meta.resolve("pi-do-eval").replace("file://", ""), "../../..");
  const { spawn } = await import("node:child_process");
  const cliEntry = path.join(piDoEvalDir, "cli", "index.ts");
  const preview = spawn("bun", [cliEntry, "ui", "--project", process.cwd(), "--port", port], {
    cwd: piDoEvalDir,
    stdio: "inherit",
    env: { ...process.env },
  });
  preview.on("exit", (code) => process.exit(code ?? 0));
} else {
  console.log("Eval suite");
  console.log("");
  console.log("Usage:");
  console.log("  eval list                                List trials, variants, and suites");
  console.log("  eval run <suite>                         Run a named suite from eval.config.ts");
  console.log("  eval run --trial <t> --variant <v>       Run a single trial/variant");
  console.log("  eval run-all                             Run all trials and variants");
  console.log("  eval bench <suite>                       Compare latest runs per model");
  console.log("  eval bench <suite> --model X --model Y   Run models then compare");
  console.log("  eval view                                Start the eval viewer with launcher");
  console.log("");
  console.log("Options:");
  console.log("  --no-judge                  Skip LLM judge (deterministic only)");
  console.log("  --model <model>             Override worker model (repeatable for bench)");
  console.log("  --provider <provider>        Override worker provider");
}
`;
}

export function pluginSkeleton(extensionName: string, extensionPath: string): string {
  return `import * as path from "node:path";
import type { EvalPlugin, EvalSession, VerifyResult } from "pi-do-eval";

// extensionPath is stored relative to eval/, so resolve from the plugin file back through eval/.
const EXTENSION_PATH = path.resolve(import.meta.dirname, "..", "${extensionPath}");

const plugin: EvalPlugin = {
  name: "${extensionName}",
  extensionPath: EXTENSION_PATH,

  classifyFile(filePath) {
    if (filePath.includes(".test.") || filePath.includes("_test.")) return "test";
    if (/package\\.json$|tsconfig|\\.gitignore$/.test(filePath)) return "config";
    return "source";
  },

  parseEvent(_toolName, _resultText, _timestamp) {
    // Extract domain-specific events from tool call results.
    // Return PluginEvent[] for events your extension emits.
    return [];
  },

  verify(_workDir) {
    // Run independent verification (e.g. execute tests, lint check).
    // Return { passed, output, metrics }.
    return { passed: true, output: "Verification not implemented", metrics: {} };
  },

  scoreSession(session, verify) {
    const scores: Record<string, number> = {};
    const weights: Record<string, number> = {};
    const findings: string[] = [];

    scores.correctness = verify.passed ? 100 : 0;
    weights.correctness = 0.5;

    const fileCount = session.fileWrites.length;
    scores.productivity = Math.min(100, fileCount * 10);
    weights.productivity = 0.2;

    return { scores, weights, findings };
  },

  buildJudgePrompt(taskDescription, workDir) {
    return [
      "Evaluate the implementation quality. Respond with ONLY a JSON object.",
      "",
      "## Task",
      taskDescription,
      "",
      "## Evaluation Criteria",
      "Score each dimension 0-100:",
      '- "quality": Overall implementation quality',
      '- "quality_reason": Brief explanation',
      '- "findings": Notable observations (string array)',
      "",
      "Respond with ONLY the JSON object.",
    ].join("\\n");
  },
};

export default plugin;
`;
}

export function trialConfig(pluginName: string): string {
  return `import type { TrialConfig } from "../../types.js";

const config: TrialConfig = {
  name: "example",
  description: "Example trial, replace with a real task",
  taskFile: "task.md",
  taskCount: 3,
  plugin: "${pluginName}",
  features: [],
  variants: {
    default: {
      stacks: { language: "TypeScript", testFramework: "vitest" },
    },
  },
};

export default config;
`;
}

export function taskMd(): string {
  return `# Example Task

Replace this with a real task description for your extension.

## User Stories

### US-1: First feature
- Description of what the agent should build
- Acceptance criteria

### US-2: Second feature
- Description of what the agent should build
- Acceptance criteria

### US-3: Third feature
- Description of what the agent should build
- Acceptance criteria
`;
}
