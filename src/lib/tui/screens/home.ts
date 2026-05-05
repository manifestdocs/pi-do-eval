import * as fs from "node:fs";
import * as path from "node:path";
import { Key, matchesKey, Spacer, Text, visibleWidth } from "@mariozechner/pi-tui";
import { loadFileSuites } from "$eval/suite-files.js";
import { listTrialNames, loadTrialManifest } from "$eval/trial-manifest.js";
import type { LauncherBenchDef, LauncherSuiteDef, RunIndexEntry } from "$eval/types.js";
import { loadLauncherConfigFromEvalDir } from "$lib/server/harness.js";
import type { RegisteredProject } from "$lib/server/projects.js";
import type { Screen, ScreenController } from "../screen.js";
import { theme } from "../theme.js";
import { LauncherScreen, type LaunchType } from "./launcher.js";
import { RunsScreen } from "./runs.js";
import { SuitesScreen } from "./suites.js";
import { TrialsScreen } from "./trials.js";

interface HomeStats {
  trialCount: number;
  enabledTrialCount: number;
  suiteCount: number;
  runCount: number;
  runningCount: number;
  completedCount: number;
  runningRuns: RunIndexEntry[];
  latestCompleted: RunIndexEntry | null;
  benchTargets: HomeTarget[];
  regressionTargets: HomeTarget[];
  targetsLoading: boolean;
}

interface HomeTarget {
  name: string;
  detail: string;
}

const MAX_HOME_TARGETS = 6;

export class ProjectHomeScreen implements Screen {
  readonly id = "project-home";
  focused = true;
  private heading: Text;
  private spacer = new Spacer(1);
  private stats: HomeStats = emptyStats();
  private notice: string | null = null;
  private targetLoadId = 0;

  constructor(
    private controller: ScreenController,
    private project: RegisteredProject,
  ) {
    this.heading = new Text(`  ${theme.bold(project.name)}`, 0, 0);
    this.refresh();
    void this.refreshTargets();
  }

  enter(): void {
    this.refresh();
    void this.refreshTargets();
    this.controller.setStatusLeft(`Launch · ${this.project.name}`);
    this.controller.setStatusRight(
      "b bench · g regression · t trial · c runs · s suites · T trials · R refresh · q quit",
    );
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, "r")) {
      this.controller.push(new LauncherScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, "b")) {
      this.openLaunch("bench");
      return;
    }
    if (matchesKey(data, "g")) {
      this.openLaunch("regression");
      return;
    }
    if (matchesKey(data, "t")) {
      this.openLaunch("trial");
      return;
    }
    if (matchesKey(data, "c")) {
      this.controller.push(new RunsScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, "s")) {
      this.controller.push(new SuitesScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, Key.shift("t"))) {
      this.controller.push(new TrialsScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, Key.shift("r"))) {
      this.refresh();
      void this.refreshTargets();
      this.controller.requestRender();
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const contentWidth = Math.max(30, width - 2);
    lines.push(...this.heading.render(width));
    lines.push(...this.spacer.render(width));
    lines.push(`  ${theme.fg("muted", this.project.evalDir)}`);
    lines.push("");
    if (this.notice) {
      lines.push(`  ${theme.fg("warning", this.notice)}`);
      lines.push("");
    }

    lines.push(
      ...renderCardRow(
        [
          card(
            "Bench",
            renderTargetLines("b", "Run Bench", this.stats.benchTargets, {
              empty: "No bench targets",
              loading: this.stats.targetsLoading,
            }),
          ),
          card(
            "Regression",
            renderTargetLines("g", "Run Regression", this.stats.regressionTargets, {
              empty: "No regression suites",
              loading: this.stats.targetsLoading,
            }),
          ),
          card("Trial", [
            `${theme.fg("accent", "t")} ${theme.bold("Run Trial")}`,
            theme.dim(`${this.stats.enabledTrialCount}/${this.stats.trialCount} trials enabled`),
            theme.dim("one trial variant"),
          ]),
        ],
        contentWidth,
      ),
    );
    lines.push("");

    const running =
      this.stats.runningRuns.length === 0
        ? [theme.dim("Nothing running. Press b, g, or t to run.")]
        : this.stats.runningRuns.map((run) => renderRunSummary(run));
    lines.push(...frameCard("Running", running, contentWidth));
    lines.push("");
    lines.push(
      ...frameCard(
        "Actions",
        [
          `${theme.fg("accent", "c")} runs  ${metric("running", String(this.stats.runningCount))}  ${
            this.stats.latestCompleted
              ? metric("last", renderScore(this.stats.latestCompleted))
              : theme.dim("no completed runs")
          }`,
          `${theme.fg("accent", "s")} suites  ${metric("count", String(this.stats.suiteCount))}   ${theme.fg(
            "accent",
            "T",
          )} trials  ${metric("enabled", `${this.stats.enabledTrialCount}/${this.stats.trialCount}`)}`,
          `${theme.fg("accent", "R")} refresh summary`,
        ],
        contentWidth,
      ),
    );
    return lines;
  }

  private refresh(): void {
    this.notice = null;
    this.stats = emptyStats();
    const issues: string[] = [];

    try {
      const trials = listTrialNames(this.project.evalDir);
      this.stats.trialCount = trials.length;
      this.stats.enabledTrialCount = trials.filter((name) => {
        const manifest = loadTrialManifest(this.project.evalDir, name);
        return manifest?.enabled !== false;
      }).length;
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "Failed to load trials");
    }

    try {
      this.stats.suiteCount = loadFileSuites(this.project.evalDir).length;
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "Failed to load suites");
    }

    const runs = readRuns(this.project.evalDir);
    this.stats.runCount = runs.length;
    this.stats.runningCount = runs.filter((run) => run.status === "running").length;
    this.stats.completedCount = runs.filter((run) => run.status === "completed").length;
    this.stats.runningRuns = runs.filter((run) => run.status === "running").slice(0, 5);
    this.stats.latestCompleted = runs.find((run) => run.status === "completed") ?? null;

    if (issues.length > 0) this.notice = issues[0] ?? "Failed to load project summary";
  }

  private async refreshTargets(): Promise<void> {
    const loadId = ++this.targetLoadId;
    this.stats = { ...this.stats, targetsLoading: true };
    try {
      const config = await loadLauncherConfigFromEvalDir(this.project.evalDir);
      if (loadId !== this.targetLoadId) return;
      this.stats = {
        ...this.stats,
        benchTargets: (config?.benchDefs ?? []).map(targetFromBench),
        regressionTargets: (config?.suiteDefs ?? []).map(targetFromSuite),
        targetsLoading: false,
      };
      this.controller.requestRender();
    } catch (error) {
      if (loadId !== this.targetLoadId) return;
      this.stats = { ...this.stats, benchTargets: [], regressionTargets: [], targetsLoading: false };
      this.notice = error instanceof Error ? error.message : "Failed to load launcher targets";
      this.controller.requestRender();
    }
  }

  private openLaunch(type: LaunchType): void {
    this.controller.push(new LauncherScreen(this.controller, this.project, { initialType: type }));
  }
}

