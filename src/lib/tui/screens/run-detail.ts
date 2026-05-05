import * as fs from "node:fs";
import * as path from "node:path";
import { Container, Key, matchesKey, Spacer, Text } from "@mariozechner/pi-tui";
import type {
  EvalEvent,
  EvalReport,
  EvalSession,
  FileWriteRecord,
  PluginEvent,
  RunIndexEntry,
  ToolCallRecord,
} from "$eval/types.js";
import type { RegisteredProject } from "$lib/server/projects.js";
import { Tabs } from "../components/tabs.js";
import { Timeline, type TimelineEntry } from "../components/timeline.js";
import type { Screen, ScreenController } from "../screen.js";
import { theme } from "../theme.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "findings", label: "Findings" },
  { id: "timeline", label: "Timeline" },
];

interface RunDetailOptions {
  followActiveRun?: boolean;
  initialEvents?: EvalEvent[];
  runsDir?: string;
  startOnTimeline?: boolean;
}

export class RunDetailScreen implements Screen {
  readonly id = "run-detail";
  focused = true;
  private tabs = new Tabs(TABS);
  private heading: Text;
  private spacer = new Spacer(1);
  private body = new Container();
  private report: EvalReport | null = null;
  private liveTimeline = new Timeline({ heading: "Timeline (live)", maxRows: 30 });
  private unsubscribe: (() => void) | null = null;
  private followActiveRun = false;
  private runsDir: string;

  constructor(
    private controller: ScreenController,
    _project: RegisteredProject,
    private entry: RunIndexEntry,
    private runDir: string,
    options: RunDetailOptions = {},
  ) {
    void _project;
    this.runsDir = options.runsDir ?? path.dirname(runDir);
    this.followActiveRun = options.followActiveRun ?? false;
    if (options.startOnTimeline) this.tabs.setActive(2);
    this.heading = this.buildHeading();
    this.loadReport();
    if (!this.report) this.loadLiveTimeline();
    for (const event of options.initialEvents ?? []) this.applyLiveEvent(event);
    this.rebuildBody();
  }

  enter(): void {
    this.refreshStatus();
    this.controller.setStatusRight("← → tabs · esc back · q quit");
    this.unsubscribe = this.controller.onEvent((event) => this.onLiveEvent(event));
  }

  exit(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onLiveEvent(event: EvalEvent): void {
    const accepted = this.applyLiveEvent(event);
    if (!accepted) return;
    this.rebuildBody();
    this.controller.requestRender();
  }

  private applyLiveEvent(event: EvalEvent): boolean {
    if (event.type === "run_started" && this.followActiveRun && event.dir !== this.entry.dir) {
      this.switchToStartedRun(event);
    }

    // Only react to events for this run.
    const dir =
      event.type === "run_started" || event.type === "run_progress" || event.type === "run_completed"
        ? event.dir
        : null;
    if (!dir || dir !== this.entry.dir) return false;

    if (event.type === "run_progress") {
      if (!this.loadLiveTimeline()) this.liveTimeline.ingest(event);
    } else {
      this.liveTimeline.ingest(event);
    }
    if (event.type === "run_completed") {
      // Reload the report to refresh Overview / Findings tabs.
      this.loadReport();
    }
    return true;
  }

  invalidate(): void {
    this.body.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.controller.pop();
      return;
    }
    const before = this.tabs.getActiveIndex();
    this.tabs.handleInput(data);
    if (this.tabs.getActiveIndex() !== before) {
      this.rebuildBody();
      this.controller.requestRender();
    }
  }

  render(width: number): string[] {
    return [
      ...this.heading.render(width),
      ...this.spacer.render(width),
      ...this.tabs.render(width),
      ...this.body.render(width),
    ];
  }

  private loadReport(): void {
    const reportPath = path.join(this.runDir, "report.json");
    if (!fs.existsSync(reportPath)) return;
    try {
      this.report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as EvalReport;
    } catch {
      this.report = null;
    }
  }

  private loadLiveTimeline(): boolean {
    const livePath = path.join(this.runDir, "live.json");
    if (!fs.existsSync(livePath)) return false;
    try {
      const live = JSON.parse(fs.readFileSync(livePath, "utf-8")) as { session?: unknown };
      if (!isSessionLike(live.session)) return false;
      this.liveTimeline.setEntries(mergeTimelineEntries(live.session));
      return true;
    } catch {
      return false;
    }
  }

