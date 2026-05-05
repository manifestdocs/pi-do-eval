import * as fs from "node:fs";
import * as path from "node:path";
import { Key, matchesKey, Spacer, Text } from "@mariozechner/pi-tui";
import type { RunIndexEntry } from "$eval/types.js";
import type { RegisteredProject } from "$lib/server/projects.js";
import { ScrollableList } from "../components/scrollable-list.js";
import type { Screen, ScreenController } from "../screen.js";
import { theme } from "../theme.js";
import { LauncherScreen } from "./launcher.js";
import { RunDetailScreen } from "./run-detail.js";
import { SuitesScreen } from "./suites.js";
import { TrialsScreen } from "./trials.js";

interface RunRow {
  entry: RunIndexEntry;
}

export class RunsScreen implements Screen {
  readonly id = "runs";
  focused = true;
  private heading: Text;
  private spacer = new Spacer(1);
  private list: ScrollableList<RunRow>;

  constructor(
    private controller: ScreenController,
    private project: RegisteredProject,
  ) {
    this.heading = new Text(`  ${theme.bold("Runs")}`, 0, 0);
    this.list = new ScrollableList<RunRow>({
      renderRow: (row, _w) => renderRunRow(row.entry),
      onSelect: (row) => this.openRun(row.entry),
      maxRows: this.controller.bodyMaxRows() - 3,
      emptyMessage: "No runs yet. Press r to run.",
    });
    this.refresh();
  }

  enter(): void {
    this.refresh();
    this.controller.setStatusLeft(`Runs · ${this.project.name}`);
    this.controller.setStatusRight("↵ inspect · r run · s suites · t trials · R refresh · esc home");
  }

  invalidate(): void {
    this.list.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "r")) {
      this.controller.push(new LauncherScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, "s")) {
      this.controller.replace(new SuitesScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, "t")) {
      this.controller.replace(new TrialsScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, Key.shift("r"))) {
      this.refresh();
      this.controller.requestRender();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.controller.pop();
      return;
    }
    this.list.focused = true;
    this.list.handleInput(data);
    this.controller.requestRender();
  }

  render(width: number): string[] {
    this.list.focused = this.focused;
    this.list.setMaxRows(Math.max(3, this.controller.bodyMaxRows() - 3));
    return [...this.heading.render(width), ...this.spacer.render(width), ...this.list.render(width)];
  }

  private refresh(): void {
    const indexPath = path.join(this.project.evalDir, "runs", "index.json");
    if (!fs.existsSync(indexPath)) {
      this.list.setItems([]);
      return;
    }
    try {
      const raw = fs.readFileSync(indexPath, "utf-8");
      const parsed = JSON.parse(raw);
      const entries = (Array.isArray(parsed) ? parsed : (parsed.runs ?? [])) as RunIndexEntry[];
      const sorted = [...entries].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      const current = sorted.filter((entry) => entry.status === "running");
      const recent = sorted.filter((entry) => entry.status !== "running").slice(0, Math.max(0, 5 - current.length));
      this.list.setItems([...current, ...recent].map((entry) => ({ entry })));
    } catch {
      this.list.setItems([]);
    }
  }

  private openRun(entry: RunIndexEntry): void {
    const runDir = path.join(this.project.evalDir, "runs", entry.dir);
    this.controller.push(new RunDetailScreen(this.controller, this.project, entry, runDir));
  }
}

function renderRunRow(entry: RunIndexEntry): string {
  const status = renderStatus(entry.status);
  const score = renderScore(entry.overall, entry.status);
  const trial = theme.bold(entry.trial);
  const variant = theme.dim(`/${entry.variant}`);
  const suite = entry.suite ? theme.fg("muted", ` · ${entry.suite}`) : "";
  const epoch = entry.epoch && entry.totalEpochs ? theme.dim(` [${entry.epoch}/${entry.totalEpochs}]`) : "";
  const time = theme.dim(` · ${formatTime(entry.startedAt)}`);
  return `${status}  ${score}  ${trial}${variant}${suite}${epoch}${time}`;
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

function renderScore(overall: number, status: string): string {
  if (status !== "completed" || !Number.isFinite(overall)) return theme.dim("  - ");
  const formatted = overall.toFixed(1).padStart(5, " ");
  if (overall >= 80) return theme.fg("scoreGood", formatted);
  if (overall >= 60) return theme.fg("scoreOk", formatted);
  return theme.fg("scoreBad", formatted);
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
