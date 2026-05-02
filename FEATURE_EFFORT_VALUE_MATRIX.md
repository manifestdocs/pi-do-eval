# Feature Effort/Value Matrix for `do-eval`

This document compares `do-eval` to tools like Promptfoo and DeepEval, focusing on low-hanging features that would improve `do-eval` as a Pi extension evaluation harness.

The goal is not to turn `do-eval` into a general-purpose LLM eval platform. The goal is to identify additions that improve agent iteration, diagnosis, and non-regression tracking on a fixed trial set.

## Current Positioning

`do-eval` is strongest when evaluating:

- Pi extensions running in the real Pi runtime
- End-to-end agent behavior across full tasks
- Tool use, file writes, and plugin-defined events
- Deterministic verification plus optional judge scoring
- Repeated fixed-trial regression tracking

Compared to Promptfoo and DeepEval, it is narrower but more faithful to actual Pi extension behavior.

## Effort / Value Matrix

| Feature | Inspired by | Value | Effort | Why it fits `do-eval` |
|---|---|---:|---:|---|
| Built-in budget assertions for `cost`, `latency`, and `token usage` | Promptfoo assertions/metrics | High | Low | `do-eval` already records duration and token data, so threshold checks would add immediate non-regression guardrails. |
| Cost estimation per run | Promptfoo cost tracking, general eval tooling practice | High | Low | Token counts are already recorded, so adding estimated cost per run is straightforward and immediately useful for budget tracking. |
| Built-in agent behavior assertions | Promptfoo trace assertions | High | Med | `do-eval` already parses tool calls and file writes, so rules like "too many reads", "no verify step", or "blocked tools used" fit naturally. |
| Named sub-scores / component results in reports | Promptfoo JS assertions `componentResults` / `namedScores` | High | Low | This is partially present already via named `deterministic` and `judge` score maps. The remaining work is richer plugin output conventions and better viewer/report presentation. |
| Reusable rubric-based judge helpers | Promptfoo `llm-rubric`, DeepEval `G-Eval` | Med | Low-Med | Plugins currently hand-roll judge prompts. A rubric helper would standardize subjective scoring, but it is lower urgency while there is only one primary plugin author. |
| Judge/result caching | Promptfoo caching | Med-High | High | Re-running suites is expensive, but correct cache keys would need to account for the judge prompt, model, and the effective contents of the workdir. The value is real, but the implementation complexity is higher than it first appears. |
| Reusable metric bundles / local metric collections | DeepEval metric collections | Med | Med | Useful once multiple extensions share scoring patterns, but premature while there is only one main consumer. |
| Trace/timeline assertions in viewer and scoring | Promptfoo tracing | Med | Med | The session timeline already exists; turning it into scoreable rules is more valuable than adding a separate tracing system. |
| Dataset/trial generation from seed tasks | Promptfoo dataset generation | Med | Med-High | Helpful for creating broader coverage, but less urgent than making fixed trials easier to score and diagnose. |
| Synthetic user simulation / conversational eval generation | DeepEval simulation/multi-turn | Med | High | Potentially useful later, but not especially low-hanging for a Pi extension harness. |
| Large library of prebuilt semantic metrics | DeepEval prebuilt metrics | Low-Med | High | Most of these are better suited to generic chatbot/RAG evaluation than extension behavior over real Pi runs. |

## Recommended Next 4

These are the highest-value additions with the best effort-to-return ratio:

1. Built-in budget assertions
2. Built-in agent behavior assertions
3. Cost estimation per run
4. Reusable rubric-based judge helpers

## Why These 4 Come First

### 1. Built-in budget assertions

These would let extension authors fail or flag runs based on:

- total duration
- input/output tokens
- estimated cost

This is cheap to add because the framework already has most of the raw data. It is also directly useful for non-regression tracking.

### 2. Built-in agent behavior assertions

This is where `do-eval` has the biggest structural advantage over generic eval tools.

Because it already parses tool calls and file writes, it can support reusable assertions such as:

- maximum tool-call count
- maximum blocked-tool count
- required verify/test step
- required file categories touched
- excessive churn or rewrite count

These are deeply relevant to Pi extension engineers and catch regressions that a high final score can miss.

### 3. Cost estimation per run

This is effectively the simplest budget feature to add because the framework already records token counts and model info.

It would make it much easier to answer:

- Did this agent version become more expensive?
- Did a prompt or tool-use change save tokens?
- Is quality improving at an unacceptable cost increase?

This is high value for almost no conceptual complexity.

### 4. Reusable rubric-based judge helpers

Right now, each plugin writes its own judge prompt. That leads to inconsistent judge behavior across evals.

A helper layer could:

- define common rubric shapes
- standardize judge JSON response structure
- make subjective evaluation less ad hoc

This is still useful, but less urgent than hard regression guardrails while there is only one main plugin author.

## Partially Present Already

Some items in the matrix are not pure greenfield work:

- Named sub-scores already exist in a basic form through `scores.deterministic` and `scores.judge`
- Timeline/tracing data already exists in the viewer
- Token usage and duration are already captured, which lowers the effort for budget features

That means the highest-return work is often on scoring conventions, built-in assertions, and viewer/report UX rather than brand-new infrastructure.

## Features To Delay

These are plausible, but not the best next move:

- red teaming / security scanning
- synthetic task generation before the fixed trial set is strong
- large prebuilt metric libraries
- cloud collaboration / observability platform features
- broad multi-modal or simulation-heavy evaluation systems

These are more aligned with Promptfoo and DeepEval as larger eval platforms than with `do-eval` as a focused Pi extension harness.

## Recommendation

The best strategy is to borrow selectively:

- borrow lightweight, reusable scoring primitives from Promptfoo
- borrow rubric and metric-bundling ideas from DeepEval
- keep `do-eval` centered on real Pi runs, fixed trials, deterministic verification, and extension-specific behavior analysis

That preserves the main advantage of `do-eval`: evaluating the extension as an actual working agent rather than as a generic prompt or model output.

## Sources

- Promptfoo intro: <https://www.promptfoo.dev/docs/intro/>
- Promptfoo coding-agent evals: <https://www.promptfoo.dev/docs/guides/evaluate-coding-agents/>
- Promptfoo getting started/config: <https://www.promptfoo.dev/docs/getting-started/>
- Promptfoo LLM rubric: <https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/>
- Promptfoo JavaScript assertions: <https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/>
- DeepEval overview: <https://deepeval.com/>
- Confident AI / DeepEval metrics overview: <https://www.confident-ai.com/docs/documentation/metrics/introduction>
- Confident AI custom metrics: <https://www.confident-ai.com/docs/documentation/metrics/custom-metrics>
- Confident AI G-Eval: <https://www.confident-ai.com/docs/documentation/metrics/custom-metrics/g-eval>
