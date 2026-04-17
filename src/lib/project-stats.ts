import type { LauncherConfig, RegressionStatus, SuiteIndexEntry } from "$eval/types.js";

export interface LatestSuiteRun {
  suite: string;
  suiteRunId: string;
  averageOverall: number;
  completedAt: string;
  hardFailureCount: number;
  delta: number | null;
  regressionStatus: RegressionStatus;
}

export interface ProjectStats {
  trialCount: number;
  suiteCount: number;
  suiteRunCount: number;
  latestSuiteRun: LatestSuiteRun | null;
  configAvailable: boolean;
}

export function computeProjectStats(
  config: LauncherConfig | null,
  suiteIndex: SuiteIndexEntry[],
): ProjectStats {
  if (!config) {
    return {
      trialCount: 0,
      suiteCount: 0,
      suiteRunCount: suiteIndex.length,
      latestSuiteRun: findLatestSuiteRun(suiteIndex),
      configAvailable: false,
    };
  }

  return {
    trialCount: config.trials.length,
    suiteCount: Object.keys(config.suites).length,
    suiteRunCount: suiteIndex.length,
    latestSuiteRun: findLatestSuiteRun(suiteIndex),
    configAvailable: true,
  };
}

function findLatestSuiteRun(entries: SuiteIndexEntry[]): LatestSuiteRun | null {
  if (entries.length === 0) return null;

  const sorted = [...entries].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const latest = sorted[0];
  if (!latest) return null;

  const prior = sorted.find(
    (entry) => entry.suite === latest.suite && entry.suiteRunId !== latest.suiteRunId,
  );

  const delta = prior ? latest.averageOverall - prior.averageOverall : null;

  return {
    suite: latest.suite,
    suiteRunId: latest.suiteRunId,
    averageOverall: latest.averageOverall,
    completedAt: latest.completedAt,
    hardFailureCount: latest.hardFailureCount,
    delta,
    regressionStatus: latest.regressionStatus ?? (prior ? "stable" : "baseline"),
  };
}
