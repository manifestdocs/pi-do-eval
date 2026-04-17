import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AggregatedSuiteEntry,
  EpochStats,
  EvalReport,
  RegressionStatus,
  StatusCounts,
  SuiteComparison,
  SuiteComparisonEntry,
  SuiteComparisonOptions,
  SuiteIndexEntry,
  SuiteReport,
  SuiteReportEntry,
} from "./types.js";

const DEFAULT_THRESHOLD = 3;
const SUITES_DIR_NAME = "suites";
const SUITE_REPORT_FILE = "report.json";
const SUITE_INDEX_FILE = "index.json";

// -- Epoch statistics -----------------------------------------------------------

export function computeStats(values: number[]): EpochStats {
  const n = values.length;
  if (n === 0) {
    return { mean: 0, stderr: 0, min: 0, max: 0, n, values };
  }
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n <= 1) {
    return { mean, stderr: 0, min: mean, max: mean, n, values };
  }
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  const stderr = Math.sqrt(variance) / Math.sqrt(n);
  return {
    mean,
    stderr,
    min: Math.min(...values),
    max: Math.max(...values),
    n,
    values,
  };
}

function collectValues(
  entries: SuiteReportEntry[],
  getValue: (entry: SuiteReportEntry) => number | undefined,
): number[] {
  return entries.flatMap((entry) => {
    const value = getValue(entry);
    return value === undefined ? [] : [value];
  });
}

