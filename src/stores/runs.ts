import { derived, get, writable } from "svelte/store";
import { getSuiteDirName } from "$eval/suites.js";
import type {
  BenchIndexEntry,
  BenchReport,
  EvalReport,
  EvalScores,
  EvalSession,
  JudgeResult,
  RunIndexEntry,
  SuiteIndexEntry,
  SuiteReport,
} from "$eval/types.js";
import { activeProjectId, projectApiPath } from "./projects.js";

// -- Raw data stores -----------------------------------------------------------

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function fixStaleRuns(entries: RunIndexEntry[]): RunIndexEntry[] {
  const now = Date.now();
  return entries.map((r) => {
    if (r.status === "running" && r.startedAt) {
      const age = now - new Date(r.startedAt).getTime();
      if (age > STALE_THRESHOLD_MS) {
        return { ...r, status: "stalled" };
      }
    }
    return r;
  });
}

export const runs = writable<RunIndexEntry[]>([]);
export const suiteIndex = writable<SuiteIndexEntry[]>([]);
export const benchIndex = writable<BenchIndexEntry[]>([]);

// -- Report caches -------------------------------------------------------------

export interface RunDetailData {
  meta: EvalReport["meta"];
  session: EvalSession;
  scores?: EvalScores;
  judgeResult?: JudgeResult;
  findings?: string[];
  lastUpdated?: number;
}

const suiteReportCache = new Map<string, Map<string, SuiteReport>>();
const runReportCache = new Map<string, RunDetailData>();

export const currentSuiteReport = writable<SuiteReport | null>(null);
export const currentRunReport = writable<RunDetailData | null>(null);
export const currentBenchReport = writable<BenchReport | null>(null);
export const reportLoading = writable(false);
export const reportError = writable<string | null>(null);

// -- Sidebar structure ---------------------------------------------------------

interface SuiteRunItem {
  suite: string;
  suiteRunId: string;
  workerModel?: string;
  status: string;
  totalRuns: number;
  finishedRuns: number;
  averageOverall: number | null;
  epochs: number;
  durationMs: number;
  children: RunIndexEntry[];
}

interface SidebarSuite {
  suite: string;
  suiteRuns: SuiteRunItem[];
  latestAvg: number | null;
  delta: number | null;
}

export const sidebarItems = derived([runs, suiteIndex], ([$runs, $suiteIndex]) => {
  const suiteMap = new Map<string, SuiteRunItem[]>();

  // Group runs by suite/suiteRunId
  for (const run of $runs) {
    if (!run.suite || !run.suiteRunId) continue;
    const key = run.suiteRunId;
    if (!suiteMap.has(run.suite)) suiteMap.set(run.suite, []);
    const suiteRuns = suiteMap.get(run.suite);
    if (!suiteRuns) continue;

    let item = suiteRuns.find((sr) => sr.suiteRunId === key);
    if (!item) {
      const idx = $suiteIndex.find((si) => si.suiteRunId === key);
      item = {
        suite: run.suite,
        suiteRunId: key,
        workerModel: run.workerModel,
        status: "running",
        totalRuns: 0,
        finishedRuns: 0,
        averageOverall: idx?.averageOverall ?? null,
        epochs: idx?.epochs ?? 1,
        durationMs: 0,
        children: [],
      };
      suiteRuns.push(item);
    }
    item.children.push(run);
    item.totalRuns = item.children.length;
    item.finishedRuns = item.children.filter((c) => c.status !== "running").length;
    item.durationMs += run.durationMs;
    if (item.finishedRuns === item.totalRuns) item.status = "completed";
  }

  const result: SidebarSuite[] = [];
  for (const [suite, suiteRuns] of suiteMap) {
    suiteRuns.sort((a, b) => {
      const aDate = a.children[0]?.startedAt ?? "";
      const bDate = b.children[0]?.startedAt ?? "";
      return bDate.localeCompare(aDate);
    });

    const latestAvg = suiteRuns[0]?.averageOverall ?? null;
    const prevAvg = suiteRuns[1]?.averageOverall ?? null;
    const delta = latestAvg != null && prevAvg != null ? Math.round((latestAvg - prevAvg) * 10) / 10 : null;

    result.push({ suite, suiteRuns, latestAvg, delta });
  }

  result.sort((a, b) => a.suite.localeCompare(b.suite));
  return result;
});

