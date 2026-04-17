import * as fs from "node:fs";
import * as path from "node:path";
import type { EvalEvent, RunIndexEntry } from "$eval/types.js";

const DEBOUNCE_MS = 300;
const MAX_BUFFERED_EVENTS = 500;

export type EventEmitter = (event: EvalEvent) => void;

export class RunsWatcher {
  private watcher: fs.FSWatcher | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastIndex: string | null = null;

  private events: EvalEvent[] = [];
  private listeners = new Set<EventEmitter>();

  constructor(private runsDir: string) {}

  get runsPath(): string {
    return path.join(this.runsDir, "runs");
  }

  start(): void {
    if (!fs.existsSync(this.runsPath)) {
      fs.mkdirSync(this.runsPath, { recursive: true });
    }
    this.loadAndEmitIndex();
    this.startWatching();
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.listeners.clear();
  }

  subscribe(listener: EventEmitter): () => void {
    this.listeners.add(listener);
    // Replay buffered events
    for (const event of this.events) {
      listener(event);
    }
    return () => this.listeners.delete(listener);
  }

  private emit(event: EvalEvent): void {
    if (event.type === "index_updated") {
      this.events = [event];
    } else {
      this.events.push(event);
      if (this.events.length > MAX_BUFFERED_EVENTS) {
        if (this.events[0]?.type === "index_updated") {
          this.events = [this.events[0], ...this.events.slice(-(MAX_BUFFERED_EVENTS - 1))];
        } else {
          this.events = this.events.slice(-MAX_BUFFERED_EVENTS);
        }
      }
    }
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  getListenerCount(): number {
    return this.listeners.size;
  }

  private startWatching(): void {
    try {
      this.watcher = fs.watch(this.runsPath, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        this.debouncedFileChange(filename);
      });
    } catch {
      this.pollInterval = setInterval(() => this.loadAndEmitIndex(), 5000);
    }
  }

  private debouncedFileChange(filename: string): void {
    const existing = this.debounceTimers.get(filename);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      filename,
      setTimeout(() => {
        this.debounceTimers.delete(filename);
        this.onFileChanged(filename);
      }, DEBOUNCE_MS),
    );
  }

  private onFileChanged(filename: string): void {
    const basename = path.basename(filename);

    if (basename === "index.json") {
      this.loadAndEmitIndex();
    } else if (basename === "status.json") {
      this.onStatusChanged(filename);
    } else if (basename === "live.json") {
      this.onLiveChanged(filename);
    } else if (basename === "report.json") {
      this.onReportChanged(filename);
    }
  }

  private loadAndEmitIndex(): void {
    const indexPath = path.join(this.runsPath, "index.json");
    try {
      const content = fs.readFileSync(indexPath, "utf-8");
      if (content === this.lastIndex) return;
      this.lastIndex = content;
      const runs: RunIndexEntry[] = JSON.parse(content);
      this.emit({ type: "index_updated", timestamp: Date.now(), runs });
    } catch {
      // Index doesn't exist yet
    }
  }

  private onStatusChanged(filename: string): void {
    const filePath = path.join(this.runsPath, filename);
    try {
      const status = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const dir = path.dirname(filename);
      this.emit({
        type: "run_started",
        timestamp: Date.now(),
        dir,
        trial: status.trial ?? "",
        variant: status.variant ?? "",
        suite: status.suite,
        suiteRunId: status.suiteRunId,
        workerModel: status.workerModel,
      });
    } catch {
      // File might not be fully written yet
    }
  }

  private onLiveChanged(filename: string): void {
    const filePath = path.join(this.runsPath, filename);
    try {
      const live = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const dir = path.dirname(filename);
      this.emit({
        type: "run_progress",
        timestamp: Date.now(),
        dir,
        durationMs: live.meta?.durationMs ?? 0,
        toolCount: live.session?.toolCalls?.length ?? 0,
        fileCount: live.session?.fileWrites?.length ?? 0,
      });
    } catch {
      // File might not be fully written yet
    }
  }

  private onReportChanged(filename: string): void {
    if (filename.startsWith("suites")) return;
    const filePath = path.join(this.runsPath, filename);
    try {
      const report = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const dir = path.dirname(filename);
      this.emit({
        type: "run_completed",
        timestamp: Date.now(),
        dir,
        status: report.meta?.status ?? "completed",
        overall: report.scores?.overall ?? 0,
        durationMs: report.meta?.durationMs ?? 0,
      });
    } catch {
      // File might not be fully written yet
    }
  }
}
