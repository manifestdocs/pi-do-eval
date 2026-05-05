# Do Eval Architecture

This document describes the current architecture. Historical project-management
UI ideas belong in separate RFCs; the shipped source of truth is a file-based
eval project plus generated run artifacts.

## Product Boundary

Do Eval is a local coding-agent eval framework. It does not try to be a hosted
observability product or a general dataset platform. The core workflow is:

1. load an eval project from disk
2. resolve trials, variants, suites, profiles, and plugins
3. launch a coding agent in a fresh workdir
4. normalize the agent transcript into an `EvalSession`
5. verify, judge, score, and report the result
6. update run indexes for the TUI and web viewer

## File-Based Source Of Truth

The author-controlled files are:

```text
eval.config.ts
plugins/*.ts
trials/*/trial.yaml
trials/*/task.md
trials/*/scaffold/
suites/*.yaml
```

Do Eval intentionally keeps suite membership and trial metadata in YAML. Adding
a trial or suite should be reviewable as data, not as a TypeScript code change.

`eval.config.ts` owns policy: models, timeouts, budgets, profiles, benches,
regression thresholds, defaults, and `runsDir`.

## Runtime Artifacts

Run artifacts live under `runs/` unless `runsDir` says otherwise:

```text
runs/
  index.json
  suites/index.json
  suites/<suite-run>/report.json
  benches/index.json
  benches/<bench-run>/report.json
  <trial-run>/
    status.json
    live.json
    session.jsonl
    stderr.txt
    workdir/
    report.json
    report.md
```

The TUI and web viewer read these files. They do not own eval configuration.

## Runner Lifecycle

The lower-level `runEval()` function owns only the worker session:

1. copy `trialDir/scaffold/` into `workDir`
2. run `prepareWorkDir`
3. prepare the selected harness
4. create live artifacts and emit `run_started`
5. launch the worker with timeout and inactivity guards
6. stream raw JSONL into `session.jsonl`
7. periodically write `live.json`
8. ingest the transcript into `EvalSession`
9. emit lower-level completion unless disabled
10. clean up the harness

The first-class project runner owns everything after worker completion:

1. run plugin verification
2. optionally run the LLM judge
3. combine deterministic and judge scores
4. call plugin `afterRun`
5. write `report.json` and `report.md`
6. update run indexes
7. emit project-level completion

That split matters because live subscribers can see a worker finish before the
final report exists. First-class commands suppress the lower-level completion
event and emit completion only after the report has been written.

## Harness Boundary

Agent-specific behavior sits behind `AgentHarness`:

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

The built-in harnesses are `pi` and `codex`. New runtimes should implement this
interface instead of forking scoring, reporting, suite execution, or viewer
logic.

## Plugin Boundary

The eval plugin describes what good looks like for a project. It should not own
agent launch mechanics. Plugins can customize prompts, verification, scoring,
judge prompts, event extraction, file classification, and after-run artifacts.

This keeps one scoring plugin reusable across multiple profiles and harnesses.

## UI Surfaces

The TUI is the primary UI. It reads file-backed project configuration, launches
runs through the project runner, subscribes to `EvalEvent`s, and reloads run
artifacts as they appear.

The web viewer remains available for browser-based inspection. It shares the
same project registry and on-disk artifacts as the TUI.

Neither UI starts as the source of truth. The eval project files and run
artifacts are the contract.

## Design Rules

- Keep trial and suite definitions reviewable in source control.
- Keep agent runtime differences inside harness adapters.
- Keep project scoring and domain interpretation inside eval plugins.
- Emit project-level completion only when report files exist.
- Prefer deterministic verification over judge-only scoring.
- Keep generated run data separate from authored eval configuration.
