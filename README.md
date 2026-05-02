# Do Eval 😈😇

A framework for building evaluation harnesses for coding agents. Use it to
measure agent behavior over a consistent set of trials, compare configurations,
and catch regressions over time.

A harness built with `do-eval` can:

- run a coding agent (Pi or Codex out of the box; additional agents via
  `registerHarness`) against the extension, plugin, or skill pack under test
- parse the agent's JSONL session into tool calls, file writes, and
  domain-specific events
- run deterministic verification
- score with an optional LLM judge
- compare profiles side-by-side as Bench runs, or track a single profile over
  time as a Regression timeline

It ships a small scaffold command, `do-eval init`, which generates a
working harness you can customize.

## How it works

1. The harness picks an **agent adapter** (`pi` or `codex` — see
   `src/lib/eval/harnesses/`) and invokes the matching CLI against the
   extension, plugin, or skill pack under test.
2. `do-eval` parses the JSONL session into tool calls, file writes, and
   optional plugin-specific events.
3. Your plugin runs independent verification after the worker session
   completes.
4. The harness can spawn a separate judge process (Pi by default) to add
   qualitative scores.
5. Deterministic plugin scores and optional judge scores are combined into a
   final report for agent improvement and non-regression tracking.

Note: the eval prompt is deliberately minimal; the agent's own system prompt,
installed plugin, or installed skill pack should drive the behavior.

## Getting Started

`do-eval init` is the fastest way to scaffold a harness once you already
have an agent extension, plugin, or skill-pack repo. It is not a zero-config
demo: `do-eval` evaluates behavior from something you already ship, and
after scaffolding you still need to define real scoring and trials for that
project.

Before you run it:

- be in the root of the repo you want to evaluate
- have the extension, plugin, skill pack, or profile layers already checked in
- expect to edit the generated plugin and trial files before the eval is meaningful

To scaffold the harness:

```bash
npx do-eval init
cd eval
npm install
```

`do-eval init` creates:

```text
eval/
  package.json
  tsconfig.json
  eval.config.ts          # project policy: profiles, benches, models, budgets
  plugins/
    <your-project>.ts     # optional project scoring/prompt hooks
  trials/
    example/
      trial.yaml          # YAML trial manifest
      task.md             # placeholder task
  suites/
    small.yaml            # YAML suite definition
```

Do Eval owns the runner: it creates timestamped run directories, uses a fresh `workdir/` for each run, writes reports, updates the viewer index, and wires in live snapshots for the viewer. Project TypeScript is reserved for `eval.config.ts` policy and optional plugin scoring/prompt hooks.

The only TypeScript file every eval project needs is `eval.config.ts`.
Everything else is conditional:

- `eval/plugins/<name>.ts` is for project-specific scoring, verification,
  prompt construction, file classification, or after-run artifacts.
- `eval/test/*.test.ts` is for tests of project policy or plugin behavior.
- `eval/vitest.config.ts` is only needed when the project has tests that need
  Vitest configuration.

Suite membership and trial metadata belong in YAML data files, not TypeScript.
Generic Trial, Regression, and Bench execution belongs in Do Eval itself.

After scaffolding, use the same authoring loop for every project:

1. Define trials with `eval/trials/<name>/trial.yaml`.
2. Create suites from those trials, either by editing `eval/suites/*.yaml` or with `do-eval suite create`.
3. Run `do-eval trial`, `do-eval regression`, or `do-eval bench`.
4. Inspect Regression and Bench results in the UI.

The generated example plugin, trial, and `small` suite are placeholders. Running them immediately is useful as a harness smoke test, but not yet as a meaningful evaluation of your project.

Once the harness is scaffolded, use:

```bash
do-eval list --project .
do-eval trial example --variant default --project .
do-eval suite create small example --force --project .
do-eval regression small --project .
do-eval ui --project .
```

`do-eval ui --project .` opens the global viewer and auto-registers the current project.

