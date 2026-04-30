import { get } from "svelte/store";
import type { EvalEvent, RunIndexEntry } from "$eval/types.js";
import { benchIndexCodec, evalEventCodec, suiteIndexCodec } from "$lib/contracts/domain.js";
import { readJson } from "./api.js";
import { activeProjectId, projectApiPath } from "./projects.js";
import { benchIndex, loadLiveRunReport, loadRunReport, loadSuiteReport, runs, suiteIndex } from "./runs.js";
import {
  expandedRuns,
  expandedSuites,
  type PendingLaunch,
  selectedRunDir,
  selectedSuiteName,
  selectedSuiteRunId,
  selectPendingLaunch,
  selectRun,
  selectSuiteRun,
} from "./selection.js";

let eventSource: EventSource | null = null;
let connectedProjectId: string | null = null;
const PENDING_MATCH_SKEW_MS = 60_000;

// When a launcher run starts, auto-navigate to it
let pendingAutoSelect: PendingLaunch | null = null;

export function setAutoSelect(launch: PendingLaunch): void {
  pendingAutoSelect = launch;
  selectPendingLaunch(launch);
}

export function connectSSE(projectId: string | null): void {
  if (!projectId) {
    disconnectSSE();
    return;
  }

  if (eventSource && connectedProjectId === projectId) return;

  disconnectSSE();

  const url = projectApiPath("/events", projectId);
  if (!url) return;

  connectedProjectId = projectId;
  const streamProjectId = projectId;

  eventSource = new EventSource(url);

  eventSource.onmessage = (msg) => {
    if (connectedProjectId !== streamProjectId) return;
    try {
      const parsed = evalEventCodec.parse(JSON.parse(msg.data));
      if (parsed.ok) handleEvent(parsed.value, streamProjectId);
    } catch {
      // Ignore malformed events
    }
  };

  eventSource.onerror = () => {
    // EventSource will auto-reconnect
  };
}

export function disconnectSSE(): void {
  eventSource?.close();
  eventSource = null;
  connectedProjectId = null;
  pendingAutoSelect = null;
}

function handleEvent(event: EvalEvent, projectId: string): void {
  switch (event.type) {
    case "index_updated":
      {
        const nextRuns = event.runs.map((r) => {
          if (r.status === "running" && r.startedAt) {
            const age = Date.now() - new Date(r.startedAt).getTime();
            if (age > 10 * 60 * 1000) return { ...r, status: "stalled" };
          }
          return r;
        });
        runs.set(nextRuns);
        resolvePendingSelectionFromRuns(nextRuns);
      }
      // Also refresh suite and bench indices
      void refreshIndices(projectId);
      break;

    case "run_started":
      runs.update((current) => {
        const existing = current.find((run) => run.dir === event.dir);
        if (existing) {
          return current.map((run) =>
            run.dir === event.dir
              ? {
                  ...run,
                  status: "running",
                  startedAt: run.startedAt || new Date(event.timestamp).toISOString(),
                  workerModel: event.workerModel ?? run.workerModel,
                  suite: event.suite ?? run.suite,
                  suiteRunId: event.suiteRunId ?? run.suiteRunId,
                }
              : run,
          );
        }
        const entry: RunIndexEntry = {
          dir: event.dir,
          trial: event.trial,
          variant: event.variant,
          status: "running" as const,
          overall: 0,
          durationMs: 0,
          startedAt: new Date(event.timestamp).toISOString(),
          workerModel: event.workerModel ?? "",
          suite: event.suite,
          suiteRunId: event.suiteRunId,
        };
        return [entry, ...current];
      });
      applyAutoSelection(event);
      if (get(selectedRunDir) === event.dir) {
        void loadLiveRunReport(event.dir, projectId);
      }
      break;

    case "run_progress":
      runs.update((current) => current.map((r) => (r.dir === event.dir ? { ...r, durationMs: event.durationMs } : r)));
      if (get(selectedRunDir) === event.dir) {
        void loadLiveRunReport(event.dir, projectId);
      }
      break;

    case "run_completed":
      runs.update((current) =>
        current.map((r) =>
          r.dir === event.dir
            ? { ...r, status: event.status, overall: event.overall ?? 0, durationMs: event.durationMs }
            : r,
        ),
      );
      // Refresh suite index since suite report may have been written
      if (get(selectedRunDir) === event.dir) {
        void loadRunReport(event.dir, projectId);
      }
      void refreshIndices(projectId);
      break;
  }
}

