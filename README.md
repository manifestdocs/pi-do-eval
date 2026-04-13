# Pi, do Eval 😈😇

Use Pi to eval Pi (extensions). "Pi, do Eval" is a framework for building your own Pi-based evaluation harnesses. Use it to evaluate an extension you created, iterate on its behavior, and catch regressions as you improve it.

A harness built with `pi-do-eval` can:

- run Pi with the extension under test
- parse the JSONL session into tool calls, file writes, and plugin events
- run deterministic verification
- run a second Pi session as an LLM judge
- score and report the result

It ships a small scaffold command, `pi-do-eval init`, which generates a working harness you can customize.

## How it works

1. Your harness spawns `pi -p --mode json -e <extensionPath>` with the extension under test.
2. `pi-do-eval` parses the JSONL session into tool calls, file writes, and optional plugin-specific events.
3. Your plugin can run independent verification after the worker session completes.
4. Your harness can spawn `pi -p --mode json --no-extensions` as a judge.
5. Deterministic plugin scores and judge scores are combined into a weighted final report.

Note: The eval prompt is deliberately minimal; the extension's own system prompt should drive the behavior.

## Getting Started

`pi-do-eval init` is the fastest way to scaffold a harness once you already have a Pi extension repo. It is not a zero-config demo: `pi-do-eval` evaluates an extension you already have, and after scaffolding you still need to define real scoring and trials for that extension.

Before you run it:

- be in the root of the Pi extension repo you want to evaluate
- have an extension entry point already checked into that repo
- expect to edit the generated plugin and trial files before the eval is meaningful

To scaffold the harness:

```bash
npx pi-do-eval init
cd eval
npm install
```

`pi-do-eval init` creates:

```text
eval/
  package.json
  tsconfig.json
  eval.config.ts
  eval.ts
  plugins/
    <your-extension>.ts   # eval plugin; points at your real extension entry
  trials/
    example/
      config.ts           # placeholder trial config
      task.md             # placeholder task
```

The generated `eval.ts` is a complete harness: it creates timestamped run directories, uses a fresh `workdir/` for each run, writes reports, updates the viewer index, and wires in live snapshots for the viewer.

After scaffolding, you still need to do some setup work:

1. Edit `plugins/<your-extension>.ts` to implement scoring and optional verification.
2. Replace the example trial with a real task for your extension.
3. Install the eval package dependencies with `cd eval && npm install`.
4. Run the scaffolded example once to smoke-test the harness wiring.

The generated example plugin and trial are placeholders. Running them immediately is useful as a harness smoke test, but not yet as a meaningful evaluation of your extension.

Once the harness is scaffolded, use:

```bash
npm run eval -- list
npm run eval -- run --trial example --variant default
npm run view
```