function emptyStats(): HomeStats {
  return {
    trialCount: 0,
    enabledTrialCount: 0,
    suiteCount: 0,
    runCount: 0,
    runningCount: 0,
    completedCount: 0,
    runningRuns: [],
    latestCompleted: null,
    benchTargets: [],
    regressionTargets: [],
    targetsLoading: false,
  };
}

function targetFromBench(bench: LauncherBenchDef): HomeTarget {
  const parts = [
    bench.profiles.length > 0 ? formatCount(bench.profiles.length, "profile") : "model comparison",
    ...(bench.baseline ? [`base ${bench.baseline}`] : []),
    ...(bench.epochs !== undefined ? [formatCount(bench.epochs, "epoch")] : []),
    ...(bench.trialCount !== undefined ? [formatCount(bench.trialCount, "trial")] : []),
  ];
  return {
    name: bench.name,
    detail: parts.join(" · "),
  };
}

function targetFromSuite(suite: LauncherSuiteDef): HomeTarget {
  return {
    name: suite.name,
    detail: [formatCount(suite.trials.length, "trial"), suite.description].filter(Boolean).join(" · "),
  };
}

function formatCount(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function metric(label: string, value: string): string {
  return `${theme.dim(label)} ${theme.fg("text", value)}`;
}

function renderScore(run: RunIndexEntry): string {
  return Number.isFinite(run.overall) ? run.overall.toFixed(1) : run.status;
}

function renderTargetLines(
  key: string,
  label: string,
  targets: HomeTarget[],
  options: { empty: string; loading: boolean },
): string[] {
  const lines = [`${theme.fg("accent", key)} ${theme.bold(label)}`];
  if (options.loading) {
    lines.push(theme.dim("Loading targets..."));
    return lines;
  }
  if (targets.length === 0) {
    lines.push(theme.dim(options.empty));
    return lines;
  }
  for (const target of targets.slice(0, MAX_HOME_TARGETS)) {
    lines.push(`${theme.fg("accent", "•")} ${theme.bold(target.name)}  ${theme.dim(target.detail)}`);
  }
  const remaining = targets.length - MAX_HOME_TARGETS;
  if (remaining > 0) lines.push(theme.dim(`+${remaining} more`));
  return lines;
}

interface CardData {
  title: string;
  lines: string[];
}

function card(title: string, lines: string[]): CardData {
  return { title, lines };
}

function renderCardRow(cards: CardData[], width: number): string[] {
  const gap = "  ";
  const minCardWidth = 24;
  if (width < cards.length * minCardWidth + gap.length * (cards.length - 1)) {
    return cards.flatMap((entry, index) => [...(index > 0 ? [""] : []), ...frameCard(entry.title, entry.lines, width)]);
  }
  const cardWidth = Math.floor((width - gap.length * (cards.length - 1)) / cards.length);
  const rendered = cards.map((entry) => frameCard(entry.title, entry.lines, cardWidth));
  const rowCount = Math.max(...rendered.map((entry) => entry.length));
  const padded = rendered.map((entry) => padFrameCard(entry, cardWidth, rowCount));
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push(padded.map((entry) => entry[i] ?? padVisible("", cardWidth)).join(gap));
  }
  return rows;
}

