# Pi (don't) do Eval

A general-purpose eval framework for [Pi](https://github.com/anthropics/pi) extensions. Pi is an AI coding agent; extensions customize its behavior for specific workflows. This library helps you measure whether an extension actually works -- using Pi itself as both the worker (running the extension under test) and the judge (evaluating output quality). No separate eval platform needed; evals run through your existing Pi setup.

## How it works

1. Copies the project prompt and scaffold files (if any) into a fresh working directory
2. Spawns `pi -p --mode json -e <extensionPath>` with the extension under test
3. Captures JSONL events -- tool calls, file writes, plugin-specific state changes
4. After the session completes, the plugin optionally runs independent verification
5. Spawns `pi -p --mode json --no-extensions` as the judge to evaluate output quality
6. Plugin scores and judge scores are combined into a weighted final report

The eval prompt is deliberately minimal -- the extension's system prompt must drive the behavior on its own.

## Key concepts

**Plugin** -- Each extension provides an eval plugin that defines what "good" looks like. A TDD extension might score test-before-code ordering; a code review extension might score issue detection accuracy. The plugin handles domain-specific parsing, scoring, and judge prompting while the framework handles orchestration.

**Project** -- A small, self-contained coding task used as eval input. Each project contains a prompt document (called a PRD), an optional scaffold, and a config that maps it to a plugin.

**Scoring** -- Two sources of scores are combined into a weighted average: deterministic scores computed by the plugin (e.g. "did the tests pass?") and LLM judge scores from a second Pi session that evaluates output quality.

## Quick start

Install dependencies:

```bash
npm install
```

Run an eval programmatically:

```typescript
import {
  runEval,
  scoreSession,
  runJudge,
  writeReport,
  printSummary,
  defaultVerify,
  type EvalPlugin,
  type RunOptions,
} from "pi-dont-do-eval";

// 1. Define your plugin (or import one)
const myPlugin: EvalPlugin = {
  name: "my-extension",
  extensionPath: "/path/to/my/extension/index.ts",
  scoreSession(session, verify) {
    // Your deterministic scoring logic
    return { scores: { correctness: 80 }, weights: { correctness: 0.5 }, findings: [] };
  },
  buildJudgePrompt(prd, workDir) {
    return `Evaluate the implementation in ${workDir} against this PRD:\n${prd}`;
  },
};

// 2. Run the extension against a project
const result = await runEval({
  projectDir: "./projects/my-project",
  workDir: "/tmp/eval-run",
  prompt: "Implement all user stories in the attached PRD.",
  extensionPath: myPlugin.extensionPath,
});

// 3. Verify and score
const verify = myPlugin.verify?.("/tmp/eval-run") ?? defaultVerify();
const judgeResult = await runJudge({
  workDir: "/tmp/eval-run",
  prompt: myPlugin.buildJudgePrompt(prdContents, "/tmp/eval-run"),
});

const scores = scoreSession({
  session: result.session,
  verify,
  plugin: myPlugin,
  judgeResult,
});
```

## Writing a plugin

Each extension provides an eval plugin that implements the `EvalPlugin` interface:

```typescript
interface EvalPlugin {
  name: string;
  extensionPath: string;                // path to the Pi extension under test

  // Optional: extract domain events from tool results
  parseEvent?(toolName: string, resultText: string, timestamp: number): PluginEvent[];

  // Optional: classify files (e.g. "test", "source", "config")
  classifyFile?(filePath: string): string;

  // Required: deterministic scoring from parsed session data
  scoreSession(session: EvalSession, verify: VerifyResult): PluginScoreResult;

  // Required: build the prompt sent to the LLM judge
  buildJudgePrompt(prd: string, workDir: string): string;

  // Optional: run independent verification (e.g. execute tests, lint)
  verify?(workDir: string): VerifyResult;

  // Optional: custom summary lines for reports
  formatSummary?(session: EvalSession): string[];
}
```

`scoreSession` returns deterministic scores, their weights, and human-readable findings:

```typescript
interface PluginScoreResult {
  scores: Record<string, number>;   // e.g. { correctness: 85, structure: 70 }
  weights: Record<string, number>;  // e.g. { correctness: 0.5, structure: 0.3 }
  findings: string[];               // e.g. ["Missing error handling in parser module"]
}
```

`buildJudgePrompt` produces the prompt for a second Pi session (with no extensions) that evaluates output quality. The judge returns JSON with scores, reasons, and findings.

### Full plugin skeleton

Create `plugins/<name>.ts` exporting an `EvalPlugin`. Set `extensionPath` to the Pi extension's entry file, implement `scoreSession` with deterministic checks, and implement `buildJudgePrompt` with evaluation criteria.

```typescript
import type { EvalPlugin } from "pi-dont-do-eval";

export const plugin: EvalPlugin = {
  name: "my-extension",
  extensionPath: "../my-extension/src/index.ts",

  classifyFile(filePath) {
    if (filePath.includes(".test.") || filePath.includes("_test.")) return "test";
    return "source";
  },

  scoreSession(session, verify) {
    const scores: Record<string, number> = {};
    const weights: Record<string, number> = {};
    const findings: string[] = [];

    // Score based on verification results
    scores.correctness = verify.passed ? 100 : 0;
    weights.correctness = 0.5;

    // Score based on session analysis
    const fileCount = session.fileWrites.length;
    scores.productivity = Math.min(100, fileCount * 10);
    weights.productivity = 0.2;

    return { scores, weights, findings };
  },

  buildJudgePrompt(prd, workDir) {
    return [
      "Evaluate the implementation quality.",
      `PRD:\n${prd}`,
      `Working directory: ${workDir}`,
      "Return JSON: { quality: <0-100>, quality_reason: '...', findings: [...] }",
    ].join("\n\n");
  },
};
```

## Creating a project

Projects live in `projects/<name>/` and contain:

| File | Description |
|------|-------------|
| `PRD.md` | The task prompt the extension must implement |
| `scaffold/` | Optional starter files copied into the working directory |

The framework copies both into the working directory before spawning Pi. How you organise and discover projects is up to your eval harness.

### Example projects

These ship with a TDD plugin as examples. Any extension can define its own projects with its own plugin.

| Project | Description | Variants |
|---------|-------------|----------|
| `stack-calc` | Stack-based calculator | TS, Python, Go |
| `temp-api` | Temperature conversion API | Python, TS, Go |
| `todo-cli` | CLI todo manager | Rust, Go, TS |
| `word-freq` | Word frequency counter | Go, Python, TS |
| `fullstack-notes` | Notes app monorepo | TS |
| `fizzbuzz-polyglot` | FizzBuzz with custom rules | C, TS, Ruby |

## Scoring

Scores come from two sources, combined into a weighted average:

**Deterministic** (from the plugin's `scoreSession`):
- Extension-specific metrics defined by the plugin
- Correctness via independent verification (if the plugin implements `verify`)

**LLM Judge** (Pi as evaluator, no extensions loaded):
- Quality criteria defined by the plugin's `buildJudgePrompt`
- Judge scores that lack explicit weights default to 0.1

The overall score is a weighted average of all deterministic and judge scores.

## Run output

Each run creates a timestamped directory under `runs/` containing:

| File | Description |
|------|-------------|
| `report.json` | Structured scores (deterministic + judge) |
| `report.md` | Human-readable results with judge reasoning |
| `session.jsonl` | Raw Pi session for debugging |
| `workdir/` | The project the agent built |

An `index.json` at `runs/index.json` summarizes all runs for the report viewer (`npm run view`).

## Configuring models

Both worker and judge use Pi's settings from `~/.pi/agent/settings.json`. To change models, update your Pi configuration before running evals.

## Development

```bash
npm test          # Run framework tests (vitest)
npm run lint      # Biome lint + format check
npm run lint:fix  # Auto-fix lint issues
```
