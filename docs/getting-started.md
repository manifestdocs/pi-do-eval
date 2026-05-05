# Getting Started With Do Eval

This guide assumes you have already read [Concepts](concepts.md) and
[Running Do Eval](running.md). By the end, you will have a real eval project
with one useful trial, a suite, a scoring plugin, and a run you can inspect in
the TUI.

## What You Need First

Do Eval evaluates an agent while it works on a coding task. Before scaffolding,
you need a repo that contains the thing you want to evaluate:

- a Pi extension
- a Codex plugin
- a skill pack
- another coding-agent profile or runtime layer

Run the scaffold from that repo root:

```bash
npx do-eval init
cd eval
npm install
```

The `eval/` directory is the eval project. Commit it with the repo it tests so
trials, suites, and scoring change with the product.

## The Scaffold

The scaffold writes:

```text
eval/
  eval.config.ts
  plugins/<project>.ts
  trials/example/trial.yaml
  trials/example/task.md
  suites/small.yaml
```

`eval.config.ts` is project policy: default models, timeouts, budgets,
profiles, benches, and default launch behavior.

`plugins/<project>.ts` is the scoring plugin. It can customize worker prompts,
verify the workdir, score the parsed session, build judge prompts, classify
file writes, and write after-run artifacts.

`trials/example/` is one resettable task. Its `task.md` is the prompt, and its
optional `scaffold/` directory is copied into a fresh run workdir before the
agent starts.

`suites/small.yaml` groups trial variants into a runnable suite.

## First Smoke Run

Run the generated example once to prove the harness loads:

```bash
npm run eval:list
npm run eval:trial -- example --variant default
npm run eval:regression
```

This proves configuration, plugin loading, the worker harness, reporting, and
the run index are wired. It does not prove product quality yet because the
generated task and scoring are placeholders.

Open the terminal UI:

```bash
npm run eval
```

Use `b` for Bench, `g` for Regression, `t` for Trial, `c` for Runs, `s` for
Suites, and `T` for Trials. Open a running run and switch to the Timeline tab
to watch live events.

## Make The Trial Real

Edit `trials/example/task.md` into a task that reflects behavior you care
about. A useful task describes:

- the user-visible change the agent should make
- files or areas it should inspect
- acceptance criteria
- constraints that matter, such as preserving APIs or avoiding broad rewrites

If the agent needs a starting app or fixture, create
`trials/example/scaffold/`. Do Eval copies that directory into each run's fresh
`workdir/`.

Example:

```text
trials/add-validation/
  trial.yaml
  task.md
  scaffold/
    package.json
    src/
```

## Make Scoring Real

Edit `plugins/<project>.ts`.

Start with `verify(workDir)`. This should run independent checks in the run
workdir, such as tests, lint, typecheck, or a project-specific script. A run
can still be judged by an LLM, but deterministic verification is the part you
can trust most.

Then update `scoreSession(session, verify)`. Use it to turn verification and
parsed session behavior into 0-100 scores with weights. Examples:

- `correctness`: 100 when verification passes, 0 otherwise
- `efficiency`: penalize too many tool calls or excessive duration
- `focus`: penalize edits outside expected file categories
- `workflow`: reward running the expected test command

Keep the first scoring model simple. A score you understand is more valuable
than a complicated score nobody trusts.

## Add Variants

Variants let one trial run with different data or runtime settings:

```yaml
description: Add validation to the API
taskFile: task.md
plugin: my-project
variants:
  default:
    label: TypeScript API
    stack:
      language: TypeScript
      testFramework: vitest
  python:
    label: Python API
    stack:
      language: Python
      testFramework: pytest
```

Run a specific variant:

```bash
npm run eval:trial -- add-validation --variant python
```

Type the variant shape in your plugin by extending `TrialVariant`; then
`configure()`, `buildPrompt()`, and `afterRun()` can read those fields without
casts.

## Build Suites

Suites live under `suites/*.yaml`:

```yaml
name: smoke
description: Fast checks before release
regressionThreshold: 3
trials:
  - add-validation
  - trial: auth-flow
    variant: edge
```

Create and edit suites either by changing YAML or with the CLI:

```bash
npx do-eval suite create smoke add-validation auth-flow:edge --project .
npx do-eval suite add smoke another-trial --project .
npx do-eval suite show smoke --project .
```

## Choose The Right Launch Mode

Use Trial while authoring one task:

```bash
npm run eval:trial -- add-validation --variant default
```

Use Regression to run one profile over a suite and compare against its own
history:

```bash
npx do-eval regression smoke --profile codexBaseline --project .
```

Use Bench to compare two or more configured profiles over the same suite:

```bash
npx do-eval bench smoke --project .
```

## Next Steps

After your first real run:

1. Inspect `runs/<run>/report.md` and `report.json`.
2. Open the run in the TUI and review findings, scores, and timeline.
3. Tighten `verify()` until false positives are rare.
4. Add trials for recent bugs, release blockers, and behaviors your agent often
   gets wrong.
5. Add profiles when you need to compare models, harnesses, skills, plugins, or
   setup layers.

For the full mental model, read [Concepts](concepts.md). For exact commands,
read [CLI Reference](cli.md).
