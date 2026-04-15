import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AggregatedSuiteEntry,
  EvalEvent,
  EvalPlugin,
  EvalReport,
  RunIndexEntry,
  SuiteComparison,
} from "./types.js";

const bar = (n: number) => {
  const filled = Math.round(n / 5);
  return "\u2588".repeat(filled) + "\u2591".repeat(20 - filled);
};

export function writeReport(report: EvalReport, runDir: string) {
  fs.mkdirSync(runDir, { recursive: true });
  // Omit rawLines — already saved as session.jsonl
  const { rawLines: _, ...sessionWithoutRaw } = report.session;
  const slimReport = { ...report, session: sessionWithoutRaw };
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(slimReport, null, 2));
  fs.writeFileSync(path.join(runDir, "report.md"), formatMarkdown(report));
}

/** Update runs/index.json with a summary of all runs. */
export function updateRunIndex(runsDir: string, emit?: (event: EvalEvent) => void) {
  const entries: RunIndexEntry[] = [];
  if (!fs.existsSync(runsDir)) return;

  for (const dir of fs.readdirSync(runsDir).sort().reverse()) {
    if (dir === "suites") continue;

    const dirPath = path.join(runsDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const reportPath = path.join(dirPath, "report.json");
    if (fs.existsSync(reportPath)) {
      try {
        const report: EvalReport = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
        entries.push({
          dir,
          trial: report.meta.trial,
          variant: report.meta.variant,
          status: report.meta.status,
          overall: report.scores.overall,
          durationMs: report.meta.durationMs,
          startedAt: report.meta.startedAt,
          workerModel: report.meta.workerModel,
          judgeModel: report.meta.judgeModel,
          suite: report.meta.suite,
          suiteRunId: report.meta.suiteRunId,
          epoch: report.meta.epoch,
          totalEpochs: report.meta.totalEpochs,
        });
      } catch (err) {
        console.warn(`Skipping corrupt report.json in ${dir}:`, err);
      }
      continue;
    }

    // Live run — no report.json yet, but status.json exists
    const statusPath = path.join(dirPath, "status.json");
    if (fs.existsSync(statusPath)) {
      try {
        const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
        entries.push({
          dir,
          trial: status.trial ?? "",
          variant: status.variant ?? "",
          status: status.status ?? "running",
          overall: 0,
          durationMs: 0,
          startedAt: status.startedAt ?? "",
          workerModel: status.workerModel ?? "",
          suite: status.suite,
          suiteRunId: status.suiteRunId,
          epoch: status.epoch,
          totalEpochs: status.totalEpochs,
        });
      } catch (err) {
        console.warn(`Skipping corrupt status.json in ${dir}:`, err);
      }
    }
  }

  fs.writeFileSync(path.join(runsDir, "index.json"), JSON.stringify(entries, null, 2));
  emit?.({ type: "index_updated", timestamp: Date.now(), runs: entries });
}

export function formatMarkdown(report: EvalReport, plugin?: EvalPlugin): string {
  const { meta, scores, findings, judgeResult } = report;
  const lines: string[] = [];
  const scoringIssues = scores.issues ?? [];

  lines.push(`# Eval Report: ${meta.trial} (${meta.variant})`);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|-------|-------|");
  lines.push(`| Variant | ${meta.variant} |`);
  if (meta.suite) lines.push(`| Suite | ${meta.suite} |`);
  if (meta.suiteRunId) lines.push(`| Suite Run | ${meta.suiteRunId} |`);
  lines.push(`| Worker Model | ${meta.workerModel} |`);
  if (meta.judgeModel) lines.push(`| Judge Model | ${meta.judgeModel} |`);
  lines.push(`| Status | ${meta.status} |`);
  lines.push(`| Duration | ${(meta.durationMs / 1000).toFixed(1)}s |`);
  lines.push("");

  lines.push("## Deterministic Scores");
  lines.push("");
  lines.push("| Category | Score |");
  lines.push("|----------|-------|");
  for (const [key, value] of Object.entries(scores.deterministic)) {
    lines.push(`| ${key} | ${value}/100 |`);
  }
  lines.push("");

  if (scores.judge) {
    lines.push("## Judge Scores");
    lines.push("");
    lines.push("| Category | Score |");
    lines.push("|----------|-------|");
    for (const [key, value] of Object.entries(scores.judge)) {
      lines.push(`| ${key} | ${value}/100 |`);
    }
    lines.push("");
  }

  lines.push(`**Overall: ${scores.overall}/100**`);
  lines.push("");

  if (scoringIssues.length > 0) {
    lines.push("## Scoring Issues");
    lines.push("");
    for (const issue of scoringIssues) lines.push(`- ${issue}`);
    lines.push("");
  }

  // Plugin-provided summary
  if (plugin?.formatSummary) {
    const summary = plugin.formatSummary(report.session);
    if (summary.length > 0) {
      lines.push("## Session Summary");
      lines.push("");
      lines.push(...summary);
      lines.push("");
    }
  } else {
    lines.push("## Session Summary");
    lines.push("");
    lines.push(`- Tool calls: ${report.session.toolCalls.length}`);
    lines.push(`- File writes: ${report.session.fileWrites.length}`);
    lines.push(`- Plugin events: ${report.session.pluginEvents.length}`);
    lines.push("");
  }

  if (findings.length > 0) {
    lines.push("## Findings");
    lines.push("");
    for (const f of findings) lines.push(`- ${f}`);
    lines.push("");
  }

  if (judgeResult) {
    lines.push("## Judge Reasoning");
    lines.push("");
    for (const [key, reason] of Object.entries(judgeResult.reasons)) {
      const score = judgeResult.scores[key];
      lines.push(`**${key}${score !== undefined ? ` (${score}/100)` : ""}:** ${reason}`);
      lines.push("");
    }
    if (judgeResult.findings.length > 0) {
      lines.push("**Judge findings:**");
      for (const f of judgeResult.findings) lines.push(`- ${f}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function printSummary(report: EvalReport) {
  const { meta, scores } = report;

  console.log(`\n${meta.trial}/${meta.variant} (${meta.status})`);
  for (const [key, value] of Object.entries(scores.deterministic)) {
    console.log(`  ${key.padEnd(18)} ${bar(value)} ${value}`);
  }
  if (scores.judge) {
    for (const [key, value] of Object.entries(scores.judge)) {
      console.log(`  ${key.padEnd(18)} ${bar(value)} ${value} (judge)`);
    }
  }
  console.log(`  ${"Overall".padEnd(18)} ${bar(scores.overall)} ${scores.overall}`);
  const models = `worker: ${meta.workerModel}${meta.judgeModel ? ` | judge: ${meta.judgeModel}` : ""}`;
  console.log(`  ${(meta.durationMs / 1000).toFixed(0)}s | ${models}\n`);
}

export function printAggregatedSummary(entry: AggregatedSuiteEntry) {
  const fmt = (stats: { mean: number; stderr: number }) =>
    stats.stderr > 0
      ? `${Math.round(stats.mean * 10) / 10} +/-${Math.round(stats.stderr * 10) / 10}`
      : `${Math.round(stats.mean * 10) / 10}`;

  console.log(`\n${entry.trial}/${entry.variant} (${entry.epochs} epochs)`);
  for (const [key, stats] of Object.entries(entry.deterministic)) {
    console.log(`  ${key.padEnd(18)} ${bar(stats.mean)} ${fmt(stats)}`);
  }
  if (entry.judge) {
    for (const [key, stats] of Object.entries(entry.judge)) {
      console.log(`  ${key.padEnd(18)} ${bar(stats.mean)} ${fmt(stats)} (judge)`);
    }
  }
  console.log(`  ${"Overall".padEnd(18)} ${bar(entry.overall.mean)} ${fmt(entry.overall)}`);

  const completedCount = entry.statusCounts.completed ?? 0;
  console.log(
    `  range: ${entry.overall.min}-${entry.overall.max} | ${completedCount}/${entry.epochs} completed | ${entry.verifyPassCount}/${entry.epochs} verified\n`,
  );
}

export function printSuiteComparison(comparison: SuiteComparison, workerModel?: string) {
  const modelLabel = workerModel ? ` [${workerModel}]` : "";
  console.log(
    `\nSuite: ${comparison.suite}${modelLabel} (baseline: ${comparison.baselineSuiteRunId} -> current: ${comparison.currentSuiteRunId})\n`,
  );

  for (const entry of comparison.entries) {
    const label = `${entry.trial}/${entry.variant}`;
    const delta = entry.deltaOverall !== undefined ? `(${entry.deltaOverall > 0 ? "+" : ""}${entry.deltaOverall})` : "";
    const sev =
      entry.severity === "hard"
        ? "HARD"
        : entry.severity === "clear"
          ? "CLEAR"
          : entry.severity === "drift"
            ? "drift"
            : "";
    const finding = entry.findings[0] ?? "";

    if (sev) {
      console.log(`  ${label.padEnd(30)} ${delta.padEnd(10)} ${sev}`);
    } else {
      console.log(`  ${label.padEnd(30)} ${delta.padEnd(10)} ok`);
    }
    if (finding) console.log(`    ${finding}`);
  }

  const parts: string[] = [];
  if (comparison.hardRegressionCount > 0) parts.push(`${comparison.hardRegressionCount} hard`);
  if (comparison.clearRegressionCount > 0) parts.push(`${comparison.clearRegressionCount} clear`);
  if (comparison.driftCount > 0) parts.push(`${comparison.driftCount} drift`);
  console.log(`\n  ${parts.length > 0 ? parts.join(", ") : "no regressions"}\n`);
}
