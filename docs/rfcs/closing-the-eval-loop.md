# RFC: Closing The Eval Loop In Do Eval

## Status

Proposed.

## Goal

Improve Do Eval's ability to diagnose, budget, compare, and preserve
coding-agent behavior regressions without turning it into a general
observability platform.

## Context

Do Eval already covers the core coding-agent eval loop:

- resettable trials and suites;
- execution profiles for comparing agents, models, and runtime layers;
- deterministic verification;
- optional LLM judge scoring;
- repeated epochs with aggregate statistics;
- bench reports for profile comparisons;
- regression timelines;
- parsed sessions with tool calls, file writes, plugin events, token usage, and
  model info.

The main missing pieces are around closing the loop after a run:

- making cost and budget regressions visible;
- turning traces into reusable assertions;
- making traces easier to inspect;
- converting failed or interesting runs back into repeatable trials.

## Actors

- Eval author: defines trials, suites, scoring, and expected behavior.
- Extension author: uses eval results to improve a Pi or Codex extension.
- Maintainer: reviews regressions and decides whether a change is safe to ship.
- Agent profile author: compares models, harnesses, plugin layers, and runtime
  configuration.

## Value-Effort Matrix

| Gap | Value | Effort | Recommendation | Reason |
|---|---:|---:|---|---|
| Cost estimation from token usage | High | Low | Do now | Token usage and model info already exist on `EvalSession`; reports can compute estimated cost with a price table. |
| Budget assertions for cost, tokens, duration, and session size | High | Low | Do now | `BudgetConfig` already models token, duration, tool-call, blocked-call, and file-write limits. The gap is first-class scoring/report behavior. |
| Better trace and timeline viewer | High | Medium | Do now | Parsed sessions and live snapshots already exist. Better UI would expose the data Do Eval already captures. |
| Trace-derived assertions | High | Medium | Do now | Tool calls, blocked calls, file writes, and plugin events can support reusable behavioral checks. |
| Promote logs or runs into trials | High | Medium | Plan next | This converts real failures into regression coverage, which is the strongest missing loop from production eval practice. |
| Production log ingestion | Medium-High | Medium | Plan next | Useful if implemented as a local import format, but it should not require a production SDK or hosted backend. |
| Human review and labeling workflow | Medium | Medium | Plan next | Useful for subjective scoring, but can start as local annotations before becoming a full review queue. |
| Vector search versus tool-based exploration benchmark primitives | Medium | Medium | Plan next | Fits naturally as profile conventions and reusable trace assertions, not as a separate benchmark subsystem. |
| General nested span tracing | Medium | High | Defer | Useful for distributed apps, but outside the current session-centric coding-agent model. |
| Natural-language experiment analysis | Medium | High | Defer | Attractive, but structured filtering, summaries, and trace assertions should come first. |
| Synthetic dataset generation | Medium | High | Defer | Helpful later, but premature before curated trials and run-promotion workflows are strong. |
| Full Braintrust-style observability SDK | Low-Medium | Very High | Avoid for now | This would blur the project's focus and create a large product surface unrelated to local coding-agent evals. |

## Proposed Phases

### Phase 1: Cost And Budget Guardrails

Add first-class cost estimation and budget assertion reporting.

Behavior:

- A run report shows estimated input, output, total token cost, and total cost
  when the model has known pricing.
- A suite report aggregates cost across runs and epochs.
- Bench reports show cost deltas between profiles.
- Budget violations appear as findings and can affect deterministic scores when
  configured.
- Unknown pricing does not fail a run; it produces an explicit "cost unavailable"
  note.

Acceptance:

- Given a run with token usage and known model pricing, when the report is
  written, then `report.json` includes estimated cost fields.
- Given a suite with multiple runs, when the suite report is written, then the
  suite includes total and average estimated cost.
- Given a bench with baseline and treatment profiles, when both profiles have
  cost data, then the bench report includes cost deltas.
- Given a configured max token, duration, tool-call, blocked-call, file-write,
  or cost budget, when a run exceeds it, then the run includes a finding naming
  the violated budget and the observed value.
- Given a model without pricing data, when cost estimation runs, then reports
  keep token data and mark cost as unavailable instead of fabricating a value.

Proof:

- Unit tests for known, unknown, and partially known pricing.
- Unit tests for every budget assertion currently represented by
  `BudgetConfig`.
- Reporter tests proving cost and budget findings are serialized into
  `report.json` and summarized in `report.md`.

