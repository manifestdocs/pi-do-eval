import * as fs from "node:fs";
import * as path from "node:path";
import { parseJsonWith } from "../contracts/codec.js";
import { benchReportCodec } from "../contracts/domain.js";
import type {
  BenchConfig,
  BenchEntry,
  BenchIndexEntry,
  BenchReport,
  ExecutionProfile,
  ExecutionProfileSnapshot,
  SuiteReport,
} from "./types.js";

const BENCH_DIR_NAME = "bench";
const BENCH_INDEX_FILE = "index.json";

function suiteEntryKey(trial: string, variant: string): string {
  return `${trial}::${variant}`;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface ProfileSuiteReport {
  profile: ExecutionProfile | ExecutionProfileSnapshot;
  report: SuiteReport;
}

export function collectBenchGateFailures(profileReports: ProfileSuiteReport[], bench: BenchConfig): string[] {
  const failures: string[] = [];
  const requiredDeterministicScores = bench.requiredDeterministicScores ?? {};

  for (const { profile, report } of profileReports) {
    for (const entry of report.entries) {
      const label = `${profile.id} ${entry.trial}/${entry.variant}`;
      if (bench.requireJudge && !entry.judge) {
        const judgeFinding = entry.findings.find((finding) => finding.startsWith("Judge failed:"));
        failures.push(`${label}: judge result required but missing${judgeFinding ? ` (${judgeFinding})` : ""}`);
      }

      for (const [metric, minimum] of Object.entries(requiredDeterministicScores)) {
        const actual = entry.deterministic[metric];
        if (actual === undefined) {
          failures.push(`${label}: deterministic score "${metric}" required but missing`);
        } else if (actual < minimum) {
          failures.push(`${label}: deterministic score "${metric}" ${actual} is below required ${minimum}`);
        }
      }
    }
  }

  return failures;
}

function snapshotProfile(profile: ExecutionProfile | ExecutionProfileSnapshot): ExecutionProfileSnapshot {
  return {
    id: profile.id,
    label: profile.label,
    factors: profile.factors,
  };
}

function modelProfile(model: string): ExecutionProfileSnapshot {
  const slashIdx = model.indexOf("/");
  return {
    id: model,
    label: model,
    factors: {
      ...(slashIdx > 0 ? { provider: model.slice(0, slashIdx), model: model.slice(slashIdx + 1) } : { model }),
      layers: [],
    },
  };
}

function deltaFromBaseline(
  values: Record<string, number>,
  baselineProfileId: string | undefined,
): Record<string, number> | undefined {
  if (!baselineProfileId) return undefined;
  const baseline = values[baselineProfileId];
  if (baseline === undefined) return undefined;
  const deltas: Record<string, number> = {};
  for (const [profileId, value] of Object.entries(values)) {
    if (profileId === baselineProfileId) continue;
    deltas[profileId] = roundToTenth(value - baseline);
  }
  return Object.keys(deltas).length > 0 ? deltas : undefined;
}

export function createBenchReport(
  suite: string,
  benchRunId: string,
  suiteReports: Map<string, SuiteReport>,
  startedAt: string,
  completedAt = new Date().toISOString(),
): BenchReport {
  return createProfileBenchReport(
    suite,
    benchRunId,
    [...suiteReports].map(([model, report]) => ({ profile: modelProfile(model), report })),
    startedAt,
    completedAt,
  );
}

export function createProfileBenchReport(
  suite: string,
  benchRunId: string,
  profileReports: ProfileSuiteReport[],
  startedAt: string,
  completedAt = new Date().toISOString(),
  baselineProfileId?: string,
): BenchReport {
  const profiles = profileReports.map(({ profile }) => snapshotProfile(profile));
  const profileIds = profiles.map((profile) => profile.id);
  const duplicateProfileId = profileIds.find((profileId, index) => profileIds.indexOf(profileId) !== index);
  if (duplicateProfileId) {
    throw new Error(`Duplicate profile id "${duplicateProfileId}"`);
  }
  if (baselineProfileId && !profileIds.includes(baselineProfileId)) {
    const available = profileIds.join(", ") || "none";
    throw new Error(`Unknown baseline profile "${baselineProfileId}". Available profiles: ${available}`);
  }
  const models = profileIds;
  const suiteRunIds: Record<string, string> = {};
  for (const { profile, report } of profileReports) {
    suiteRunIds[profile.id] = report.suiteRunId;
  }

  // Collect all trial/variant keys across all profiles.
  const allKeys = new Set<string>();
  const keyMeta = new Map<string, { trial: string; variant: string }>();
  for (const { report } of profileReports) {
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

    for (const { profile, report } of profileReports) {
      const match = report.entries.find((e) => suiteEntryKey(e.trial, e.variant) === key);
      if (!match) continue;
      overall[profile.id] = match.overall;
      deterministic[profile.id] = { ...match.deterministic };
    }

    entries.push({
      trial: meta.trial,
      variant: meta.variant,
      overall,
      deterministic,
      ...(baselineProfileId ? { deltas: deltaFromBaseline(overall, baselineProfileId) } : {}),
    });
  }

  const averages: Record<string, number> = {};
  for (const { profile, report } of profileReports) {
    averages[profile.id] = roundToTenth(report.summary.averageOverall);
  }
  const averageDeltas = deltaFromBaseline(averages, baselineProfileId);

  return {
    suite,
    benchRunId,
    startedAt,
    completedAt,
    profiles,
    ...(baselineProfileId ? { baselineProfileId } : {}),
    models,
    suiteRunIds,
    entries,
    averages,
    ...(averageDeltas ? { averageDeltas } : {}),
  };
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
        ...(report.profiles ? { profiles: report.profiles } : {}),
        ...(report.baselineProfileId ? { baselineProfileId: report.baselineProfileId } : {}),
        models: report.models,
        averages: report.averages,
        ...(report.averageDeltas ? { averageDeltas: report.averageDeltas } : {}),
      });
    } catch {
      // skip corrupt files
    }
  }

  entries.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  fs.writeFileSync(path.join(benchDir, BENCH_INDEX_FILE), JSON.stringify(entries, null, 2));
}