If you want a real example beyond the scaffold, see the `eval/` directory in [pi-tdd](https://github.com/kreek/pi-tdd/tree/main/eval). The rest of this README explains the lower-level APIs the scaffold uses.

## Plugin API

The plugin is where you define what "good" looks like for your extension. It implements `EvalPlugin`:

```typescript
interface EvalPlugin {
  name: string;
  extensionPath: string;

  // Optional: extract domain events from tool results
  parseEvent?(toolName: string, resultText: string, timestamp: number): PluginEvent[];

  // Optional: classify files (for example "test", "source", "config")
  classifyFile?(filePath: string): string;

  // Required: deterministic scoring from parsed session data
  scoreSession(session: EvalSession, verify: VerifyResult): PluginScoreResult;

  // Required: build the prompt sent to the LLM judge
  buildJudgePrompt(taskDescription: string, workDir: string): string;

  // Optional: run independent verification (for example, tests, lint, build)
  verify?(workDir: string): VerifyResult;

  // Optional: custom summary lines for reports
  formatSummary?(session: EvalSession): string[];
}
```

`scoreSession` returns deterministic scores, weights, and findings:

```typescript
interface PluginScoreResult {
  scores: Record<string, number>;
  weights: Record<string, number>;
  findings: string[];
}
```

### Example plugin

If you use the scaffold, your plugin will live at `eval/plugins/<name>.ts`. Resolve `extensionPath` to an absolute path from that file. `runEval` does not rewrite it relative to `workDir`.

```typescript
import * as path from "node:path";
import type { EvalPlugin } from "pi-do-eval";

export const plugin: EvalPlugin = {
  name: "my-extension",
  extensionPath: path.resolve(import.meta.dirname, "../../src/index.ts"),

  classifyFile(filePath) {
    if (filePath.includes(".test.") || filePath.includes("_test.")) return "test";
    if (/package\.json$|tsconfig|\.gitignore$/.test(filePath)) return "config";
    return "source";
  },

  scoreSession(session, verify) {
    const scores: Record<string, number> = {};
    const weights: Record<string, number> = {};
    const findings: string[] = [];

    scores.correctness = verify.passed ? 100 : 0;
    weights.correctness = 0.5;

    scores.productivity = Math.min(100, session.fileWrites.length * 10);
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
      "## Working Directory",
      workDir,
      "",
      'Return {"quality": <0-100>, "quality_reason": "...", "findings": ["..."]}',
    ].join("\n");
  },
};
```

## Put Your Agent on Trial

A trial is a self-contained task that puts the extension to the test. The library itself only assumes one convention:

- If `trialDir/scaffold/` exists, `runEval` copies those files into `workDir` before spawning Pi.

That is a copy step, not a reset step. `runEval` does not delete leftovers from a previous run, so reproducibility depends on using a fresh `workDir` each time or cleaning it yourself. The scaffolded harness solves this by creating a new timestamped `workdir/` for every run.

A typical trial in the scaffolded harness looks like:

```text
trials/stack-calc/
  config.ts
  task.md
  scaffold/
    package.json
    tsconfig.json
```

Outside the scaffold, you can organize trials however you want. The only thing `runEval` needs is a `trialDir`.

## Build Your Own Runner

If you do not want to use `pi-do-eval init`, you can wire the pieces together yourself. The example below is intentionally complete enough to produce a functional run directory and viewer index.

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import {
  defaultVerify,
  printSummary,
  runEval,
  runJudge,
  scoreSession,
  updateRunIndex,
  writeReport,
} from "pi-do-eval";
import { plugin } from "./plugin.js";

const RUNS_DIR = path.resolve("runs");
const trialDir = path.resolve("trials/my-trial");
const taskPath = path.join(trialDir, "task.md");
const taskDescription = fs.readFileSync(taskPath, "utf-8");

const runName = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-my-trial-default`;
const runDir = path.join(RUNS_DIR, runName);
const workDir = path.join(runDir, "workdir");
fs.mkdirSync(workDir, { recursive: true });

const result = await runEval({
  trialDir,
  workDir,
  prompt: taskDescription,
  extensionPath: plugin.extensionPath,
  plugin,
  live: {
    runDir,
    runsDir: RUNS_DIR,
    meta: { trial: "my-trial", variant: "default" },
  },
});

if (result.stderr) fs.writeFileSync(path.join(runDir, "stderr.txt"), result.stderr);
fs.writeFileSync(path.join(runDir, "session.jsonl"), result.session.rawLines.join("\n"));

const verify = plugin.verify?.(workDir) ?? defaultVerify();
const judgeOutcome = await runJudge({
  workDir,
  prompt: plugin.buildJudgePrompt(taskDescription, workDir),
});

const scores = scoreSession({
  session: result.session,
  verify,
  plugin,
  judgeResult: judgeOutcome.ok ? judgeOutcome.result : undefined,
});

const pluginResult = plugin.scoreSession(result.session, verify);
const judgeFailure = "reason" in judgeOutcome ? judgeOutcome.reason : undefined;
const findings = [...pluginResult.findings];
if (!verify.passed) findings.push("Verification failed");
if (result.status !== "completed") findings.push(`Session ended with status: ${result.status}`);
if (judgeOutcome.ok) findings.push(...judgeOutcome.result.findings);
if (judgeFailure) findings.push(`Judge failed: ${judgeFailure}`);

const report = {
  meta: {
    trial: "my-trial",
    variant: "default",
    workerModel: result.session.modelInfo
      ? `${result.session.modelInfo.provider}/${result.session.modelInfo.model}`
      : "default",
    ...(judgeOutcome.ok ? { judgeModel: "default" } : {}),
    startedAt: new Date(result.session.startTime).toISOString(),
    durationMs: result.session.endTime - result.session.startTime,
    status: result.status,
  },
  scores,
  ...(judgeOutcome.ok ? { judgeResult: judgeOutcome.result } : {}),
  session: { ...result.session, rawLines: [] },
  findings,
};

writeReport(report, runDir);
updateRunIndex(RUNS_DIR);
printSummary(report);
```

## Scoring

Scores come from two sources:

**Deterministic**
- Anything your plugin returns from `scoreSession`
- Independent verification such as tests, lint, or build status

**LLM Judge**
- Anything returned by `runJudge`
- Judge scores without an explicit matching weight default to `0.1`

The overall score is the weighted average of every score that has a weight.

## Reports And Viewer

The library does not create a `runs/` directory by itself. That is a harness convention.

If you follow the scaffolded `eval.ts` pattern, a typical run directory looks like:

| File | Written by | Description |
|------|------------|-------------|
| `report.json` | `writeReport()` | Structured scores and metadata |
| `report.md` | `writeReport()` | Human-readable report |
| `session.jsonl` | your harness | Raw Pi session for debugging |
| `workdir/` | your harness | The working directory the agent operated in |
| `stderr.txt` | optional | Worker stderr, if you choose to persist it |

`updateRunIndex(runsDir)` writes `runs/index.json`, which the viewer reads.

If you want the same `npm run view` workflow as the scaffold, use this script in your harness package:

```json
{
  "scripts": {
    "view": "ln -sf node_modules/pi-do-eval/src/viewer.html index.html && npx serve -S -l 3333 ."
  }
}
```

That serves the harness root at `http://localhost:3333`, with the viewer at `/` and `runs/index.json` in the location the viewer expects.

## Live Mode

Pass `live` to `runEval` to stream progress while a run is in flight:

```typescript
const result = await runEval({
  trialDir: "./trials/my-trial",
  workDir: "/tmp/eval-run",
  prompt: "Implement all user stories described in the task.",
  extensionPath: myPlugin.extensionPath,
  plugin: myPlugin,
  live: {
    runDir: "./runs/2026-04-12T14-00-00Z",
    runsDir: "./runs",
    intervalMs: 2000,
    meta: { trial: "my-trial", variant: "ts", workerModel: "claude-sonnet-4" },
  },
});
```

While the run is active, `runDir` contains:

| File | Description |
|------|-------------|
| `status.json` | Run metadata and current status (`"running"`) |
| `session.jsonl` | JSONL events streamed as they arrive |
| `live.json` | Periodic parsed session snapshot for the viewer |

`runEval` writes those live artifacts only when `live` is enabled. Final reports still come from your harness calling `writeReport()`.

## Configuring Models

Both `runEval` and `runJudge` accept `provider`, `model`, and `thinking` options that map directly to Pi CLI flags:

```typescript
const result = await runEval({
  trialDir: "./trials/my-trial",
  workDir: "/tmp/eval-run",
  prompt: "Implement all user stories described in the task.",
  extensionPath: myPlugin.extensionPath,
  plugin: myPlugin,
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

For worker sessions, the parser extracts the actual model/provider from `message_start` events and stores them on `EvalSession.modelInfo`. The scaffolded harness uses that for worker report metadata.

Judge metadata is different: `runJudge` currently returns scores, reasons, and findings, but not parsed model info. The scaffolded harness records the configured judge model string in report metadata.

## Sandboxing

Extensions under eval can execute arbitrary code. Sandboxing constrains the Pi subprocess so that it can access only paths you explicitly allow.

`pi-do-eval` uses [ai-jail](https://github.com/anthropics/ai-jail), a lightweight wrapper around OS-native sandboxing primitives (`sandbox-exec` on macOS, `bubblewrap` on Linux).

### Installing ai-jail

Install it before enabling sandboxing:

```bash
# macOS
brew install ai-jail

# Linux / from source
cargo install ai-jail
```

If `ai-jail` is not on `PATH`, `pi-do-eval` prints a warning and runs unsandboxed.

### Enabling the sandbox

Pass `sandbox: true` to `runEval` and/or `runJudge`:

```typescript
const result = await runEval({
  trialDir: "./trials/my-trial",
  workDir: "/tmp/eval-run",
  prompt: "Implement all user stories described in the task.",
  extensionPath: myPlugin.extensionPath,
  plugin: myPlugin,
  sandbox: true,
});

const judgeResult = await runJudge({
  workDir: "/tmp/eval-run",
  prompt: myPlugin.buildJudgePrompt(taskDescription, "/tmp/eval-run"),
  sandbox: true,
});
```

With `sandbox: true`, the worker gets read-write access to `workDir` and the judge gets read-only access. Network is allowed by default so the processes can reach the LLM API.

### Sandbox options

For finer control, pass a `SandboxOptions` object instead of `true`:

```typescript
const result = await runEval({
  trialDir: "./trials/my-trial",
  workDir: "/tmp/eval-run",
  prompt: "Implement all user stories described in the task.",
  extensionPath: myPlugin.extensionPath,
  plugin: myPlugin,
  sandbox: {
    extraRwPaths: ["/tmp/shared-cache"],
    extraRoPaths: ["/usr/local/lib/node"],
    lockdown: true,
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `extraRwPaths` | `string[]` | `[]` | Additional paths the process can read and write |
| `extraRoPaths` | `string[]` | `[]` | Additional paths the process can read |
| `lockdown` | `boolean` | `false` | Block network access |

`lockdown: true` blocks all outbound network requests. Both the worker and the judge usually need network access to call the LLM API, so only use this if the extension and model are running locally.

## See Also

- [pi-tdd](https://github.com/manifestdocs/pi-tdd): a real extension with a full `eval/` harness built on `pi-do-eval`

## Development

```bash
npm test
npm run lint
npm run lint:fix
```