  private rebuildBody(): void {
    this.body.clear();
    if (!this.report) {
      if (this.tabs.getActiveId() === "timeline") {
        this.renderTimeline();
      } else {
        this.body.addChild(new Spacer(1));
        this.body.addChild(new Text(`  ${theme.fg("accent", "running")}`, 0, 0));
        this.body.addChild(new Text(`  ${theme.dim(this.runDir)}`, 0, 0));
        this.body.addChild(new Spacer(1));
        this.body.addChild(new Text(`  ${theme.dim("Report will appear when scoring completes.")}`, 0, 0));
      }
      return;
    }
    const id = this.tabs.getActiveId() ?? "overview";
    if (id === "overview") this.renderOverview();
    else if (id === "findings") this.renderFindings();
    else this.renderTimeline();
  }

  private renderOverview(): void {
    if (!this.report) return;
    const { meta, scores } = this.report;
    this.body.addChild(new Spacer(1));
    this.body.addChild(line(`  ${theme.dim("Status")}    ${formatStatus(meta.status)}`));
    this.body.addChild(
      line(
        `  ${theme.dim("Verify")}    ${meta.verifyPassed ? theme.fg("success", "PASS") : theme.fg("error", "FAIL")}`,
      ),
    );
    this.body.addChild(line(`  ${theme.dim("Worker")}    ${theme.fg("text", meta.workerModel ?? "default")}`));
    if (meta.judgeModel) this.body.addChild(line(`  ${theme.dim("Judge")}     ${theme.fg("text", meta.judgeModel)}`));
    this.body.addChild(line(`  ${theme.dim("Duration")}  ${formatDuration(meta.durationMs)}`));
    this.body.addChild(new Spacer(1));
    this.body.addChild(line(`  ${theme.bold("Scores")}`));
    this.body.addChild(line(`  ${theme.dim("Overall")}   ${theme.bold(scores.overall.toFixed(1))}`));
    for (const [key, value] of Object.entries(scores.deterministic)) {
      this.body.addChild(line(`  ${theme.dim(`  ${key.padEnd(7)}`)}${theme.fg("text", value.toFixed(1))}`));
    }
    if (scores.judge) {
      this.body.addChild(new Spacer(1));
      this.body.addChild(line(`  ${theme.bold("Judge")}`));
      for (const [key, value] of Object.entries(scores.judge)) {
        this.body.addChild(line(`  ${theme.dim(`  ${key.padEnd(20)}`)}${theme.fg("text", value.toFixed(1))}`));
      }
    }
  }

  private renderFindings(): void {
    if (!this.report) return;
    this.body.addChild(new Spacer(1));
    if (this.report.findings.length === 0) {
      this.body.addChild(new Text(`  ${theme.fg("success", "No findings — clean run")}`, 0, 0));
      return;
    }
    for (const finding of this.report.findings) {
      this.body.addChild(new Text(`  ${theme.fg("warning", "•")} ${theme.fg("text", finding)}`, 0, 0));
    }
  }

  private renderTimeline(): void {
    if (!this.report) {
      // Live-only mode (a run that's still in flight): show only the live timeline.
      this.body.addChild(new Spacer(1));
      this.body.addChild(this.liveTimeline);
      return;
    }
    const session: EvalSession = this.report.session;
    this.body.addChild(new Spacer(1));
    if (session.toolCalls.length === 0 && session.fileWrites.length === 0 && session.pluginEvents.length === 0) {
      this.body.addChild(new Text(`  ${theme.dim("No timeline events recorded.")}`, 0, 0));
      return;
    }
    const events = mergeTimeline(session);
    this.body.addChild(line(`  ${theme.dim(`${events.length} events`)}`));
    this.body.addChild(new Spacer(1));
    // Cap to most recent 50 to keep the screen responsive.
    for (const event of events.slice(-50)) {
      this.body.addChild(new Text(`  ${event}`, 0, 0));
    }
  }

