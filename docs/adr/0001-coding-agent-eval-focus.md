# ADR 0001: Keep Do Eval Focused On Coding-Agent Evals

## Status

Accepted.

## Date

2026-05-02

## Context

Do Eval is strongest as a framework for evaluating coding agents on real
tasks. It already supports resettable trials, suites, repeated epochs,
deterministic verification, optional LLM judge scoring, profile comparisons,
regression tracking, session parsing, and a viewer for run history.

Recent comparison against Braintrust-style eval workflows highlighted a set of
features Do Eval does not currently provide:

- production observability SDKs;
- production log sampling into datasets;
- natural-language experiment analysis;
- general nested span tracing across arbitrary services;
- human labeling and review workflows;
- first-class cost estimation;
- reusable trace-derived assertions;
- direct support for benchmark patterns such as vector search versus tool-based
  repository exploration.

Those gaps are not equally relevant to Do Eval's purpose. Some are natural
extensions of the current coding-agent harness. Others would shift the project
toward becoming a general observability and eval platform.

## Decision

Keep Do Eval focused on faithful coding-agent evaluation rather than
building a general Braintrust-style observability platform.

Selectively add features that close the coding-agent eval loop:

- estimate and compare run cost from recorded token usage;
- turn token, duration, tool-call, blocked-call, and file-write budgets into
  reusable assertions;
- expose richer trace and timeline diagnosis in the viewer;
- support trace-derived assertions such as required verification, forbidden
  tools, excessive retries, and excessive file churn;
- make it easy to promote failed or interesting runs into repeatable trials;
- support benchmark patterns through execution profiles, harness config, and
  reusable trial conventions.

Defer broad platform features unless they directly support coding-agent
regression diagnosis:

- production observability SDKs;
- arbitrary service span tracing;
- natural-language experiment analysis;
- full human labeling queues;
- synthetic dataset generation as a primary workflow.

## Consequences

Do Eval remains narrower than Braintrust, LangSmith, Humanloop, Promptfoo,
and DeepEval. That is intentional. Its advantage is running coding agents in
realistic workdirs, parsing their sessions, verifying the resulting code, and
comparing behavior over fixed tasks.

The project should prefer small, source-controlled, local-first additions over
cloud-product surface area. New capabilities should usually attach to existing
concepts: trials, suites, profiles, reports, session parsing, scoring, and the
viewer.

Feature proposals that require a production SDK, hosted trace backend,
multi-user labeling workflow, or natural-language analytics layer should be
treated as separate product decisions, not assumed as part of the core roadmap.

## Non-Goals

- Do not make Do Eval a general-purpose production observability platform.
- Do not require users to send traces, prompts, or code to a hosted service.
- Do not replace deterministic verification with judge-only scoring.
- Do not optimize for generic chatbot or RAG evals at the expense of coding
  agent behavior.
- Do not add broad synthetic-data generation before the fixed-trial workflow is
  strong.

## Follow-Up

The implementation plan for the selected features is tracked in
[`RFC: Closing The Eval Loop In Do Eval`](../rfcs/closing-the-eval-loop.md).