// -- Data loading --------------------------------------------------------------

export async function loadInitialData(projectId = get(activeProjectId)): Promise<void> {
  const runsUrl = projectApiPath("/runs/index.json", projectId);
  const suitesUrl = projectApiPath("/runs/suites/index.json", projectId);
  const benchUrl = projectApiPath("/runs/bench/index.json", projectId);

  if (!projectId || !runsUrl || !suitesUrl || !benchUrl) {
    resetRunData();
    return;
  }

  const [runsResp, suiteResp, benchResp] = await Promise.all([
    fetch(runsUrl).catch(() => null),
    fetch(suitesUrl).catch(() => null),
    fetch(benchUrl).catch(() => null),
  ]);

  const currentProjectId = get(activeProjectId);
  if (currentProjectId && projectId !== currentProjectId) return;

  runs.set(runsResp?.ok ? fixStaleRuns(await runsResp.json()) : []);
  suiteIndex.set(suiteResp?.ok ? await suiteResp.json() : []);
  benchIndex.set(benchResp?.ok ? await benchResp.json() : []);
}

export async function loadSuiteReport(
  suiteName: string,
  suiteRunId: string,
  projectId = get(activeProjectId),
): Promise<SuiteReport | null> {
  const cached = getCachedSuiteReport(suiteName, suiteRunId);
  if (cached) {
    reportLoading.set(false);
    reportError.set(null);
    currentSuiteReport.set(cached);
    return cached;
  }

  reportLoading.set(true);
  reportError.set(null);
  currentSuiteReport.set(null);
  try {
    const report = await getOrLoadSuiteReport(suiteName, suiteRunId, projectId);
    if (!report) {
      if (isSuiteRunActive(suiteRunId)) {
        return null;
      }
      throw new Error("Not found");
    }
    currentSuiteReport.set(report);
    return report;
  } catch {
    reportError.set("Failed to load suite report");
    return null;
  } finally {
    reportLoading.set(false);
  }
}

export async function loadRunReport(dir: string, projectId = get(activeProjectId)): Promise<RunDetailData | null> {
  const cached = runReportCache.get(dir);
  if (cached) {
    reportLoading.set(false);
    reportError.set(null);
    currentRunReport.set(cached);
    return cached;
  }

  reportLoading.set(true);
  reportError.set(null);
  currentRunReport.set(null);
  try {
    const url = projectApiPath(`/runs/${dir}/report.json`, projectId);
    if (!url || !projectId) return null;
    const resp = await fetch(url);
    if (!resp.ok) {
      if (resp.status === 404 && isRunActive(dir)) {
        return await loadLiveRunReport(dir, projectId, { setLoading: false });
      }
      throw new Error("Not found");
    }
    const report: RunDetailData = await resp.json();
    const currentProjectId = get(activeProjectId);
    if (currentProjectId && projectId !== currentProjectId) return null;
    runReportCache.set(dir, report);
    currentRunReport.set(report);
    return report;
  } catch {
    if (!isRunActive(dir)) {
      reportError.set("Failed to load run report");
    }
    return null;
  } finally {
    reportLoading.set(false);
  }
}

export async function loadLiveRunReport(
  dir: string,
  projectId = get(activeProjectId),
  options: { setLoading?: boolean } = {},
): Promise<RunDetailData | null> {
  if (options.setLoading) {
    reportLoading.set(true);
  }

  try {
    const url = projectApiPath(`/runs/${dir}/live.json`, projectId);
    if (!url || !projectId) return null;
    const resp = await fetch(url);
    if (!resp.ok) {
      return null;
    }

    const report: RunDetailData = await resp.json();
    const currentProjectId = get(activeProjectId);
    if (currentProjectId && projectId !== currentProjectId) return null;
    reportError.set(null);
    currentRunReport.set(report);
    return report;
  } catch {
    return null;
  } finally {
    if (options.setLoading) {
      reportLoading.set(false);
    }
  }
}

