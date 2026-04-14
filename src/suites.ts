import * as fs from "node:fs";
import * as path from "node:path";
import type {
  EvalReport,
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

function getSuitesDir(runsDir: string): string {
  return path.join(runsDir, SUITES_DIR_NAME);
}

function getSuiteDirName(suite: string, suiteRunId: string): string {
  return `${suiteRunId}-${suite}`;
}

function getSuiteReportPath(runsDir: string, suite: string, suiteRunId: string): string {
  return path.join(getSuitesDir(runsDir), getSuiteDirName(suite, suiteRunId), SUITE_REPORT_FILE);
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

export function buildSuiteReportEntry(report: EvalReport, runDir: string): SuiteReportEntry {
  return {
    trial: report.meta.trial,
    variant: report.meta.variant,
    runDir,
    status: report.meta.status,
    overall: report.scores.overall,
    verifyPassed: !report.findings.includes("Verification failed"),
    deterministic: report.scores.deterministic,
    ...(report.scores.judge ? { judge: report.scores.judge } : {}),
    findings: [...report.findings],
  };
}

export function summarizeSuiteEntries(entries: SuiteReportEntry[]): SuiteReport["summary"] {
  const totalOverall = entries.reduce((sum, entry) => sum + entry.overall, 0);
  const hardFailureCount = entries.filter(isHardFailure).length;
  const verifyFailureCount = entries.filter((entry) => !entry.verifyPassed).length;
  const completedRuns = entries.filter((entry) => entry.status === "completed").length;

  return {
    totalRuns: entries.length,
    completedRuns,
    verifyFailureCount,
    hardFailureCount,
    averageOverall: entries.length > 0 ? Math.round((totalOverall / entries.length) * 10) / 10 : 0,
  };
}

export function createSuiteReport(
  suite: string,
  suiteRunId: string,
  reports: Array<{ report: EvalReport; runDir: string }>,
  completedAt = new Date().toISOString(),
): SuiteReport {
  const entries = reports.map(({ report, runDir }) => buildSuiteReportEntry(report, runDir));
  const sortedEntries = [...entries].sort((a, b) => suiteEntryKey(a).localeCompare(suiteEntryKey(b)));
  const startedAt =
    reports
      .map(({ report }) => report.meta.startedAt)
      .sort(compareTimestamps)
      .at(-1) ?? completedAt;

  return {
    suite,
    suiteRunId,
    startedAt,
    completedAt,
    entries: sortedEntries,
    summary: summarizeSuiteEntries(sortedEntries),
  };
}

export function writeSuiteReport(report: SuiteReport, runsDir: string): string {
  const suiteDir = path.join(getSuitesDir(runsDir), getSuiteDirName(report.suite, report.suiteRunId));
  fs.mkdirSync(suiteDir, { recursive: true });
  fs.writeFileSync(path.join(suiteDir, SUITE_REPORT_FILE), JSON.stringify(report, null, 2));
  return suiteDir;
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

    entries.push({
      suite: report.suite,
      suiteRunId: report.suiteRunId,
      dir,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      totalRuns: report.summary.totalRuns,
      hardFailureCount: report.summary.hardFailureCount,
      averageOverall: report.summary.averageOverall,
    });
  }

  entries.sort(compareSuiteIndexEntries);
  fs.writeFileSync(path.join(suitesDir, SUITE_INDEX_FILE), JSON.stringify(entries, null, 2));
}

export function loadSuiteReport(runsDir: string, suite: string, suiteRunId: string): SuiteReport | undefined {
  return readJsonFile<SuiteReport>(getSuiteReportPath(runsDir, suite, suiteRunId));
}

export function loadLatestSuiteReport(runsDir: string, suite: string): SuiteReport | undefined {
  const entry = loadSuiteIndex(runsDir).find((indexEntry) => indexEntry.suite === suite);
  if (!entry) return undefined;
  return loadSuiteReport(runsDir, entry.suite, entry.suiteRunId);
}

export function loadPreviousSuiteReport(
  runsDir: string,
  suite: string,
  currentSuiteRunId?: string,
): SuiteReport | undefined {
  const entries = loadSuiteIndex(runsDir).filter((indexEntry) => indexEntry.suite === suite);
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
): SuiteComparisonEntry {
  const trial = current?.trial ?? baseline?.trial ?? "";
  const variant = current?.variant ?? baseline?.variant ?? "";
  const findings: string[] = [];
  let regression = false;
  let deltaOverall: number | undefined;

  if (!current && baseline) {
    regression = true;
    findings.push("Entry missing from current suite run");
  } else if (current && !baseline) {
    findings.push("New entry in current suite run");
  } else if (current && baseline) {
    deltaOverall = Math.round((current.overall - baseline.overall) * 10) / 10;

    if (baseline.status === "completed" && current.status !== "completed") {
      regression = true;
      findings.push(`Status regressed from ${baseline.status} to ${current.status}`);
    } else if (baseline.status !== "completed" && current.status === "completed") {
      findings.push(`Status improved from ${baseline.status} to ${current.status}`);
    }

    if (baseline.verifyPassed && !current.verifyPassed) {
      regression = true;
      findings.push("Verification regressed from pass to fail");
    } else if (!baseline.verifyPassed && current.verifyPassed) {
      findings.push("Verification improved from fail to pass");
    }

    if (baseline.overall - current.overall > threshold) {
      regression = true;
      findings.push(`Overall score dropped by ${Math.abs(deltaOverall)} points`);
    } else if (deltaOverall > threshold) {
      findings.push(`Overall score improved by ${deltaOverall} points`);
    }
  }

  return {
    trial,
    variant,
    ...(current ? { current } : {}),
    ...(baseline ? { baseline } : {}),
    ...(deltaOverall !== undefined ? { deltaOverall } : {}),
    regression,
    findings,
  };
}

export function compareSuiteReports(
  current: SuiteReport,
  baseline: SuiteReport,
  options: SuiteComparisonOptions = {},
): SuiteComparison {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const currentEntries = new Map(current.entries.map((entry) => [suiteEntryKey(entry), entry]));
  const baselineEntries = new Map(baseline.entries.map((entry) => [suiteEntryKey(entry), entry]));
  const allKeys = [...new Set([...baselineEntries.keys(), ...currentEntries.keys()])].sort();
  const entries = allKeys.map((key) => compareSuiteEntry(currentEntries.get(key), baselineEntries.get(key), threshold));

  const findings = entries.flatMap((entry) =>
    entry.findings.map((finding) => `${entry.trial}/${entry.variant}: ${finding}`),
  );

  const averageDelta = Math.round((current.summary.averageOverall - baseline.summary.averageOverall) * 10) / 10;
  if (baseline.summary.averageOverall - current.summary.averageOverall > threshold) {
    findings.unshift(`Suite average overall dropped by ${Math.abs(averageDelta)} points`);
  } else if (averageDelta > threshold) {
    findings.unshift(`Suite average overall improved by ${averageDelta} points`);
  }

  return {
    suite: current.suite,
    currentSuiteRunId: current.suiteRunId,
    baselineSuiteRunId: baseline.suiteRunId,
    threshold,
    currentAverageOverall: current.summary.averageOverall,
    baselineAverageOverall: baseline.summary.averageOverall,
    averageDelta,
    entries,
    findings,
    hasRegression:
      entries.some((entry) => entry.regression) ||
      baseline.summary.averageOverall - current.summary.averageOverall > threshold,
  };
}
