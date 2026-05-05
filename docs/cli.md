# Do Eval CLI Reference

All commands accept either a project repo root or a direct `eval/` directory
when they expose `--project`.

If you are trying to decide how to invoke the command from your current shell,
start with [Running Do Eval](running.md).

Inside an eval project, prefer the generated npm scripts, for example
`npm run eval`, `npm run eval:list`, and `npm run eval:regression`. Bare `do-eval` only
works when the binary is globally installed or on your shell `PATH`; otherwise
use `npx do-eval ...`.

## Scaffold

```bash
npx do-eval init
```

Creates `eval/` in the current repo. Run it from the root of the project you
want to evaluate.

## TUI

```bash
do-eval tui [--project <path>] [--port <port>] [--no-web]
```

Starts the terminal Launch and Runs view. By default it starts or reuses
the local web viewer, probes `/api/projects`, and only shows the URL as ready
after the viewer responds. `--port` controls that web viewer port. `--no-web`
keeps the TUI terminal-only.

## Web Viewer

```bash
do-eval ui [--project <path>] [--port <port>]
do-eval view [--project <path>] [--port <port>]
do-eval ui-dev [--project <path>] [--host <host>] [--port <port>]
```

`ui` starts the built SvelteKit viewer. `view` is an alias. `ui-dev` starts the
Vite dev server from a local Do Eval checkout.

Default port order:

1. `--port`
2. `EVAL_PORT`
3. `4242`

## Project Registry

```bash
do-eval project add [path]
do-eval project list
do-eval project use <id|path>
do-eval project remove <id|path>
```

The registry is per user. It lets the TUI and web viewer switch between eval
projects without restarting.

## List Project Contents

```bash
do-eval list [--project <path>]
```

Prints trials, variants, suites, profiles, and benches.

## Trial

```bash
do-eval trial <trial> \
  [--variant <variant>] \
  [--profile <profile>] \
  [--provider <provider>] \
  [--model <model>] \
  [--no-judge] \
  [--project <path>]
```

Runs one trial variant. Defaults to the `default` variant.

Use this while authoring or debugging one task.

## Regression

```bash
do-eval regression <suite> \
  [--profile <profile>] \
  [--provider <provider>] \
  [--model <model>] \
  [--no-judge] \
  [--project <path>]
```

Runs one profile over a suite and records the result in that profile's
regression timeline.

## Bench

```bash
do-eval bench <suite> [--no-judge] [--project <path>]
```

Runs the configured bench for a suite. Bench configuration lives in
`eval.config.ts` under `benches`.

## Suites

```bash
do-eval suite list [--project <path>]
do-eval suite show <name> [--project <path>]
do-eval suite create <name> <trial[:variant]>... \
  [--description <text>] \
  [--threshold <number>] \
  [--force] \
  [--project <path>]
do-eval suite add <name> <trial[:variant]>... [--project <path>]
do-eval suite remove <name> <trial[:variant]>... [--project <path>]
```

Suites are YAML files under `eval/suites/*.yaml`. `suite create` refuses to
replace an existing suite unless `--force` is present.

## Environment

`EVAL_PORT` sets the default web/TUI URL port when `--port` is omitted.

`PI_DO_EVAL_CONFIG_HOME` overrides the base config directory for the project
registry. The registry path keeps the historical `pi-do-eval` directory name
for compatibility.