export async function loadBenchReport(
  benchRunId: string,
  projectId = get(activeProjectId),
): Promise<BenchReport | null> {
  const idx = get(benchIndex);
  const entry = idx.find((e) => e.benchRunId === benchRunId);
  if (!entry) {
    reportError.set("Bench report not found");
    return null;
  }

  reportLoading.set(true);
  reportError.set(null);
  currentBenchReport.set(null);
  try {
    const url = projectApiPath(`/runs/bench/${entry.dir}/report.json`, projectId);
    if (!url || !projectId) return null;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Not found");
    const report: BenchReport = await resp.json();
    const currentProjectId = get(activeProjectId);
    if (currentProjectId && projectId !== currentProjectId) return null;
    currentBenchReport.set(report);
    return report;
  } catch {
    reportError.set("Failed to load bench report");
    return null;
  } finally {
    reportLoading.set(false);
  }
}

export function resetCurrentReports(): void {
  currentSuiteReport.set(null);
  currentRunReport.set(null);
  currentBenchReport.set(null);
  reportLoading.set(false);
  reportError.set(null);
}

export function resetRunData(): void {
  runs.set([]);
  suiteIndex.set([]);
  benchIndex.set([]);
  suiteReportCache.clear();
  runReportCache.clear();
  resetCurrentReports();
}

// -- Trend data for suite overview ---------------------------------------------

export interface TrendPoint {
  suiteRunId: string;
  date: Date;
  averageOverall: number;
  totalRuns: number;
  hardFailures: number;
}

export function getSuiteTrendData(suiteName: string): TrendPoint[] {
  const idx = get(suiteIndex);
  return idx
    .filter((e) => e.suite === suiteName)
    .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime())
    .map((e) => ({
      suiteRunId: e.suiteRunId,
      date: new Date(e.completedAt),
      averageOverall: e.averageOverall,
      totalRuns: e.totalRuns,
      hardFailures: e.hardFailureCount,
    }));
}

export function getCachedSuiteReport(suiteName: string, suiteRunId: string): SuiteReport | null {
  return suiteReportCache.get(suiteName)?.get(suiteRunId) ?? null;
}

export async function getOrLoadSuiteReport(
  suiteName: string,
  suiteRunId: string,
  projectId = get(activeProjectId),
): Promise<SuiteReport | null> {
  const cached = getCachedSuiteReport(suiteName, suiteRunId);
  if (cached) {
    return cached;
  }

  try {
    const suiteDir =
      get(suiteIndex).find((entry) => entry.suite === suiteName && entry.suiteRunId === suiteRunId)?.dir ??
      getSuiteDirName(suiteName, suiteRunId);
    const url = projectApiPath(`/runs/suites/${suiteDir}/report.json`, projectId);
    if (!url || !projectId) return null;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const report: SuiteReport = await resp.json();
    const currentProjectId = get(activeProjectId);
    if (currentProjectId && projectId !== currentProjectId) return null;
    let suiteEntries = suiteReportCache.get(suiteName);
    if (!suiteEntries) {
      suiteEntries = new Map<string, SuiteReport>();
      suiteReportCache.set(suiteName, suiteEntries);
    }
    suiteEntries.set(suiteRunId, report);
    return report;
  } catch {
    return null;
  }
}

function isRunActive(dir: string): boolean {
  return get(runs).some((run) => run.dir === dir && run.status === "running");
}

function isSuiteRunActive(suiteRunId: string): boolean {
  return get(runs).some((run) => run.suiteRunId === suiteRunId && run.status === "running");
}