If you want a real example beyond the scaffold, see the `eval/` directory in [pi-proof](https://github.com/kreek/pi-proof/tree/main/eval). The rest of this README explains the lower-level APIs the scaffold uses.

## Viewer

The web UI is now a global multi-project viewer. It keeps a small per-user registry of eval projects and lets you switch between them without restarting the app.

Project resolution follows convention over configuration:

- if you add a project repo root, `do-eval` looks for `./eval`
- if you add a direct eval directory, it uses that directory as-is
- `do-eval ui --project <path>` auto-adds that project and selects it

Common commands:

```bash
do-eval ui
do-eval ui --project ~/sandbox/pi-proof
do-eval project add ~/sandbox/pi-proof
do-eval project add ~/sandbox/pi-proof/eval
do-eval project list
do-eval project use ~/sandbox/pi-proof
do-eval project remove ~/sandbox/pi-proof
```

The project registry is stored at:

- `$PI_DO_EVAL_CONFIG_HOME/pi-do-eval/projects.json` if set
- otherwise `$XDG_CONFIG_HOME/pi-do-eval/projects.json`
- otherwise `~/.config/pi-do-eval/projects.json`

### Suites

Suites are authored only as YAML files under `eval/suites/*.yaml`. `eval.config.ts` still owns worker, judge, model, profile, Bench, timeout, and budget policy, but suite membership lives in data files so adding a suite does not require editing TypeScript.

A suite keeps `name`, optional `description`, optional `regressionThreshold`, and explicit trial references. Bare strings mean the trial's `default` variant; use an object when selecting another variant.

```yaml
name: small
description: Fast smoke coverage
trials:
  - example
  - trial: example
    variant: edge
```

The global CLI manages those files from either a project root or an `eval/` directory:

```bash
do-eval suite list --project ~/sandbox/my-agent-project
do-eval suite show small --project ~/sandbox/my-agent-project
do-eval suite create small example example:edge --project ~/sandbox/my-agent-project
do-eval suite add small another-trial --project ~/sandbox/my-agent-project
do-eval suite remove small example:edge --project ~/sandbox/my-agent-project
```

### Adding Projects

The usual workflow is:

1. Start from the root of the extension, plugin, or skill-pack repo.
2. Run `do-eval init` once to scaffold `eval/`.
3. Work inside `eval/` to define plugins, trials, and suites.
4. Add the project to the viewer with either `do-eval ui --project /path/to/repo` or `do-eval project add /path/to/repo`.

Examples:

```bash
cd ~/sandbox/my-agent-project
npx do-eval init
cd eval
npm install
do-eval trial example --variant default --project .
do-eval suite create small example --force --project .
do-eval regression small --project .
do-eval ui --project .
```

For an existing project that already has an `eval/` directory:

```bash
do-eval project add ~/sandbox/my-agent-project
do-eval ui
```

### Hot Reload

`do-eval ui` runs the built production server. For hot reload while working on the viewer itself, run the dev server from a local checkout of this repository:

```bash
cd /path/to/do-eval
npm install
do-eval ui-dev --project ~/sandbox/pi-proof --port 4242
```

That starts the SvelteKit/Vite dev server with HMR and selects the target project in the registry before launch.

### Sidebar Views

The viewer's left nav has two top-level tabs that answer different questions:

- **Bench**: cross-profile comparisons (one suite, two or more profiles).
  Each row is one comparison; the score badge is the treatment profile's
  average and the delta is treatment-vs-baseline.
- **Regression**: a single profile drifting against itself over time.
  Groups are keyed by `(suite, profile)` so two profiles with different
  layers don't share a timeline; the delta is latest-vs-prior for the same
  profile.

The launcher card mirrors the same vocabulary: `Bench` (multi-profile suite
run), `Regression` (single-profile suite run, lands in the regression
timeline), and `Trial` (debug a single trial).

### Project defaults in `eval.config.ts`

The eval config can declare which launcher tab a project should land on:

```typescript
const config: EvalConfig = {
  // ...
  defaultLaunchType: "bench", // "bench" | "trial" | "suite"
};
```

`"suite"` is the wire value for **Regression** because the underlying
`RunRequest.type` is unchanged. Set this to whichever tab a new contributor
should see first when they open your project: comparison-driven projects pick
`bench`, drift-tracking projects pick `suite`.

## Plugin API

The eval plugin is where you define what "good" looks like for the project under test. It implements `EvalPlugin`:

```typescript
interface EvalPlugin<TVariant extends TrialVariant = TrialVariant> {
  name: string;
  extensionPath: string;

  // Optional: extract domain events from tool results
  parseEvent?(toolName: string, resultText: string, timestamp: number): PluginEvent[];

  // Optional: classify files (for example "test", "source", "config")
  classifyFile?(filePath: string): string;

  // Required: deterministic scoring from parsed session data
  scoreSession(session: EvalSession, verify: VerifyResult): PluginScoreResult;

  // Optional: override the worker prompt (default: "Implement the task in <taskFile>")
  buildPrompt?(context: EvalPluginBuildPromptContext<TVariant>): string;

  // Required: build the prompt sent to the LLM judge
  buildJudgePrompt(taskDescription: string, workDir: string): string;

  // Optional: run independent verification (for example, tests, lint, build)
  verify?(workDir: string): VerifyResult;

  // Optional: write artifacts derived from the run (markdown summaries, snapshots, etc.)
  afterRun?(context: EvalPluginAfterRunContext<TVariant>): void | Promise<void>;

  // Optional: receive trial-level config (taskCount, isMonorepo, full manifest/variant)
  // Called once before scoring, after the agent run completes.
  configure?(context: EvalPluginConfigureContext<TVariant>): void;

  // Optional: custom summary lines for reports
  formatSummary?(session: EvalSession): string[];
}
```

`EvalPlugin` is parameterised over the variant shape your `trial.yaml` files
carry. Declare an interface that extends `TrialVariant` with the fields you
read, and you get typed access in `configure`, `buildPrompt`, and `afterRun`
without `as` casts. The default (`TrialVariant`) is opaque, so plugins that
don't need typed variants can omit the type parameter.

```typescript
interface PiProofVariant extends TrialVariant {
  stacks?: Array<{ language: string; testFramework: string }>;
}

const plugin: EvalPlugin<PiProofVariant> = {
  // ...
  configure({ variant, taskCount }) {
    // variant.stacks is typed; no cast needed
    if (Array.isArray(variant.stacks) && variant.stacks.length > 0) {
      // ...
    }
  },
};
```

`configure` lets a plugin react to per-trial settings carried in `trial.yaml` —
for example, to read `taskCount` for proportional scoring or `isMonorepo`
(derived from a multi-entry `stacks` array on the variant) to switch
verification strategies. The full `manifest` and `variant` are available on the
context so plugins can reach into project-specific YAML fields without a
back-channel.

`scoreSession` returns deterministic scores, weights, and findings:

```typescript
interface PluginScoreResult {
  scores: Record<string, number>;
  weights: Record<string, number>;
  findings: string[];
  judge?: {
    includeInOverall?: boolean;
    defaultWeight?: number;
    weights?: Record<string, number>;
  };
}
```

### Example plugin

If you use the scaffold, your plugin will live at `eval/plugins/<name>.ts`. Resolve `extensionPath` to an absolute path from that file. `runEval` does not rewrite it relative to `workDir`.

```typescript
import * as path from "node:path";
import type { EvalPlugin } from "do-eval";

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

    return {
      scores,
      weights,
      findings,
      judge: {
        defaultWeight: 0.1,
      },
    };
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

A trial is a self-contained task that puts the extension to the test. Trials are intended to be resettable: each run should start from a known baseline so you can compare behavior across repeated runs.

Repeated runs are useful for measuring stability on the same task. They help you understand operational variance, but they should not be interpreted as formal statistical significance.

The library itself only assumes one convention:

- If `trialDir/scaffold/` exists, `runEval` copies those files into `workDir` before spawning the agent.
- If `prepareWorkDir` is provided, `runEval` calls it after the scaffold copy and before harness preparation, file snapshots, or worker launch. Use it to materialize profile layers such as copied skill libraries.

Think of `trialDir/scaffold/` as that reset point: it is the baseline state that gets copied into the working directory at the start of a run.

That copy step is not, by itself, a full reset step. `runEval` does not delete leftovers from a previous run, so reproducibility still depends on using a fresh `workDir` each time or cleaning it yourself. The built-in `do-eval trial`, `regression`, and `bench` commands solve this by creating a new timestamped `workdir/` for every run.

A typical trial for the first-class runner looks like:

```text
trials/stack-calc/
  trial.yaml
  task.md
  scaffold/
    package.json
    tsconfig.json
```

The first-class runner reads `trial.yaml`; lower-level `runEval` APIs still only need a `trialDir` when you are building custom tooling.

## Lower-Level APIs

Most projects should use the first-class `do-eval trial`, `regression`, and `bench` commands. The lower-level APIs remain available when you are building custom tooling around the runner.

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
} from "do-eval";
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
const findings = [...scores.issues, ...pluginResult.findings];
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
- Judge scores are kept separate from deterministic metrics
- Judge scores default to a low `0.1` weight unless your plugin overrides that or excludes them from `overall`

The overall score is the weighted average of deterministic metrics plus any judge metrics you explicitly allow into `overall`.

If the plugin emits invalid scores or weights, `scoreSession()` reports scoring issues so your harness can surface them in findings instead of silently producing a misleading aggregate.

## Reports And Viewer

The first-class runner creates `runs/` under the eval directory by default, or under `runsDir` when the project config sets one. A typical run directory looks like:

| File | Written by | Description |
|------|------------|-------------|
| `report.json` | `writeReport()` | Structured scores and metadata |
| `report.md` | `writeReport()` | Human-readable report |
| `session.jsonl` | Do Eval runner | Raw Pi session for debugging |
| `workdir/` | Do Eval runner | The working directory the agent operated in |
| `stderr.txt` | optional | Worker stderr, if you choose to persist it |

`updateRunIndex(runsDir)` writes `runs/index.json`, which the viewer reads.

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

For worker sessions, the parser extracts the actual model/provider from `message_start` events and stores them on `EvalSession.modelInfo`. The first-class runner uses that for worker report metadata.

Judge metadata is different: `runJudge` currently returns scores, reasons, and findings, but not parsed model info. The first-class runner records the configured judge model string in report metadata.

## Agent Adapters

`do-eval` ships two agent adapters under
[`src/lib/eval/harnesses/`](src/lib/eval/harnesses/): `pi` and `codex`. Each
profile in `eval.config.ts` picks one via `agent.harness` and configures it
via a typed `agent` block. To add an adapter for another agent (e.g. Claude
Code), implement the `AgentHarness` interface and call `registerHarness(...)`
during your harness setup.

For example, the Codex adapter accepts:

```typescript
agent: {
  harness: "codex",
  provider: "openai",
  model: "gpt-5.4",
  codex: {
    isolateHome: true,             // fresh CODEX_HOME per run, auth.json copied
    ignoreUserConfig: false,       // load $CODEX_HOME/config.toml so plugin
                                   // marketplaces registered during prepare
                                   // are visible at exec time
    pluginMarketplaces: [
      "/path/to/local/marketplace-root",
      "owner/repo@ref",
    ],
    extraArgs: ["-c", 'plugins."abp@abp".enabled=true'],
  },
}
```

The harness's `prepare` step runs `codex plugin marketplace add` for each
entry, so the test profile gets the same plugin-install flow a real user
would experience after `codex plugin marketplace add`. See
[`harnesses/codex.ts`](src/lib/eval/harnesses/codex.ts) for the full agent
shape; the Pi and Claude adapters expose their own per-runtime options.

## Sandboxing

Extensions under eval can execute arbitrary code. Sandboxing constrains the Pi subprocess so that it can access only paths you explicitly allow.

`do-eval` uses [ai-jail](https://github.com/anthropics/ai-jail), a lightweight wrapper around OS-native sandboxing primitives (`sandbox-exec` on macOS, `bubblewrap` on Linux).

### Installing ai-jail

Install it before enabling sandboxing:

```bash
# macOS
brew install ai-jail

# Linux / from source
cargo install ai-jail
```

If `ai-jail` is not on `PATH`, `do-eval` prints a warning and runs unsandboxed.

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

- [pi-proof](https://github.com/kreek/pi-proof/tree/main/eval): a real plugin eval project built on `do-eval`

## Development

```bash
npm test
npm run lint
npm run lint:fix
```