export function printBenchComparison(report: BenchReport) {
  const profileIds = report.profiles?.map((profile) => profile.id) ?? report.models;
  const labels = new Map(report.profiles?.map((profile) => [profile.id, profile.label]) ?? []);
  const { entries, averages } = report;
  if (profileIds.length === 0) return;
  const baselineProfileId = report.baselineProfileId;
  const comparisonProfileId =
    baselineProfileId && profileIds.length === 2
      ? profileIds.find((profileId) => profileId !== baselineProfileId)
      : undefined;

  const shortName = (profileId: string) => {
    const name = labels.get(profileId) ?? profileId;
    const parts = name.split("/");
    return parts[parts.length - 1]?.trim() ?? name;
  };

  const colWidth = Math.max(12, ...profileIds.map((profileId) => shortName(profileId).length + 2));
  const labelWidth = Math.max(20, ...entries.map((e) => `${e.trial}/${e.variant}`.length + 2));
  const showDelta = profileIds.length >= 2;

  const pad = (s: string, w: number) => s.padEnd(w);
  const rpad = (s: string, w: number) => s.padStart(w);

  console.log(`\n--- Profile Comparison: ${report.suite} ---`);
  let header = pad("", labelWidth);
  for (const profileId of profileIds) header += rpad(shortName(profileId), colWidth);
  if (showDelta) header += rpad("delta", colWidth);
  console.log(header);

  for (const entry of entries) {
    const label = `${entry.trial}/${entry.variant}`;
    let line = pad(label, labelWidth);
    const scores: (number | undefined)[] = [];
    for (const profileId of profileIds) {
      const score = entry.overall[profileId];
      scores.push(score);
      line += rpad(score !== undefined ? String(score) : "--", colWidth);
    }
    if (comparisonProfileId && entry.deltas) {
      const delta = entry.deltas[comparisonProfileId];
      line += rpad(delta !== undefined ? `${delta > 0 ? "+" : ""}${delta}` : "--", colWidth);
    } else if (showDelta && scores.length >= 2) {
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

  let avgLine = pad("average", labelWidth);
  const avgValues: (number | undefined)[] = [];
  for (const profileId of profileIds) {
    const avg = averages[profileId];
    avgValues.push(avg);
    avgLine += rpad(avg !== undefined ? String(avg) : "--", colWidth);
  }
  if (comparisonProfileId && report.averageDeltas) {
    const delta = report.averageDeltas[comparisonProfileId];
    avgLine += rpad(delta !== undefined ? `${delta > 0 ? "+" : ""}${delta}` : "--", colWidth);
  } else if (showDelta && avgValues.length >= 2) {
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