### Phase 2: Trace-Derived Assertions

Add reusable assertions over normalized sessions.

Candidate assertions:

- required tool call pattern, such as running tests or verification;
- forbidden tool call pattern, such as disallowed search tools in constrained
  benchmarks;
- maximum retries or repeated identical commands;
- maximum blocked tool calls;
- maximum file churn;
- required or forbidden file categories;
- required plugin events;
- no edits outside expected paths.

Acceptance:

- Given a configured required tool pattern, when no matching tool call appears
  in the session, then the assertion fails with a finding.
- Given a configured forbidden tool pattern, when a matching tool call appears,
  then the assertion fails with the tool name and timestamp.
- Given a max repeated-command threshold, when the same command exceeds the
  threshold, then the assertion fails with the observed count.
- Given file category assertions and a plugin `classifyFile`, when file writes
  violate the rule, then the report names the affected category and paths.
- Given assertion failures, when scoring runs, then assertion results are
  included in deterministic scores or findings according to config.

Proof:

- Unit tests over synthetic `EvalSession` objects.
- Integration test with a fixture session that includes blocked calls, repeated
  commands, and file writes.
- Viewer or report snapshot showing assertion findings in run detail.

### Phase 3: Trace And Timeline Diagnosis

Improve the viewer so maintainers can answer why a run passed, failed, or got
more expensive.

Behavior:

- Run detail includes a chronological timeline of tool calls, blocked calls,
  file writes, plugin events, judge output, verification output, and findings.
- Timeline rows can be filtered by event type and search text.
- Expensive or budget-violating sections are visually called out.
- Profile comparisons make it easy to compare trace summaries for the same
  trial and variant.

Acceptance:

- Given a run with parsed session data, when the run detail opens, then the
  viewer shows a chronological timeline without requiring raw JSONL inspection.
- Given a run with blocked tool calls, when the blocked-call filter is enabled,
  then only blocked calls and their context are shown.
- Given a budget violation, when the run detail opens, then the violating metric
  is visible near the related timeline summary.
- Given a bench comparison, when two profiles ran the same trial, then the
  viewer shows side-by-side summary counts for tool calls, file writes, tokens,
  duration, cost, and findings.

Proof:

- Component tests for timeline filtering and summary counts.
- Fixture-backed viewer tests using existing JSONL sessions.
- Manual screenshot review for at least one run detail and one bench detail.

### Phase 4: Promote Runs Into Trials

Make it easy to turn real failures into repeatable regression coverage.

Behavior:

- A run detail can generate a draft trial from the original task, run metadata,
  relevant workdir files, and selected findings.
- The generated trial is written into the eval project as source-controlled
  files.
- The user can edit the task and scaffold before committing it to a suite.
- Promotion preserves enough metadata to trace the trial back to the source run
  without making the trial depend on mutable run artifacts.

Acceptance:

- Given a completed run, when the user promotes it, then Do Eval creates a
  draft trial directory with a task file and scaffold.
- Given a failed verification run, when promoted, then the draft trial includes
  the verification failure summary as context for the eval author.
- Given a promoted trial, when it is run later, then it does not depend on the
  original run directory.
- Given an existing trial name collision, when promotion runs, then the tool
  chooses a unique draft name or asks the caller to provide one.

Proof:

- Unit tests for trial-name generation and metadata serialization.
- Integration test that promotes a fixture run into a trial and executes the
  generated trial with a smoke harness.
- Documentation showing the promote-run workflow.

## Non-Goals

- Production SDK instrumentation.
- Hosted trace storage.
- Arbitrary distributed tracing across app services.
- Natural-language trace querying.
- Multi-user review queues.
- Automatic synthetic dataset generation as a default path.
- A built-in vector database or retrieval engine.

## Open Questions

- Should budget violations affect `overall` by default, or only emit findings?
- Where should model pricing live: bundled static table, project config, or both?
- Should cost estimates be exact fields on `EvalReport`, or derived by the
  viewer from token usage and pricing config?
- What is the minimum useful promoted-trial scaffold for large repos without
  copying too much state?
- Should trace assertions be configured globally, per suite, per trial, or per
  profile?

## Recommended Initial Issues

1. Add cost estimation types and reporter fields.
2. Wire budget assertion evaluation into scoring and findings.
3. Add trace assertion helpers over `EvalSession`.
4. Add run-detail timeline filtering in the viewer.
5. Add a draft "promote run to trial" command or API endpoint.
