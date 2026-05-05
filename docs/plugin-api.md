# Plugin API

An eval plugin defines how Do Eval should prompt, verify, score, and judge a
project. Most eval projects have one plugin in `eval/plugins/<project>.ts`.

## Minimal Shape

```ts
import type { EvalPlugin } from "do-eval";

const plugin: EvalPlugin = {
  name: "my-project",
  extensionPath: "/absolute/path/to/runtime/entry",

  verify(workDir) {
    return { passed: true, output: "not implemented", metrics: {} };
  },

  scoreSession(session, verify) {
    return {
      scores: { correctness: verify.passed ? 100 : 0 },
      weights: { correctness: 1 },
      findings: [],
    };
  },

  buildJudgePrompt(taskDescription, workDir) {
    return [
      "Evaluate this implementation. Respond with only JSON.",
      "",
      "Task:",
      taskDescription,
      "",
      "Workdir:",
      workDir,
    ].join("\n");
  },
};

export default plugin;
```

## Hooks

`name` identifies the plugin. Trial manifests refer to this name with
`plugin: <name>`.

`extensionPath` is used by the Pi harness when launching the extension under
test. Codex profiles may not need it, but it remains part of the plugin
contract.

`verify(workDir)` runs independent checks after the worker finishes. Return
`passed`, human-readable `output`, and numeric `metrics`.

`scoreSession(session, verify)` returns deterministic 0-100 scores, weights,
and findings. This is the most important hook for reliable evals.

`buildJudgePrompt(taskDescription, workDir)` builds the prompt for the optional
LLM judge. The judge must return parseable JSON scores and findings.

`buildPrompt(context)` can replace the default worker prompt. Use it when the
task file needs variant data or project-specific framing.

`configure(context)` runs once before scoring and lets the plugin observe the
trial manifest, selected variant, task count, and monorepo hint.

`afterRun(context)` can write extra artifacts after the run.

`classifyFile(filePath)` labels file writes for reports and scoring.

`parseEvent(toolName, resultText, timestamp)` extracts domain-specific events
from tool results.

`formatSummary(session)` adds custom summary lines to reports.

## Typed Variants

Variants are open-ended YAML objects. Extend `TrialVariant` to type the fields
your plugin reads:

```ts
import type { EvalPlugin, TrialVariant } from "do-eval";

interface Variant extends TrialVariant {
  stack?: {
    language: string;
    testFramework: string;
  };
}

const plugin: EvalPlugin<Variant> = {
  name: "my-project",
  extensionPath: "...",

  buildPrompt({ taskDescription, variant }) {
    return [
      taskDescription,
      "",
      `Use ${variant.stack?.language ?? "the project language"}.`,
    ].join("\n");
  },

  configure({ variant, taskCount }) {
    void variant.stack;
    void taskCount;
  },

  scoreSession(session, verify) {
    return {
      scores: { correctness: verify.passed ? 100 : 0 },
      weights: { correctness: 1 },
      findings: [],
    };
  },

  buildJudgePrompt(taskDescription) {
    return `Return JSON scores for:\n${taskDescription}`;
  },
};
```

Do Eval reserves `label` for UI display. Other variant fields belong to the
eval project.

## Scoring Guidance

Use deterministic scores for facts you can check:

- tests passed
- typecheck passed
- expected file changed
- forbidden file was untouched
- expected command was run
- session stayed under a budget

Use judge scores for subjective review:

- implementation quality
- maintainability
- task understanding
- whether the result matches ambiguous product intent

Judge scores are separate from deterministic scores and default to a low
weight unless the plugin opts them into `overall`.

## Verification Pattern

A common `verify()` implementation runs commands in `workDir` and records
output:

```ts
import { spawnSync } from "node:child_process";

verify(workDir) {
  const result = spawnSync("npm", ["test"], {
    cwd: workDir,
    encoding: "utf-8",
  });
  return {
    passed: result.status === 0,
    output: `${result.stdout}\n${result.stderr}`.trim(),
    metrics: { exitCode: result.status ?? 1 },
  };
}
```

Keep verification independent of the agent transcript. It should inspect the
files the agent produced, not what the agent claimed.
