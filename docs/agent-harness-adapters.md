# Agent Harness Adapter Design

## Status

Implemented for Pi and Codex; proposed as the extension pattern for additional
agent runtimes.

## Context

Do Eval began as a framework for evaluating Pi extensions. The existing
pipeline already has useful framework-level responsibilities:

- load trials, variants, suites, and epoch settings;
- create run directories and isolated work directories;
- copy trial scaffolds;
- run worker sessions with timeout and inactivity guards;
- ingest sessions into a common `EvalSession` shape;
- run deterministic verification;
- optionally run an LLM judge;
- score, report, aggregate, compare regressions, and feed the viewer.

Only two parts are truly Pi-specific:

1. launching the worker session;
2. parsing Pi JSONL into `EvalSession`.

Codex vs Codex + ABP needs the same framework behavior with a different
worker runtime. Future targets such as Goose, Droid, or other coding agents
need the same extension point.

## Decision

Keep Do Eval as a runtime-neutral agent eval framework. Add
runtime-specific **agent harness adapters** that own only the pieces that vary
by agent runtime:

- how to prepare runtime state;
- how to build the worker command;
- how to ingest the worker transcript/session into `EvalSession`;
- how to clean up any runtime-specific state.

Everything after session normalization remains shared.

## Non-Goals

- Do not fork the scoring/reporting/viewer pipeline per agent.
- Do not make Codex or ABP concepts part of the generic scoring plugin API.
- Do not require every agent to expose the same native trace format.
- Do not block Codex support on making the judge runtime pluggable.

## Core Boundary

The shared eval loop depends on an `AgentHarness`, not directly on Pi, Codex,
or any other CLI.

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

The shared runner follows this shape:

```ts
export async function runEval(opts: RunOptions): Promise<RunResult> {
  const harness = resolveHarness(opts.agent?.harness ?? "pi");

  copyScaffold(opts.trialDir, opts.workDir);

  await harness.prepare?.({ workDir: opts.workDir, agent: opts.agent });

  const spawnSpec = harness.buildWorkerCommand({
    workDir: opts.workDir,
    prompt: opts.prompt,
    extensionPath: opts.extensionPath,
    provider: opts.provider,
    model: opts.model,
    thinking: opts.thinking,
    agent: opts.agent,
  });

  const raw = await runProcessWithTimeouts(spawnSpec, opts);

  const session = harness.ingestWorkerSession({
    rawLines: raw.stdoutLines,
    stderr: raw.stderr,
    plugin: opts.plugin,
    exitCode: raw.exitCode,
    status: raw.status,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
  });

  await harness.cleanup?.({ workDir: opts.workDir, agent: opts.agent });

  return {
    session,
    status: raw.status,
    exitCode: raw.exitCode,
    stderr: raw.stderr,
    workDir: opts.workDir,
  };
}
```

## Normalized Session Contract

`EvalSession` remains the framework boundary. Harnesses translate native
agent output into this common shape:

```ts
interface EvalSession {
  toolCalls: ToolCallRecord[];
  fileWrites: FileWriteRecord[];
  pluginEvents: PluginEvent[];
  rawLines: string[];
  startTime: number;
  endTime: number;
  exitCode: number | null;
  tokenUsage: { input: number; output: number };
  modelInfo?: { model: string; provider: string };
  parseWarnings: number;
}
```

Harnesses should degrade gracefully when an agent does not expose a field:

- no token usage: use zeroes and record a parse warning;
- no structured tool calls: infer what is reliable, otherwise leave empty;
- no file-write events: derive file writes from before/after workdir diff;
- no model info: fall back to configured variant model;
- no event timestamps: use process start/end times and approximate ordering.

## Agent-Specific Adapters

### Pi

The Pi adapter preserves current behavior.

Worker command:

```sh
pi -p --mode json --no-extensions -e <extensionPath> --no-session <prompt>
```

Ingestion:

- parse Pi JSONL;
- map assistant tool calls to `ToolCallRecord`;
- classify `write` and `edit` calls as `FileWriteRecord`;
- let the eval plugin extract domain-specific plugin events.

### Codex

The Codex adapter runs Codex CLI in non-interactive JSON mode.

Worker command shape:

```sh
CODEX_HOME=<variantCodexHome> \
codex exec \
  --json \
  --cd <workDir> \
  --sandbox workspace-write \
  --ask-for-approval never \
  --model <model> \
  <prompt>
```

The control and ABP variants should use different isolated `CODEX_HOME`
directories so user configuration does not contaminate the comparison.

For Codex + ABP, `prepare` can create or update the isolated Codex home with
the ABP marketplace/plugin configuration. For the control, `prepare` should
ensure ABP is absent.

