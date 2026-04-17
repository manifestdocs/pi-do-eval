import { writable } from "svelte/store";
import type { RunRequest } from "$eval/types.js";

export const selectedSuiteName = writable<string | null>(null);
export const selectedSuiteRunId = writable<string | null>(null);
export const selectedRunDir = writable<string | null>(null);
export const selectedBenchId = writable<string | null>(null);

export interface PendingLaunch {
  id: string;
  type: RunRequest["type"];
  suite?: string;
  trial?: string;
  variant?: string;
  modelLabel?: string;
  startedAt: string;
}

export const pendingLaunch = writable<PendingLaunch | null>(null);

// Sidebar expansion state
export const expandedSuites = writable<Set<string>>(new Set());
export const expandedRuns = writable<Set<string>>(new Set());

export function selectSuiteName(name: string): void {
  pendingLaunch.set(null);
  selectedSuiteName.set(name);
  selectedSuiteRunId.set(null);
  selectedRunDir.set(null);
  selectedBenchId.set(null);
}

export function selectSuiteRun(suiteName: string, suiteRunId: string): void {
  pendingLaunch.set(null);
  selectedSuiteName.set(suiteName);
  selectedSuiteRunId.set(suiteRunId);
  selectedRunDir.set(null);
  selectedBenchId.set(null);

  // Auto-expand
  expandedSuites.update((s) => {
    s.add(suiteName);
    return s;
  });
}

export function selectRun(dir: string): void {
  pendingLaunch.set(null);
  selectedSuiteName.set(null);
  selectedSuiteRunId.set(null);
  selectedRunDir.set(dir);
  selectedBenchId.set(null);
}

export function selectBench(benchId: string): void {
  pendingLaunch.set(null);
  selectedSuiteName.set(null);
  selectedSuiteRunId.set(null);
  selectedRunDir.set(null);
  selectedBenchId.set(benchId);
}

export function selectPendingLaunch(launch: PendingLaunch): void {
  selectedSuiteName.set(null);
  selectedSuiteRunId.set(null);
  selectedRunDir.set(null);
  selectedBenchId.set(null);
  pendingLaunch.set(launch);
}

export function clearPendingLaunch(): void {
  pendingLaunch.set(null);
}

export function resetSelection(): void {
  selectedSuiteName.set(null);
  selectedSuiteRunId.set(null);
  selectedRunDir.set(null);
  selectedBenchId.set(null);
  pendingLaunch.set(null);
  expandedSuites.set(new Set());
  expandedRuns.set(new Set());
}

export function toggleSuite(name: string): void {
  expandedSuites.update((s) => {
    if (s.has(name)) s.delete(name);
    else s.add(name);
    return s;
  });
}

export function toggleSuiteRun(id: string): void {
  expandedRuns.update((s) => {
    if (s.has(id)) s.delete(id);
    else s.add(id);
    return s;
  });
}