export function aggregateEpochEntries(entries: SuiteReportEntry[]): AggregatedSuiteEntry[] {
  const groups = new Map<string, SuiteReportEntry[]>();
  for (const entry of entries) {
    const key = suiteEntryKey(entry);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const result: AggregatedSuiteEntry[] = [];
  for (const [, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = group[0];
    if (!first) continue;
    const overall = computeStats(group.map((e) => e.overall));

    // Aggregate deterministic scores
    const detKeys = [...new Set(group.flatMap((e) => Object.keys(e.deterministic)))];
    const deterministic: Record<string, EpochStats> = {};
    for (const key of detKeys) {
      const values = collectValues(group, (entry) => entry.deterministic[key]);
      if (values.length > 0) deterministic[key] = computeStats(values);
    }

    // Aggregate judge scores (only from epochs that have them)
    let judge: Record<string, EpochStats> | undefined;
    const epochsWithJudge = group.filter(
      (entry): entry is SuiteReportEntry & { judge: Record<string, number> } => entry.judge !== undefined,
    );
    if (epochsWithJudge.length > 0) {
      judge = {};
      const judgeKeys = [...new Set(epochsWithJudge.flatMap((entry) => Object.keys(entry.judge)))];
      for (const key of judgeKeys) {
        const values = epochsWithJudge.flatMap((entry) => {
          const value = entry.judge[key];
          return value === undefined ? [] : [value];
        });
        if (values.length > 0) judge[key] = computeStats(values);
      }
    }

    // Count statuses
    const statusCounts: StatusCounts = {};
    for (const entry of group) {
      statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1;
    }

    // Deduplicate findings preserving order
    const seen = new Set<string>();
    const findings: string[] = [];
    for (const entry of group) {
      for (const f of entry.findings) {
        if (!seen.has(f)) {
          seen.add(f);
          findings.push(f);
        }
      }
    }

    result.push({
      trial: first.trial,
      variant: first.variant,
      epochs: group.length,
      runDirs: group.map((e) => e.runDir),
      overall,
      deterministic,
      ...(judge ? { judge } : {}),
      statusCounts,
      verifyPassCount: group.filter((e) => e.verifyPassed).length,
      findings,
    });
  }

  return result;
}

// -- Suite file helpers ---------------------------------------------------------

function getSuitesDir(runsDir: string): string {
  return path.join(runsDir, SUITES_DIR_NAME);
}

function getLegacySuiteDirName(suite: string, suiteRunId: string): string {
  return `${suiteRunId}-${suite}`;
}

export function getSuiteDirName(suite: string, suiteRunId: string): string {
  return `run=${encodeURIComponent(suiteRunId)}__suite=${encodeURIComponent(suite)}`;
}

function getSuiteReportPath(runsDir: string, suite: string, suiteRunId: string): string {
  const suitesDir = getSuitesDir(runsDir);
  const currentPath = path.join(suitesDir, getSuiteDirName(suite, suiteRunId), SUITE_REPORT_FILE);
  if (fs.existsSync(currentPath)) return currentPath;
  return path.join(suitesDir, getLegacySuiteDirName(suite, suiteRunId), SUITE_REPORT_FILE);
}

function readJsonFile<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (error) {
    console.warn(`Skipping corrupt JSON file at ${filePath}:`, error);
    return undefined;
  }
}

function loadSuiteIndex(runsDir: string): SuiteIndexEntry[] {
  return readJsonFile<SuiteIndexEntry[]>(path.join(getSuitesDir(runsDir), SUITE_INDEX_FILE)) ?? [];
}

export function listSuiteModels(runsDir: string, suite: string): string[] {
  const models = new Set<string>();
  for (const entry of loadSuiteIndex(runsDir)) {
    if (entry.suite === suite && entry.workerModel) models.add(entry.workerModel);
  }
  return [...models];
}

function compareTimestamps(a: string, b: string): number {
  return new Date(b).getTime() - new Date(a).getTime();
}

function compareSuiteIndexEntries(a: SuiteIndexEntry, b: SuiteIndexEntry): number {
  return compareTimestamps(a.completedAt, b.completedAt) || b.suiteRunId.localeCompare(a.suiteRunId);
}

function suiteEntryKey(entry: Pick<SuiteReportEntry, "trial" | "variant">): string {
  return `${entry.trial}::${entry.variant}`;
}

function isHardFailure(entry: SuiteReportEntry): boolean {
  return entry.status !== "completed" || !entry.verifyPassed;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function averageAggregatedOverall(entries: Iterable<AggregatedSuiteEntry>): number {
  const aggregated = [...entries];
  if (aggregated.length === 0) return 0;
  const total = aggregated.reduce((sum, entry) => sum + entry.overall.mean, 0);
  return roundToTenth(total / aggregated.length);
}

function completedCount(entry: AggregatedSuiteEntry): number {
  return entry.statusCounts.completed ?? 0;
}

function rate(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function hasSeparatedRanges(current: EpochStats, baseline: EpochStats): boolean {
  return current.max < baseline.min;
}

function allBelowMean(current: EpochStats, baseline: EpochStats): boolean {
  return current.n > 0 && baseline.n > 0 && current.values.every((v) => v < baseline.mean);
}

function buildSingleEntryMap(entries: SuiteReportEntry[]): Map<string, SuiteReportEntry> {
  const groups = new Map<string, SuiteReportEntry[]>();
  for (const entry of entries) {
    const key = suiteEntryKey(entry);
    const existing = groups.get(key);
    if (existing) existing.push(entry);
    else groups.set(key, [entry]);
  }

  const result = new Map<string, SuiteReportEntry>();
  for (const [key, group] of groups) {
    const entry = group[0];
    if (group.length === 1 && entry) result.set(key, entry);
  }
  return result;
}

function buildAggregatedEntryMap(report: SuiteReport): Map<string, AggregatedSuiteEntry> {
  return new Map(
    (report.aggregated ?? aggregateEpochEntries(report.entries)).map((entry) => [suiteEntryKey(entry), entry]),
  );
}

export function buildSuiteReportEntry(report: EvalReport, runDir: string): SuiteReportEntry {
  return {
    trial: report.meta.trial,
    variant: report.meta.variant,
    runDir,
    status: report.meta.status,
    overall: report.scores.overall,
    verifyPassed: report.meta.verifyPassed,
    deterministic: report.scores.deterministic,
    ...(report.scores.judge ? { judge: report.scores.judge } : {}),
    findings: [...report.findings],
  };
}

export function summarizeSuiteEntries(entries: SuiteReportEntry[]): SuiteReport["summary"] {
  const aggregated = aggregateEpochEntries(entries);
  const hardFailureCount = entries.filter(isHardFailure).length;
  const verifyFailureCount = entries.filter((entry) => !entry.verifyPassed).length;
  const completedRuns = entries.filter((entry) => entry.status === "completed").length;

  return {
    totalRuns: entries.length,
    completedRuns,
    verifyFailureCount,
    hardFailureCount,
    averageOverall: averageAggregatedOverall(aggregated),
  };
}

export function createSuiteReport(
  suite: string,
  suiteRunId: string,
  reports: Array<{ report: EvalReport; runDir: string }>,
  completedAt = new Date().toISOString(),
  epochs?: number,
  workerModel?: string,
): SuiteReport {
  const entries = reports.map(({ report, runDir }) => buildSuiteReportEntry(report, runDir));
  const sortedEntries = [...entries].sort((a, b) => suiteEntryKey(a).localeCompare(suiteEntryKey(b)));
  const aggregated = aggregateEpochEntries(sortedEntries);
  const startedAt =
    reports
      .map(({ report }) => report.meta.startedAt)
      .sort(compareTimestamps)
      .at(-1) ?? completedAt;

  const hasEpochs = epochs !== undefined && epochs > 1;
  const summary = summarizeSuiteEntries(sortedEntries);
  if (hasEpochs) summary.epochs = epochs;

  return {
    suite,
    suiteRunId,
    ...(workerModel ? { workerModel } : {}),
    startedAt,
    completedAt,
    entries: sortedEntries,
    summary,
    ...(hasEpochs ? { epochs, aggregated } : {}),
  };
}

export function writeSuiteReport(report: SuiteReport, runsDir: string): string {
  const suiteDir = path.join(getSuitesDir(runsDir), getSuiteDirName(report.suite, report.suiteRunId));
  fs.mkdirSync(suiteDir, { recursive: true });
  fs.writeFileSync(path.join(suiteDir, SUITE_REPORT_FILE), JSON.stringify(report, null, 2));
  return suiteDir;
}

export function deriveRegressionStatus(comparison: SuiteComparison | undefined): RegressionStatus {
  if (!comparison) return "baseline";
  if (comparison.hasRegression) return "regressed";
  if (comparison.averageDelta > comparison.threshold) return "improved";
  return "stable";
}

export function updateSuiteIndex(runsDir: string) {
  const suitesDir = getSuitesDir(runsDir);
  if (!fs.existsSync(suitesDir)) return;

  const entries: SuiteIndexEntry[] = [];
  for (const dir of fs.readdirSync(suitesDir)) {
    const dirPath = path.join(suitesDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const report = readJsonFile<SuiteReport>(path.join(dirPath, SUITE_REPORT_FILE));
    if (!report) continue;

    const entry: SuiteIndexEntry = {
      suite: report.suite,
      suiteRunId: report.suiteRunId,
      ...(report.workerModel ? { workerModel: report.workerModel } : {}),
      dir,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      totalRuns: report.summary.totalRuns,
      hardFailureCount: report.summary.hardFailureCount,
      averageOverall: averageAggregatedOverall(buildAggregatedEntryMap(report).values()),
      ...(report.epochs ? { epochs: report.epochs } : {}),
      regressionStatus: deriveRegressionStatus(report.comparison),
    };

    if (report.comparison) {
      entry.regressionDelta = report.comparison.averageDelta;
      entry.comparedToSuiteRunId = report.comparison.baselineSuiteRunId;
    }

    entries.push(entry);
  }

  entries.sort(compareSuiteIndexEntries);
  fs.writeFileSync(path.join(suitesDir, SUITE_INDEX_FILE), JSON.stringify(entries, null, 2));
}

export function loadSuiteReport(runsDir: string, suite: string, suiteRunId: string): SuiteReport | undefined {
  return readJsonFile<SuiteReport>(getSuiteReportPath(runsDir, suite, suiteRunId));
}

export function loadLatestSuiteReport(runsDir: string, suite: string, workerModel?: string): SuiteReport | undefined {
  const entry = loadSuiteIndex(runsDir).find(
    (indexEntry) => indexEntry.suite === suite && (workerModel === undefined || indexEntry.workerModel === workerModel),
  );
  if (!entry) return undefined;
  return loadSuiteReport(runsDir, entry.suite, entry.suiteRunId);
}

export function loadPreviousSuiteReport(
  runsDir: string,
  suite: string,
  currentSuiteRunId?: string,
  workerModel?: string,
): SuiteReport | undefined {
  const entries = loadSuiteIndex(runsDir).filter(
    (indexEntry) => indexEntry.suite === suite && (workerModel === undefined || indexEntry.workerModel === workerModel),
  );
  if (entries.length === 0) return undefined;

  if (!currentSuiteRunId) {
    const previous = entries[1];
    return previous ? loadSuiteReport(runsDir, previous.suite, previous.suiteRunId) : undefined;
  }

  const previous = entries.find((entry) => entry.suiteRunId !== currentSuiteRunId);
  return previous ? loadSuiteReport(runsDir, previous.suite, previous.suiteRunId) : undefined;
}

function compareSuiteEntry(
  current: SuiteReportEntry | undefined,
  baseline: SuiteReportEntry | undefined,
  threshold: number,
  currentAgg?: AggregatedSuiteEntry,
  baselineAgg?: AggregatedSuiteEntry,
): SuiteComparisonEntry {
  const trial = current?.trial ?? baseline?.trial ?? currentAgg?.trial ?? baselineAgg?.trial ?? "";
  const variant = current?.variant ?? baseline?.variant ?? currentAgg?.variant ?? baselineAgg?.variant ?? "";
  const findings: string[] = [];
  let severity: SuiteComparisonEntry["severity"];
  let deltaOverall: number | undefined;

  const hasAggregatedComparison =
    currentAgg !== undefined && baselineAgg !== undefined && (currentAgg.epochs > 1 || baselineAgg.epochs > 1);

  if (!current && !currentAgg && (baseline || baselineAgg)) {
    severity = "hard";
    findings.push("Entry missing from current suite run");
  } else if ((current || currentAgg) && !baseline && !baselineAgg) {
    findings.push("New entry in current suite run");
  } else if (hasAggregatedComparison && currentAgg && baselineAgg) {
    // Epoch-aware comparison uses descriptive stability signals rather than inference.
    const rawDelta = currentAgg.overall.mean - baselineAgg.overall.mean;
    deltaOverall = roundToTenth(rawDelta);

    const baselineCompleted = completedCount(baselineAgg);
    const currentCompleted = completedCount(currentAgg);
    if (rate(currentCompleted, currentAgg.epochs) < rate(baselineCompleted, baselineAgg.epochs)) {
      severity = "hard";
      findings.push(
        `Completion rate regressed to ${currentCompleted}/${currentAgg.epochs} (was ${baselineCompleted}/${baselineAgg.epochs})`,
      );
    }

    if (rate(currentAgg.verifyPassCount, currentAgg.epochs) < rate(baselineAgg.verifyPassCount, baselineAgg.epochs)) {
      severity = "hard";
      findings.push(
        `Verification rate regressed to ${currentAgg.verifyPassCount}/${currentAgg.epochs} (was ${baselineAgg.verifyPassCount}/${baselineAgg.epochs})`,
      );
    }

    if (!severity && rawDelta < 0) {
      const meanDrop = Math.abs(rawDelta);
      const clearRegressionThreshold = Math.max(threshold * 2, 6);
      const separated = hasSeparatedRanges(currentAgg.overall, baselineAgg.overall);
      const belowMean = allBelowMean(currentAgg.overall, baselineAgg.overall);
      if (meanDrop > threshold && (separated || belowMean || meanDrop >= clearRegressionThreshold)) {
        severity = "clear";
        const detail = separated
          ? "non-overlapping run ranges"
          : belowMean
            ? `all epochs below previous mean (${Math.round(baselineAgg.overall.mean * 10) / 10})`
            : undefined;
        findings.push(`Overall mean dropped by ${Math.abs(deltaOverall)} points${detail ? ` with ${detail}` : ""}`);
      } else if (meanDrop > 1) {
        severity = "drift";
        findings.push(`Overall mean drifted by ${deltaOverall} points`);
      }
    }
  } else if (current && baseline) {
    // Single-epoch fallback uses flat thresholds and honest non-inferential labels.
    const rawDelta = current.overall - baseline.overall;
    deltaOverall = roundToTenth(rawDelta);

    if (baseline.status === "completed" && current.status !== "completed") {
      severity = "hard";
      findings.push(`Status regressed from ${baseline.status} to ${current.status}`);
    } else if (baseline.status !== "completed" && current.status === "completed") {
      findings.push(`Status improved from ${baseline.status} to ${current.status}`);
    }

    if (baseline.verifyPassed && !current.verifyPassed) {
      severity = "hard";
      findings.push("Verification regressed from pass to fail");
    } else if (!baseline.verifyPassed && current.verifyPassed) {
      findings.push("Verification improved from fail to pass");
    }

    if (!severity && baseline.overall - current.overall > threshold) {
      severity = "clear";
      findings.push(`Overall score dropped by ${Math.abs(deltaOverall)} points`);
    } else if (!severity && baseline.overall - current.overall > 1) {
      severity = "drift";
      findings.push(`Overall score drifted by ${deltaOverall} points`);
    } else if (deltaOverall > threshold) {
      findings.push(`Overall score improved by ${deltaOverall} points`);
    }
  }

  const regression = severity === "hard" || severity === "clear";

  return {
    trial,
    variant,
    ...(current ? { current } : {}),
    ...(baseline ? { baseline } : {}),
    ...(currentAgg ? { currentAggregated: currentAgg } : {}),
    ...(baselineAgg ? { baselineAggregated: baselineAgg } : {}),
    ...(deltaOverall !== undefined ? { deltaOverall } : {}),
    regression,
    ...(severity ? { severity } : {}),
    findings,
  };
}

export function compareSuiteReports(
  current: SuiteReport,
  baseline: SuiteReport,
  options: SuiteComparisonOptions = {},
): SuiteComparison {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  // Build lookup maps for both flat entries and aggregated entries
  const currentEntries = buildSingleEntryMap(current.entries);
  const baselineEntries = buildSingleEntryMap(baseline.entries);
  const currentAgg = buildAggregatedEntryMap(current);
  const baselineAgg = buildAggregatedEntryMap(baseline);

  // Use aggregated keys when available, fall back to flat entry keys
  const aggKeys =
    currentAgg.size > 0 || baselineAgg.size > 0 ? [...new Set([...currentAgg.keys(), ...baselineAgg.keys()])] : [];
  const flatKeys = [...new Set([...baselineEntries.keys(), ...currentEntries.keys()])];
  const allKeys = [...new Set([...aggKeys, ...flatKeys])].sort();

  const entries = allKeys.map((key) =>
    compareSuiteEntry(
      currentEntries.get(key),
      baselineEntries.get(key),
      threshold,
      currentAgg.get(key),
      baselineAgg.get(key),
    ),
  );

  const currentAverageOverall = averageAggregatedOverall(currentAgg.values());
  const baselineAverageOverall = averageAggregatedOverall(baselineAgg.values());
  const findings = entries.flatMap((entry) =>
    entry.findings.map((finding) => `${entry.trial}/${entry.variant}: ${finding}`),
  );

  const averageDelta = roundToTenth(currentAverageOverall - baselineAverageOverall);
  if (baselineAverageOverall - currentAverageOverall > threshold) {
    findings.unshift(`Suite average overall worsened by ${Math.abs(averageDelta)} points`);
  } else if (averageDelta > threshold) {
    findings.unshift(`Suite average overall improved by ${averageDelta} points`);
  }

  const hardRegressionCount = entries.filter((e) => e.severity === "hard").length;
  const clearRegressionCount = entries.filter((e) => e.severity === "clear").length;
  const driftCount = entries.filter((e) => e.severity === "drift").length;

  return {
    suite: current.suite,
    currentSuiteRunId: current.suiteRunId,
    baselineSuiteRunId: baseline.suiteRunId,
    threshold,
    currentAverageOverall,
    baselineAverageOverall,
    averageDelta,
    entries,
    findings,
    hasRegression: entries.some((entry) => entry.regression),
    hardRegressionCount,
    clearRegressionCount,
    driftCount,
  };
}
