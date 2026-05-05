# Do Eval

Do Eval is a local-first evaluation harness for coding agents. It runs fixed
coding tasks against Pi, Codex, or another registered harness; verifies the
resulting workdir; scores the normalized session; and tracks regressions over
time.

Use these docs in order if you are new:

1. [Concepts](concepts.md): learn projects, trials, variants, suites, profiles,
   launch modes, runs, and reports.
2. [Running Do Eval](running.md): choose the right command from the source
   checkout, an eval project, another directory, or the docs site.
3. [Getting Started](getting-started.md): scaffold an eval project and turn the
   example into a real trial.
4. [CLI Reference](cli.md): run Trial, Regression, Bench, TUI, web viewer, and
   suite commands.
5. [Plugin API](plugin-api.md): define verification, scoring, judge prompts,
   prompt hooks, and typed variants.
6. [Lower-Level API](lower-level-api.md): embed `runEval`, live mode, reports,
   harness adapters, and sandboxing in custom tooling.

## Run It Now

From an eval project:

```bash
npm install
npm run eval:list
npm run eval
```

If `do-eval` is not found in your shell, that is expected for a local eval
project. Use `npm run eval` or `npx do-eval tui --project .`.

From this Do Eval checkout:

```bash
npm install
npm run build
bun cli/index.ts tui --project /path/to/project/eval
```

For maintainers, [Architecture](design.md) explains the current module
boundaries and [Agent Harness Adapters](agent-harness-adapters.md) explains how
runtime-specific agent support fits behind the shared runner.

## Run The Docs Locally

Start the Material for MkDocs dev server:

```bash
npm run docs:serve
```

That runs MkDocs through `uvx` and opens the site at
`http://127.0.0.1:8001`.

Build the static site:

```bash
npm run docs:build
```