Ingestion:

- parse Codex `--json` JSONL;
- map tool/function calls to `ToolCallRecord`;
- map file edits from structured events when available;
- fall back to before/after workdir diff for file writes;
- capture model and token usage when Codex emits it.

### Future Harnesses

Future adapters should follow the same contract:

- `goose`: Goose CLI launch plus Goose transcript parser.
- `droid`: Droid CLI launch plus Droid session/trace parser.
- custom agents: command launch plus transcript ingestion.

Harness-specific behavior stays behind the harness namespace. The framework
does not learn Goose, Droid, or Codex internals.

## Profile Configuration

Runtime launch configuration belongs to execution profiles, not scoring
plugins. Trial variants carry task data; profiles carry harness, model, and
runtime-layer data.

```ts
interface ExecutionProfile {
  id: string;
  label: string;
  agent?: AgentRuntimeConfig;
  factors: ExecutionProfileFactors;
  setup?: ProfileSetup;
}

interface AgentRuntimeConfig {
  harness?: string;
  provider?: string;
  model?: string;
  thinking?: string;
  env?: Record<string, string | undefined>;
  args?: string[];
  pi?: {
    extensionPath?: string;
    extraArgs?: string[];
    env?: Record<string, string | undefined>;
  };
  codex?: {
    home?: string;
    isolateHome?: boolean;
    authHome?: string;
    ignoreUserConfig?: boolean;
    pluginMarketplaces?: string[];
    profile?: string;
    extraArgs?: string[];
    env?: Record<string, string | undefined>;
  };
}
```

Example Codex vs Codex + ABP profiles:

```ts
profiles: {
  codexBaseline: {
    id: "codexBaseline",
    label: "Codex baseline",
    agent: {
      harness: "codex",
      model: "gpt-5.2",
      codex: {
        isolateHome: true,
        ignoreUserConfig: true,
      },
    },
    factors: { harness: "codex", provider: "openai", model: "gpt-5.2", layers: [] },
  },

  codexWithAbp: {
    id: "codexWithAbp",
    label: "Codex + ABP",
    agent: {
      harness: "codex",
      model: "gpt-5.2",
      codex: {
        isolateHome: true,
        ignoreUserConfig: true,
        pluginMarketplaces: [
          "/Users/alastair/sandbox/agent-booster-pack/.agents/plugins/marketplace.json",
        ],
      },
    },
    factors: {
      harness: "codex",
      provider: "openai",
      model: "gpt-5.2",
      layers: [{ id: "abp", kind: "plugin", runtime: "codex" }],
    },
  },
}
```

## Scoring Plugin Boundary

The existing `EvalPlugin` concept should continue to describe what good looks
like for a trial:

- classify files;
- extract domain events from normalized session records;
- run verification;
- score the session;
- build the judge prompt.

It should not own agent launch mechanics. That keeps the same scoring plugin
usable across Pi, Codex, Goose, Droid, and other harnesses.

Longer term, consider renaming the framework concept from `plugin` to
`scorer` or `evalPlugin`. Once Codex plugins are under test, "plugin" can mean
both "thing being evaluated" and "thing that scores the evaluation."

## Current Module Layout

```text
src/lib/eval/
  runner.ts
  process.ts
  parser.ts
  harnesses/
    types.ts
    index.ts
    pi.ts
    codex.ts
  ingest/
    diff-file-writes.ts
```

`runner.ts` should remain the shared orchestration loop. `process.ts` should
own process spawning, stdout/stderr capture, timeout handling, and inactivity
handling. Harness modules should own runtime-specific preparation, command
construction, and ingestion.

## Implementation Status

- Process spawning, timeout handling, and inactivity handling live in
  `process.ts`.
- `runEval()` resolves an `AgentHarness` and defaults to `pi`.
- The `pi` harness preserves the original Pi JSONL behavior.
- The `codex` harness supports isolated `CODEX_HOME`, marketplace setup, Codex
  JSONL ingestion, and file-write fallback from workdir diffs.
- Project commands select runtime behavior through execution profiles in
  `eval.config.ts`.
- Scoring plugins remain independent of the worker runtime.

## Verification

- Existing Pi eval harnesses run without config changes.
- Reports, suite aggregation, regression comparison, and viewer data remain
  unchanged for Pi runs.
- A Codex control run and Codex + ABP run can execute the same trial and
  produce comparable `EvalReport` files.
- The only required per-agent code lives under the harness/ingest boundary.
- Scoring plugins can score sessions from multiple agent harnesses without
  knowing how the worker was launched.
