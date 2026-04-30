import * as fs from "node:fs";
import * as path from "node:path";
import { parseJsonWith } from "../contracts/codec.js";
import { benchReportCodec } from "../contracts/domain.js";
import type { BenchEntry, BenchIndexEntry, BenchReport, SuiteReport } from "./types.js";

const BENCH_DIR_NAME = "bench";
const BENCH_INDEX_FILE = "index.json";

function suiteEntryKey(trial: string, variant: string): string {
  return `${trial}::${variant}`;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function createBenchReport(
  suite: string,
  benchRunId: string,
  suiteReports: Map<string, SuiteReport>,
  startedAt: string,
  completedAt = new Date().toISOString(),
): BenchReport {
  const models = [...suiteReports.keys()];
  const suiteRunIds: Record<string, string> = {};
  for (const [model, report] of suiteReports) {
    suiteRunIds[model] = report.suiteRunId;
  }

  // Collect all trial/variant keys across all models
  const allKeys = new Set<string>();
  const keyMeta = new Map<string, { trial: string; variant: string }>();
  for (const report of suiteReports.values()) {
    for (const entry of report.entries) {
      const key = suiteEntryKey(entry.trial, entry.variant);
      allKeys.add(key);
      keyMeta.set(key, { trial: entry.trial, variant: entry.variant });
    }
  }

  const entries: BenchEntry[] = [];
  for (const key of [...allKeys].sort()) {
    const meta = keyMeta.get(key);
    if (!meta) continue;

    const overall: Record<string, number> = {};
    const deterministic: Record<string, Record<string, number>> = {};

    for (const [model, report] of suiteReports) {
      const match = report.entries.find((e) => suiteEntryKey(e.trial, e.variant) === key);
      if (!match) continue;
      overall[model] = match.overall;
      deterministic[model] = { ...match.deterministic };
    }

    entries.push({ trial: meta.trial, variant: meta.variant, overall, deterministic });
  }

  const averages: Record<string, number> = {};
  for (const [model, report] of suiteReports) {
    averages[model] = roundToTenth(report.summary.averageOverall);
  }

  return { suite, benchRunId, startedAt, completedAt, models, suiteRunIds, entries, averages };
}

export function writeBenchReport(report: BenchReport, runsDir: string): string {
  const benchDir = path.join(runsDir, BENCH_DIR_NAME, `${report.benchRunId}-${report.suite}`);
  fs.mkdirSync(benchDir, { recursive: true });
  fs.writeFileSync(path.join(benchDir, "report.json"), JSON.stringify(report, null, 2));
  return benchDir;
}

export function updateBenchIndex(runsDir: string) {
  const benchDir = path.join(runsDir, BENCH_DIR_NAME);
  if (!fs.existsSync(benchDir)) return;

  const entries: BenchIndexEntry[] = [];
  for (const dir of fs.readdirSync(benchDir)) {
    const dirPath = path.join(benchDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const reportPath = path.join(dirPath, "report.json");
    if (!fs.existsSync(reportPath)) continue;

    try {
      const parsed = parseJsonWith(fs.readFileSync(reportPath, "utf-8"), reportPath, benchReportCodec);
      if (!parsed.ok) throw new Error(parsed.issues.join("; "));
      const report = parsed.value;
      entries.push({
        suite: report.suite,
        benchRunId: report.benchRunId,
        dir,
        completedAt: report.completedAt,
        models: report.models,
        averages: report.averages,
      });
    } catch {
      // skip corrupt files
    }
  }

  entries.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  fs.writeFileSync(path.join(benchDir, BENCH_INDEX_FILE), JSON.stringify(entries, null, 2));
}

export function printBenchComparison(report: BenchReport) {
  const { models, entries, averages } = report;
  if (models.length === 0) return;

  // Shorten model names for display
  const shortName = (m: string) => {
    const parts = m.split("/");
    return parts[parts.length - 1] ?? m;
  };

  const colWidth = Math.max(12, ...models.map((m) => shortName(m).length + 2));
  const labelWidth = Math.max(20, ...entries.map((e) => `${e.trial}/${e.variant}`.length + 2));
  const showDelta = models.length >= 2;

  const pad = (s: string, w: number) => s.padEnd(w);
  const rpad = (s: string, w: number) => s.padStart(w);

  // Header
  console.log(`\n--- Model Comparison: ${report.suite} ---`);
  let header = pad("", labelWidth);
  for (const m of models) header += rpad(shortName(m), colWidth);
  if (showDelta) header += rpad("delta", colWidth);
  console.log(header);

  // Entries
  for (const entry of entries) {
    const label = `${entry.trial}/${entry.variant}`;
    let line = pad(label, labelWidth);
    const scores: (number | undefined)[] = [];
    for (const m of models) {
      const score = entry.overall[m];
      scores.push(score);
      line += rpad(score !== undefined ? String(score) : "--", colWidth);
    }
    if (showDelta && scores.length >= 2) {
      const first = scores[0];
      const last = scores[scores.length - 1];
      if (first !== undefined && last !== undefined) {
        const delta = roundToTenth(first - last);
        line += rpad(`${delta > 0 ? "+" : ""}${delta}`, colWidth);
      } else {
        line += rpad("--", colWidth);
      }
    }
    console.log(line);
  }

  // Averages
  let avgLine = pad("average", labelWidth);
  const avgValues: (number | undefined)[] = [];
  for (const m of models) {
    const avg = averages[m];
    avgValues.push(avg);
    avgLine += rpad(avg !== undefined ? String(avg) : "--", colWidth);
  }
  if (showDelta && avgValues.length >= 2) {
    const first = avgValues[0];
    const last = avgValues[avgValues.length - 1];
    if (first !== undefined && last !== undefined) {
      const delta = roundToTenth(first - last);
      avgLine += rpad(`${delta > 0 ? "+" : ""}${delta}`, colWidth);
    }
  }
  console.log(avgLine);
  console.log();
}
