# Do Eval Concepts

Do Eval has a small set of concepts. Once these are clear, the CLI, TUI, and
report files are predictable.

## Eval Project

An eval project is usually `eval/` inside the repo being evaluated. It contains
source-controlled configuration and generated run output:

```text
eval/
  eval.config.ts
  plugins/
  trials/
  suites/
  runs/
```

`runs/` is generated and should normally stay out of git. Everything else is
the eval source of truth.

## Trial

A trial is one coding task. It lives at `trials/<name>/`.

```text
trials/fix-login/
  trial.yaml
  task.md
  scaffold/
```

`trial.yaml` describes the trial, points to the task file, names the scoring
plugin, and declares variants. `task.md` is the worker prompt content. If
`scaffold/` exists, Do Eval copies it into a fresh run workdir before launching
the agent.

## Variant

A variant is one configuration of a trial. The `default` variant is used when
no variant is specified.

```yaml
variants:
  default:
    label: Standard task
  edge:
    label: Edge-case fixture
    fixture: edge.json
```

Variants are intentionally open-ended. Do Eval reserves `label`; the rest of
the fields belong to your plugin and profiles.

## Suite

A suite is an ordered set of trial variants. Suites live under
`suites/*.yaml`.

```yaml
name: small
description: Fast smoke coverage
regressionThreshold: 3
trials:
  - fix-login
  - trial: api-pagination
    variant: edge
```

Bare strings mean `{ trial: "<name>", variant: "default" }`.

## Profile

A profile describes the worker runtime used for a run: harness, provider,
model, runtime-specific options, and comparison factors.

Profiles live in `eval.config.ts`:

```ts
profiles: {
  codexBaseline: {
    id: "codexBaseline",
    label: "Codex baseline",
    agent: { harness: "codex", provider: "openai", model: "gpt-5.4" },
    factors: { harness: "codex", provider: "openai", model: "gpt-5.4", layers: [] },
  },
}
```

Profiles are optional. If you do not define one, Do Eval uses the top-level
worker model and the default `pi` harness unless the trial or run options say
otherwise.

## Launch Modes

Trial runs one trial variant. Use it while developing the task or scoring.

Regression runs one profile across a suite and compares the result against the
previous run for the same suite/profile timeline. Use it to catch drift.

Bench runs multiple configured profiles across the same suite and compares
treatment profiles against a baseline. Use it for model, harness, skill, or
plugin comparisons.

## Scoring Plugin

The scoring plugin defines what good looks like for your project. It implements
`EvalPlugin` and can:

- build the worker prompt
- run deterministic verification
- score the parsed session
- build the judge prompt
- classify file writes
- extract domain events
- write after-run artifacts

Most projects should invest first in `verify()` and `scoreSession()`.

## Agent Harness

An agent harness adapts a runtime to Do Eval. Do Eval ships `pi` and `codex`.
Harnesses own runtime-specific preparation, command construction, and session
ingestion. The rest of the pipeline is shared.

Custom harnesses implement `AgentHarness` and register with `registerHarness`.

## Run Directory

Each run gets a timestamped directory under `runs/` by default:

```text
runs/2026-05-02T10-30-00-fix-login-default/
  status.json
  live.json
  session.jsonl
  stderr.txt
  workdir/
  report.json
  report.md
```

`status.json`, `live.json`, and `session.jsonl` are written while the worker is
running. `report.json` and `report.md` are written after verification, judging,
scoring, and report assembly finish.

## Report

A report contains:

- metadata: trial, variant, suite, profile, model, duration, status
- deterministic scores
- optional judge scores
- overall weighted score
- verification status
- parsed session summary
- findings

The TUI and web viewer read the run index plus these report files.