async function refreshIndices(projectId: string): Promise<void> {
  const suitesUrl = projectApiPath("/runs/suites/index.json", projectId);
  const benchUrl = projectApiPath("/runs/bench/index.json", projectId);
  if (!suitesUrl || !benchUrl) return;

  const [suiteResp, benchResp] = await Promise.all([
    fetch(suitesUrl).catch(() => null),
    fetch(benchUrl).catch(() => null),
  ]);
  if (projectId !== get(activeProjectId)) return;
  if (suiteResp?.ok) suiteIndex.set(await readJson(suiteResp, suiteIndexCodec, "Invalid suite index"));
  if (benchResp?.ok) benchIndex.set(await readJson(benchResp, benchIndexCodec, "Invalid bench index"));

  const suiteName = get(selectedSuiteName);
  const suiteRunId = get(selectedSuiteRunId);
  if (suiteName && suiteRunId && get(suiteIndex).some((entry) => entry.suiteRunId === suiteRunId)) {
    void loadSuiteReport(suiteName, suiteRunId, projectId);
  }
}

function applyAutoSelection(event: Extract<EvalEvent, { type: "run_started" }>): void {
  if (!pendingAutoSelect) return;
  const suite = event.suite;
  const suiteRunId = event.suiteRunId;

  if (
    pendingAutoSelect.type === "trial" &&
    event.trial === pendingAutoSelect.trial &&
    event.variant === pendingAutoSelect.variant
  ) {
    selectRun(event.dir);
    pendingAutoSelect = null;
    return;
  }

  if (pendingAutoSelect.type === "suite" && suite && suite === pendingAutoSelect.suite && suiteRunId) {
    selectSuiteRun(suite, suiteRunId);
    expandedSuites.update((s) => {
      s.add(suite);
      return s;
    });
    expandedRuns.update((s) => {
      s.add(suiteRunId);
      return s;
    });
    pendingAutoSelect = null;
  }
}

function resolvePendingSelectionFromRuns(currentRuns: RunIndexEntry[]): void {
  const pendingLaunch = pendingAutoSelect;
  if (!pendingLaunch) return;

  const candidates = currentRuns
    .filter((run) => matchesPendingLaunch(run, pendingLaunch))
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

  const candidate = candidates[0];
  if (!candidate) return;

  if (pendingLaunch.type === "trial") {
    selectRun(candidate.dir);
    pendingAutoSelect = null;
    return;
  }

  if (pendingLaunch.type === "suite" && candidate.suite && candidate.suiteRunId) {
    const suite = candidate.suite;
    const suiteRunId = candidate.suiteRunId;
    selectSuiteRun(suite, suiteRunId);
    expandedSuites.update((s) => {
      s.add(suite);
      return s;
    });
    expandedRuns.update((s) => {
      s.add(suiteRunId);
      return s;
    });
    pendingAutoSelect = null;
  }
}

function matchesPendingLaunch(run: RunIndexEntry, launch: PendingLaunch): boolean {
  if (!isRecentEnough(run.startedAt, launch.startedAt)) return false;

  if (launch.type === "trial") {
    return run.trial === launch.trial && run.variant === launch.variant;
  }

  if (launch.type === "suite") {
    return run.suite === launch.suite;
  }

  return false;
}

function isRecentEnough(runStartedAt: string | undefined, launchStartedAt: string): boolean {
  if (!runStartedAt) return false;
  return new Date(runStartedAt).getTime() >= new Date(launchStartedAt).getTime() - PENDING_MATCH_SKEW_MS;
}