function padFrameCard(lines: string[], width: number, rowCount: number): string[] {
  if (lines.length >= rowCount) return lines;
  const next = [...lines];
  const bottom = next.pop() ?? "";
  const innerWidth = Math.max(1, width - 4);
  while (next.length < rowCount - 1) {
    next.push(`${theme.dim("│")} ${padVisible("", innerWidth)} ${theme.dim("│")}`);
  }
  next.push(bottom);
  return next;
}

function frameCard(title: string, content: string[], width: number): string[] {
  const cardWidth = Math.max(24, width);
  const innerWidth = Math.max(1, cardWidth - 4);
  const topLabel = ` ${title} `;
  const topLine = `┌${topLabel}${"─".repeat(Math.max(0, cardWidth - visibleWidth(topLabel) - 2))}┐`;
  const lines = [theme.dim(topLine)];
  const body = content.length === 0 ? [theme.dim("-")] : content;
  for (const raw of body) {
    lines.push(`${theme.dim("│")} ${padVisible(truncateVisible(raw, innerWidth), innerWidth)} ${theme.dim("│")}`);
  }
  lines.push(theme.dim(`└${"─".repeat(cardWidth - 2)}┘`));
  return lines;
}

function truncateVisible(value: string, width: number): string {
  if (visibleWidth(value) <= width) return value;
  const marker = "…";
  const limit = Math.max(0, width - visibleWidth(marker));
  let result = "";
  let index = 0;
  while (index < value.length && visibleWidth(result) < limit) {
    const ansiEscape = readAnsiEscape(value, index);
    if (ansiEscape) {
      result += ansiEscape;
      index += ansiEscape.length;
      continue;
    }
    const char = value[index] ?? "";
    if (visibleWidth(`${result}${char}`) > limit) break;
    result += char;
    index += char.length;
  }
  return `${result}\x1b[0m${theme.dim(marker)}`;
}

function readAnsiEscape(value: string, index: number): string | null {
  if (value.charCodeAt(index) !== 0x1b || value[index + 1] !== "[") return null;
  let cursor = index + 2;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code >= 0x40 && code <= 0x7e) return value.slice(index, cursor + 1);
    cursor += 1;
  }
  return null;
}

function padVisible(value: string, width: number): string {
  const visible = visibleWidth(value);
  if (visible >= width) return value;
  return `${value}${" ".repeat(width - visible)}`;
}

function readRuns(evalDir: string): RunIndexEntry[] {
  const indexPath = path.join(evalDir, "runs", "index.json");
  if (!fs.existsSync(indexPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    const entries = (Array.isArray(parsed) ? parsed : (parsed.runs ?? [])) as RunIndexEntry[];
    return [...entries].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  } catch {
    return [];
  }
}

function renderRunSummary(run: RunIndexEntry): string {
  const status = renderStatus(run.status);
  const score = run.status === "completed" && Number.isFinite(run.overall) ? run.overall.toFixed(1) : "-";
  const suite = run.suite ? theme.dim(` · ${run.suite}`) : "";
  return `${status} ${theme.bold(run.trial)}${theme.dim(`/${run.variant}`)}${suite}  ${theme.dim(score)}  ${theme.dim(formatTime(run.startedAt))}`;
}

function renderStatus(status: string): string {
  switch (status) {
    case "completed":
      return theme.fg("success", "●");
    case "running":
      return theme.fg("accent", "▷");
    case "timeout":
    case "stalled":
      return theme.fg("warning", "◐");
    case "crashed":
      return theme.fg("error", "✕");
    default:
      return theme.dim("○");
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
