# Lower-Level API

Most users should start with the first-class CLI and TUI. Use the lower-level
API when you are embedding Do Eval in custom tooling.

## `runEval`

`runEval()` launches one worker session and returns the normalized session.

```ts
import { runEval } from "do-eval";

const result = await runEval({
  trialDir: "./trials/example",
  workDir: "/tmp/do-eval-example",
  prompt: "Implement the task in task.md",
  extensionPath: "/absolute/path/to/extension.ts",
  plugin,
  live: {
    runDir: "./runs/example",
    runsDir: "./runs",
    meta: { trial: "example", variant: "default" },
  },
});
```

`runEval()` handles scaffold copy, optional `prepareWorkDir`, harness
preparation, worker launch, timeout and inactivity guards, session ingestion,
live snapshots, and harness cleanup.

It does not run verification, judging, scoring, or report writing. The
first-class project runner does those steps after `runEval()` returns.

## Live Mode

Pass `live` to write in-flight artifacts:

```text
status.json
session.jsonl
live.json
```

Direct callers get `run_started`, `run_progress`, and `run_completed` events
when they pass `live.emit`.

The first-class project runner suppresses the lower-level completion event and
emits `run_completed` only after `report.json` exists. That keeps the TUI from
treating a project run as finished before verification, judging, scoring, and
report writing complete.

## Reports

For custom tooling, call the reporter helpers after `runEval()`:

```ts
import {
  defaultVerify,
  runJudge,
  scoreSession,
  updateRunIndex,
  writeReport,
} from "do-eval";

const verify = plugin.verify?.(result.workDir) ?? defaultVerify();
const judge = await runJudge({
  workDir: result.workDir,
  prompt: plugin.buildJudgePrompt(taskDescription, result.workDir),
});

const scores = scoreSession({
  session: result.session,
  verify,
  plugin,
  judgeResult: judge.ok ? judge.result : undefined,
});

writeReport(report, runDir);
updateRunIndex(runsDir);
```

The report object should include run metadata, scores, optional judge result,
session data, and findings. The first-class project runner is the best source
of truth for the full assembly logic.

## Harness Adapters

Do Eval ships `pi` and `codex` harnesses. A harness implements:

```ts
interface AgentHarness {
  id: string;
  requiresFileSnapshot?: boolean;
  prepare?(ctx: HarnessPrepareContext): void | Promise<void>;
  buildWorkerCommand(ctx: WorkerCommandContext): SpawnSpec;
  ingestWorkerSession(ctx: SessionIngestContext): EvalSession;
  cleanup?(ctx: HarnessCleanupContext): void | Promise<void>;
}
```

Register a custom harness before launching runs:

```ts
import { registerHarness } from "do-eval";

registerHarness(myHarness);
```

Profiles select a harness with `agent.harness`.

## Sandboxing

`runEval()` and `runJudge()` accept `sandbox: true` or a `SandboxOptions`
object. Do Eval uses `ai-jail` when it is installed.

```ts
await runEval({
  trialDir,
  workDir,
  prompt,
  extensionPath,
  plugin,
  sandbox: {
    extraRwPaths: ["/tmp/shared-cache"],
    extraRoPaths: ["/usr/local/lib/node"],
    lockdown: false,
  },
});
```

With `sandbox: true`, the worker gets read/write access to the workdir. The
judge gets read-only access. `lockdown: true` blocks outbound network, which is
only practical when the agent and model calls do not need network access.

If `ai-jail` is missing, Do Eval warns and runs unsandboxed.
