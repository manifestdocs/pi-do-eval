import { type Component, truncateToWidth } from "@mariozechner/pi-tui";
import type { EvalEvent } from "$eval/types.js";
import { theme } from "../theme.js";

/**
 * One row in the live timeline. Captures both events streamed from a running
 * eval (subset of EvalEvent) and post-hoc events synthesised from a parsed
 * session (tool calls, file writes, plugin events).
 */
export interface TimelineEntry {
  ts: number;
  text: string;
}

export class Timeline implements Component {
  private entries: TimelineEntry[] = [];
  private maxRows: number;
  private heading: string;

  constructor(options: { maxRows?: number; heading?: string } = {}) {
    this.maxRows = options.maxRows ?? 20;
    this.heading = options.heading ?? "";
  }

  setEntries(entries: TimelineEntry[]): void {
    this.entries = entries;
  }

  append(entry: TimelineEntry): void {
    this.entries.push(entry);
  }

  setMaxRows(rows: number): void {
    this.maxRows = Math.max(1, rows);
  }

  ingest(event: EvalEvent): void {
    const entry = formatEvalEvent(event);
    if (entry) this.entries.push(entry);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    if (this.heading) lines.push(fitLine(`  ${theme.bold(this.heading)}`, width));
    if (this.entries.length === 0) {
      lines.push(fitLine(`  ${theme.dim("(no events)")}`, width));
      return lines;
    }
    const slice = this.entries.slice(-this.maxRows);
    for (const e of slice) lines.push(fitLine(`  ${e.text}`, width));
    if (this.entries.length > this.maxRows) {
      lines.push(fitLine(theme.dim(`  …${this.entries.length - this.maxRows} earlier event(s) hidden`), width));
    }
    return lines;
  }
}

function fitLine(line: string, width: number): string {
  return truncateToWidth(line, width, "…");
}

function formatEvalEvent(event: EvalEvent): TimelineEntry | null {
  switch (event.type) {
    case "run_started":
      return {
        ts: event.timestamp,
        text: `${theme.fg("success", "▷")} ${theme.bold("run started")} ${theme.fg("muted", `${event.trial}/${event.variant}`)}`,
      };
    case "run_progress":
      return {
        ts: event.timestamp,
        text: `${theme.fg("accent", "·")} ${theme.dim(`${Math.round(event.durationMs / 1000)}s`)} · ${theme.fg("text", `${event.toolCount} tools`)} · ${theme.fg("text", `${event.fileCount} files`)}`,
      };
    case "run_completed":
      return {
        ts: event.timestamp,
        text: `${theme.fg(event.status === "completed" ? "success" : "warning", "■")} ${theme.bold("run completed")} ${theme.fg("muted", event.status)}${event.overall !== undefined ? theme.fg("text", ` · ${event.overall.toFixed(1)}`) : ""}`,
      };
    case "epoch_progress":
      return {
        ts: event.timestamp,
        text: `${theme.fg("accent", "↻")} epoch ${theme.bold(`${event.epoch}/${event.totalEpochs}`)} ${theme.fg("muted", `${event.trial}/${event.variant}`)}`,
      };
    case "suite_regression":
      return {
        ts: event.timestamp,
        text: `${theme.fg(event.hasRegression ? "warning" : "success", "Δ")} suite comparison: ${theme.fg("text", `${event.hardCount} hard, ${event.clearCount} clear, ${event.driftCount} drift`)}`,
      };
    case "index_updated":
      // Index updates are common; suppress from the timeline.
      return null;
    default:
      return null;
  }
}