  private switchToStartedRun(event: Extract<EvalEvent, { type: "run_started" }>): void {
    this.runsDir = event.runsDir ?? this.runsDir;
    this.entry = runEntryFromStarted(event);
    this.runDir = path.join(this.runsDir, event.dir);
    this.report = null;
    this.liveTimeline = new Timeline({ heading: "Timeline (live)", maxRows: 30 });
    this.heading = this.buildHeading();
    this.loadReport();
    if (!this.report) this.loadLiveTimeline();
    this.refreshStatus();
  }

  private buildHeading(): Text {
    return new Text(
      `  ${theme.bold(this.entry.trial)}${theme.dim(`/${this.entry.variant}`)}` +
        (this.entry.suite ? `${theme.dim("  ·  ")}${theme.fg("muted", this.entry.suite)}` : ""),
      0,
      0,
    );
  }

  private refreshStatus(): void {
    this.controller.setStatusLeft(`Run · ${this.entry.trial}/${this.entry.variant}`);
  }
}

function runEntryFromStarted(event: Extract<EvalEvent, { type: "run_started" }>): RunIndexEntry {
  return {
    dir: event.dir,
    trial: event.trial,
    variant: event.variant,
    status: "running",
    overall: 0,
    durationMs: 0,
    startedAt: new Date(event.timestamp).toISOString(),
    workerModel: event.workerModel ?? "",
    ...(event.suite ? { suite: event.suite } : {}),
    ...(event.suiteRunId ? { suiteRunId: event.suiteRunId } : {}),
  };
}

function line(text: string): Text {
  return new Text(text, 0, 0);
}

function formatStatus(status: string): string {
  switch (status) {
    case "completed":
      return theme.fg("success", "completed");
    case "running":
      return theme.fg("accent", "running");
    case "timeout":
      return theme.fg("warning", "timeout");
    case "stalled":
      return theme.fg("warning", "stalled");
    case "crashed":
      return theme.fg("error", "crashed");
    default:
      return theme.dim(status);
  }
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds - minutes * 60;
  return `${minutes}m ${rem}s`;
}

export function mergeTimelineEntries(session: EvalSession): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const tc of session.toolCalls) {
    entries.push({ ts: tc.timestamp, text: renderToolCall(tc) });
  }
  for (const fw of session.fileWrites) {
    entries.push({ ts: fw.timestamp, text: renderFileWrite(fw) });
  }
  for (const ev of session.pluginEvents) {
    entries.push({ ts: ev.timestamp, text: renderPluginEvent(ev) });
  }
  entries.sort((a, b) => a.ts - b.ts);
  return entries;
}

function mergeTimeline(session: EvalSession): string[] {
  return mergeTimelineEntries(session).map((e) => e.text);
}

function renderToolCall(tc: ToolCallRecord): string {
  const icon = tc.wasBlocked ? theme.fg("error", "⊘") : theme.fg("accent", "→");
  const args = formatToolArgs(tc.arguments);
  const result = formatResultText(tc.resultText);
  return `${icon} ${theme.bold(tc.name)}${tc.wasBlocked ? theme.dim(" (blocked)") : ""}${
    args ? theme.fg("muted", ` ${args}`) : ""
  }${result ? theme.dim(` · ${result}`) : ""}`;
}

function renderFileWrite(fw: FileWriteRecord): string {
  return `${theme.fg("accent", "✎")} ${theme.fg("muted", fw.tool)} ${theme.fg("text", fw.path)}${
    fw.labels.length ? theme.dim(` [${fw.labels.join(",")}]`) : ""
  }`;
}

function renderPluginEvent(event: PluginEvent): string {
  const payload = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
  return `${theme.fg("accentStrong", "◆")} ${theme.fg("text", event.type)}${payload ? theme.dim(` ${truncate(payload, 96)}`) : ""}`;
}

function formatToolArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  if (typeof args.command === "string") return truncate(args.command, 96);
  if (typeof args.path === "string") return truncate(args.path, 96);
  const json = JSON.stringify(args);
  return truncate(json, 96);
}

function formatResultText(resultText: string | undefined): string {
  if (!resultText) return "";
  const oneLine = resultText.replace(/\s+/g, " ").trim();
  return truncate(oneLine, 80);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function isSessionLike(value: unknown): value is EvalSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Partial<EvalSession>;
  return Array.isArray(session.toolCalls) && Array.isArray(session.fileWrites) && Array.isArray(session.pluginEvents);
}
