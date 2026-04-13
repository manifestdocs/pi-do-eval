# Pi, do Eval 😈😇

A library for building eval harnesses for [Pi](https://github.com/anthropics/pi) extensions. Pi is an AI coding agent; extensions customize its behavior for specific workflows. This library provides the building blocks (session parsing, scoring, judge orchestration, reporting) but does not run on its own. You write a script that imports from `pi-do-eval`, wires the pieces together, and defines what "good" looks like for your extension. No separate eval platform needed; evals run through your existing Pi setup using Pi itself as both the worker (running the extension under test) and the judge (evaluating output quality).

## How it works

1. Spawns `pi -p --mode json -e <extensionPath>` with the extension under test
2. Captures JSONL events: tool calls, file writes, plugin-specific state changes
3. After the session completes, the plugin optionally runs independent verification
4. Spawns `pi -p --mode json --no-extensions` as the judge to evaluate output quality
5. Plugin scores and judge scores are combined into a weighted final report

The eval prompt is deliberately minimal; the extension's system prompt must drive the behavior on its own.

## Getting started

```bash
npm install pi-do-eval
```

Building an eval harness has three steps:

1. **Write a plugin** that defines how to score your extension
2. **Create trials** (tasks that put the extension on trial)
3. **Write a run script** that wires the pipeline together

## Step 1: Write a plugin

The plugin is where you define what "good" looks like for your extension. It implements the `EvalPlugin` interface:

```typescript
interface EvalPlugin {
  name: string;
  extensionPath: string;                // path to the Pi extension under test

  // Optional: extract domain events from tool results
  parseEvent?(toolName: string, resultText: string, timestamp: number): PluginEvent[];

  // Optional: classify files (e.g. "test", "source", "config")
  classifyFile?(filePath: string): string;

  // Required: deterministic scoring from parsed session data
  scoreSession(session: EvalSession, verify: VerifyResult): PluginScoreResult;

  // Required: build the prompt sent to the LLM judge
  buildJudgePrompt(taskDescription: string, workDir: string): string;

  // Optional: run independent verification (e.g. execute tests, lint)
  verify?(workDir: string): VerifyResult;

  // Optional: custom summary lines for reports
  formatSummary?(session: EvalSession): string[];
}
```

`scoreSession` returns deterministic scores, their weights, and human-readable findings:

```typescript
interface PluginScoreResult {
  scores: Record<string, number>;   // e.g. { correctness: 85, structure: 70 }
  weights: Record<string, number>;  // e.g. { correctness: 0.5, structure: 0.3 }
  findings: string[];               // e.g. ["Missing error handling in parser module"]
}
```

`buildJudgePrompt` receives the task description and working directory, and produces the prompt for a second Pi session (with no extensions) that evaluates output quality. The judge returns JSON with scores, reasons, and findings.

### Example plugin

Create a file in your own repo (e.g. `eval/plugin.ts`) that exports an `EvalPlugin`. Set `extensionPath` to the Pi extension's entry file, implement `scoreSession` with deterministic checks, and implement `buildJudgePrompt` with evaluation criteria.

```typescript
import type { EvalPlugin } from "pi-do-eval";

export const plugin: EvalPlugin = {
  name: "my-extension",
  extensionPath: "../my-extension/src/index.ts",

  classifyFile(filePath) {
    if (filePath.includes(".test.") || filePath.includes("_test.")) return "test";
    return "source";
  },

  scoreSession(session, verify) {
    const scores: Record<string, number> = {};
    const weights: Record<string, number> = {};
    const findings: string[] = [];

    // Score based on verification results
    scores.correctness = verify.passed ? 100 : 0;
    weights.correctness = 0.5;

    // Score based on session analysis
    const fileCount = session.fileWrites.length;
    scores.productivity = Math.min(100, fileCount * 10);
    weights.productivity = 0.2;

    return { scores, weights, findings };
  },

  buildJudgePrompt(taskDescription, workDir) {
    return [
      "Evaluate the implementation quality.",
      `Task:\n${taskDescription}`,
      `Working directory: ${workDir}`,
      "Return JSON: { quality: <0-100>, quality_reason: '...', findings: [...] }",
    ].join("\n\n");
  },
};
```

## Step 2: Create trials

A trial is a self-contained task that puts the extension on trial. Each trial tests whether the extension can handle a specific scenario. The framework does not enforce any directory layout; how you organize and discover trials is up to your eval harness.

The one convention the framework provides is **starter files**: if you pass a `trialDir` to `runEval`, it copies any files from `trialDir/scaffold/` into the working directory before spawning Pi. This resets the working directory to a known starting state for each run, so trials are reproducible. Use this for boilerplate the agent shouldn't have to generate (e.g. `package.json`, config files, directory structure).

A typical trial directory:

```
trials/stack-calc/
  task.md              # prompt describing what the agent should build
  scaffold/            # optional starter files, copied into workDir
    package.json
    tsconfig.json
```

Beyond that, your harness decides what else lives in a trial directory.

### Example trials

The [pi-tdd](https://github.com/manifestdocs/pi-tdd) extension includes a set of example trials. Any extension can define its own trials with its own plugin.

| Trial | Description | Variants |
|---------|-------------|----------|
| `stack-calc` | Stack-based calculator | TS, Python, Go |
| `temp-api` | Temperature conversion API | Python, TS, Go |
| `todo-cli` | CLI todo manager | Rust, Go, TS |
| `word-freq` | Word frequency counter | Go, Python, TS |
| `fullstack-notes` | Notes app monorepo | TS |
| `fizzbuzz-polyglot` | FizzBuzz with custom rules | C, TS, Ruby |

## Step 3: Write a run script

With your plugin and trials in place, write a script (e.g. `eval/run.ts`) that orchestrates the pipeline:

```typescript
import { runEval, runJudge, scoreSession, defaultVerify, writeReport, printSummary } from "pi-do-eval";
import { plugin } from "./plugin.js";

const taskDescription = fs.readFileSync("./trials/my-trial/task.md", "utf-8");

// 1. Run the extension against a trial
const result = await runEval({
  trialDir: "./trials/my-trial",
  workDir: "/tmp/eval-run",
  prompt: taskDescription,
  extensionPath: plugin.extensionPath,
});

// 2. Verify, judge, and score
const verify = plugin.verify?.("/tmp/eval-run") ?? defaultVerify();
const judgeOutcome = await runJudge({
  workDir: "/tmp/eval-run",
  prompt: plugin.buildJudgePrompt(taskDescription, "/tmp/eval-run"),
});
const scores = scoreSession({
  session: result.session,
  verify,
  plugin,
  judgeResult: judgeOutcome.ok ? judgeOutcome.result : undefined,
});
```

## Scoring

Scores come from two sources, combined into a weighted average:

**Deterministic** (from the plugin's `scoreSession`):
- Extension-specific metrics defined by the plugin
- Correctness via independent verification (if the plugin implements `verify`)

**LLM Judge** (Pi as evaluator, no extensions loaded):
- Quality criteria defined by the plugin's `buildJudgePrompt`
- Judge scores that lack explicit weights default to 0.1

The overall score is a weighted average of all deterministic and judge scores.

## Run output

Each run creates a timestamped directory under `runs/` containing:

| File | Description |
|------|-------------|
| `report.json` | Structured scores (deterministic + judge) |
| `report.md` | Human-readable results with judge reasoning |
| `session.jsonl` | Raw Pi session for debugging |
| `workdir/` | The working directory the agent operated in |

An `index.json` at `runs/index.json` summarizes all runs for the report viewer. Start the viewer with `npm run view` (serves at `localhost:3333`). The viewer auto-refreshes the run index and polls live snapshots for in-progress runs.

## Live mode

Pass a `live` option to `runEval` to stream progress while a run is in flight. The runner writes periodic snapshots that the report viewer can poll, so you can watch tool calls and file writes accumulate in real time.

```typescript
const result = await runEval({
  trialDir: "./trials/my-trial",
  workDir: "/tmp/eval-run",
  prompt: "Implement all user stories described in the task.",
  extensionPath: myPlugin.extensionPath,
  live: {
    runDir: "./runs/2026-04-12T14-00-00Z",   // where live artifacts are written
    runsDir: "./runs",                         // parent dir; index.json is updated here
    intervalMs: 2000,                          // snapshot frequency (default: 2000)
    meta: { trial: "my-trial", variant: "ts", workerModel: "claude-sonnet-4" },
  },
});
```

While the run is active, the `runDir` contains:

| File | Description |
|------|-------------|
| `status.json` | Run metadata and current status (`"running"`) |
| `session.jsonl` | JSONL events streamed as they arrive |
| `live.json` | Periodic parsed session snapshot for the viewer |

The run index (`runs/index.json`) includes live runs so they appear in the viewer immediately. Once the run completes, write the final report as usual; the viewer picks up `report.json` and stops polling.

## Configuring models

Both `runEval` and `runJudge` accept `provider`, `model`, and `thinking` options that map directly to Pi CLI flags:

```typescript
const result = await runEval({
  trialDir: "./trials/my-trial",
  workDir: "/tmp/eval-run",
  prompt: "Implement all user stories described in the task.",
  extensionPath: myPlugin.extensionPath,
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  thinking: "enabled",
});

const judgeResult = await runJudge({
  workDir: "/tmp/eval-run",
  prompt: myPlugin.buildJudgePrompt(taskDescription, "/tmp/eval-run"),
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
});
```

When omitted, Pi uses its defaults from `~/.pi/agent/settings.json`.

The parser automatically extracts model and provider info from the session's `message_start` events, so `EvalSession.modelInfo` and report metadata reflect which model actually ran, regardless of how it was configured.

## Sandboxing

Extensions run in eval can execute arbitrary code (file writes, shell commands, network requests). Sandboxing constrains the Pi subprocess so it can only access paths you explicitly allow.

pi-do-eval uses [ai-jail](https://github.com/anthropics/ai-jail), a lightweight wrapper around OS-native sandboxing primitives (`sandbox-exec` on macOS, `bubblewrap` on Linux). Unlike Docker, there is no VM or container runtime involved: processes run natively with kernel-enforced restrictions, so startup cost is near-zero and throughput is unaffected.

### Installing ai-jail

ai-jail is a separate tool. Install it before enabling the sandbox option:

```bash
# macOS
brew install ai-jail

# Linux / from source
cargo install ai-jail
```

If ai-jail is not on `PATH`, pi-do-eval prints a single warning to stderr and runs unsandboxed. Your evals still work; you just lose the isolation.

### Enabling the sandbox

Pass `sandbox: true` to `runEval` and/or `runJudge`:

```typescript
const result = await runEval({
  trialDir: "./trials/my-trial",
  workDir: "/tmp/eval-run",
  prompt: "Implement all user stories described in the task.",
  extensionPath: myPlugin.extensionPath,
  sandbox: true,
});

const judgeResult = await runJudge({
  workDir: "/tmp/eval-run",
  prompt: myPlugin.buildJudgePrompt(taskDescription, "/tmp/eval-run"),
  sandbox: true,
});
```

With `sandbox: true`, the worker gets read-write access to `workDir` (it needs to create files) and the judge gets read-only access (it only inspects output). Network is allowed by default since both processes need to reach the LLM API.

### Sandbox options

For finer control, pass a `SandboxOptions` object instead of `true`:

```typescript
const result = await runEval({
  trialDir: "./trials/my-trial",
  workDir: "/tmp/eval-run",
  prompt: "Implement all user stories described in the task.",
  extensionPath: myPlugin.extensionPath,
  sandbox: {
    extraRwPaths: ["/tmp/shared-cache"],     // additional read-write paths
    extraRoPaths: ["/usr/local/lib/node"],    // additional read-only paths
    lockdown: true,                           // block all network access
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `extraRwPaths` | `string[]` | `[]` | Additional paths the process can read and write |
| `extraRoPaths` | `string[]` | `[]` | Additional paths the process can read |
| `lockdown` | `boolean` | `false` | Block network access (useful when the extension should work offline) |

> **Warning**: `lockdown: true` blocks all outbound network requests. Both the worker and the judge need network access to call the LLM API, so only enable this if the extension and model are running locally.

## See also

[pi-tdd](https://github.com/manifestdocs/pi-tdd) is a TDD enforcement extension for Pi that uses pi-do-eval for its eval suite. It's a good example of a real plugin, trial set, and scoring implementation built on this framework.

## Development

```bash
npm test          # Run framework tests (vitest)
npm run lint      # Biome lint + format check
npm run lint:fix  # Auto-fix lint issues
```
