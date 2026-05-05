# Running Do Eval

There are three common places you might be standing when you want to run Do
Eval. Pick the one that matches your shell.

## From This Do Eval Checkout

Use this when you are developing Do Eval itself from this repository.

```bash
cd /path/to/pi-do-eval
npm install
npm run build
```

Run the CLI from the checkout against an eval project:

```bash
bun cli/index.ts list --project /path/to/project/eval
bun cli/index.ts tui --project /path/to/project/eval
bun cli/index.ts regression small --project /path/to/project/eval
```

Today the source checkout CLI uses the `bun` shebang in `cli/index.ts`. The
eval projects that depend on this checkout expose the same command as
`do-eval` through `node_modules/.bin`.

## From An Eval Project

Use this when you are inside a repo's `eval/` directory.

```bash
cd /path/to/project/eval
npm install
npm run eval:list
npm run eval
```

Do not expect bare `do-eval` to work in your shell just because `npm install`
completed. npm installs the binary at `node_modules/.bin/do-eval`; npm scripts
can see that directory, but your interactive shell usually cannot.

The scaffolded `package.json` scripts are the easiest path:

```bash
npm run eval:list
npm run eval:trial -- example --variant default
npm run eval:regression
npm run eval:bench
npm run eval
```

You can also run the binary directly:

```bash
npx do-eval list --project .
npx do-eval trial example --variant default --project .
npx do-eval regression small --project .
npx do-eval tui --project .
```

`./node_modules/.bin/do-eval tui --project .` is equivalent if you prefer the
explicit path.

## From Another Directory

Pass `--project` with either the repo root or the `eval/` directory:

```bash
do-eval tui --project ~/sandbox/pi-proof
do-eval tui --project ~/sandbox/pi-proof/eval
do-eval regression small --project ~/sandbox/pi-proof/eval
```

If you pass a repo root, Do Eval looks for `eval/` inside it. If you pass an
eval directory, Do Eval uses it directly.

These examples assume `do-eval` is installed globally or otherwise on your
shell `PATH`. If it is only installed in a specific eval project, run the
command from that eval project with `npm run ...` or `npx do-eval ...`.

## Run The Web Viewer

The TUI is the primary terminal UI for Launch and Runs and starts the web
viewer by default. The browser view is for historical reports, trends, and
comparisons:

```bash
do-eval tui --project /path/to/project/eval --port 4242
do-eval ui --project /path/to/project/eval --port 4242
```

The TUI footer shows `Web starting`, `Web http://localhost:4242`, or
`Web unavailable`. Use `--no-web` when you want the terminal UI without a
local browser server.

## Run The Docs Site

From this Do Eval checkout:

```bash
npm run docs:serve
```

That runs Material for MkDocs through `uvx` and serves
`http://127.0.0.1:8001`.

## Quick Troubleshooting

If `do-eval` is not found inside an eval project, run `npm install` in that
eval directory, then use `npm run eval` or `npx do-eval tui --project .`.

If the source checkout command fails with `bun: command not found`, install Bun
or run through an eval project's `node_modules/.bin/do-eval` after `npm
install`.

If a project cannot be resolved, pass the direct eval directory:

```bash
do-eval list --project /path/to/project/eval
```
