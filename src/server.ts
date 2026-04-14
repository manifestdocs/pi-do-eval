import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import type { EvalEvent, RunIndexEntry } from "./types.js";

const DEFAULT_PORT = 4242;
const DEBOUNCE_MS = 300;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
};

export class EvalServer {
  private server: http.Server | null = null;
  private clients = new Set<http.ServerResponse>();
  private events: EvalEvent[] = [];
  private watcher: fs.FSWatcher | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastIndex: string | null = null;

  constructor(
    private runsDir: string,
    private port = DEFAULT_PORT,
  ) {
    this.runsDir = path.resolve(runsDir);
  }

  start(): void {
    if (this.server) return;

    // Ensure runs dir exists
    const runsPath = path.join(this.runsDir, "runs");
    if (!fs.existsSync(runsPath)) fs.mkdirSync(runsPath, { recursive: true });

    // Load initial index and emit
    this.loadAndEmitIndex();

    this.server = http.createServer((req, res) => this.route(req, res));
    this.server.listen(this.port, "127.0.0.1", () => {
      console.log(`Eval viewer: http://localhost:${this.port}`);
    });

    this.startWatching();
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.server?.close();
    this.server = null;
  }

  emit(event: EvalEvent): void {
    this.events.push(event);
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      client.write(data);
    }
  }

  // -- Routing ----------------------------------------------------------------

  private route(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);
    const pathname = url.pathname;

    if (pathname === "/events") {
      this.handleSSE(res);
      return;
    }

    if (pathname === "/" || pathname === "/index.html") {
      this.serveViewerHtml(res);
      return;
    }

    if (pathname.startsWith("/runs/")) {
      this.serveRunFile(pathname, res);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  }

  // -- SSE --------------------------------------------------------------------

  private handleSSE(res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Replay historical events
    for (const event of this.events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  // -- Static files -----------------------------------------------------------

  private serveViewerHtml(res: http.ServerResponse): void {
    const viewerPath = new URL("./viewer.html", import.meta.url);
    try {
      const content = fs.readFileSync(viewerPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end("Failed to load viewer");
    }
  }

  private serveRunFile(pathname: string, res: http.ServerResponse): void {
    // Prevent path traversal
    const relative = pathname.slice(1); // remove leading /
    if (relative.includes("..")) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const filePath = path.join(this.runsDir, relative);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const mime = MIME[ext] ?? "application/octet-stream";
    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": mime });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end("Failed to read file");
    }
  }

  // -- Filesystem watching ----------------------------------------------------

  private startWatching(): void {
    const runsPath = path.join(this.runsDir, "runs");
    try {
      this.watcher = fs.watch(runsPath, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        this.debouncedFileChange(filename);
      });
    } catch {
      // fs.watch may not be available; fall back to polling
      setInterval(() => this.loadAndEmitIndex(), 5000);
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
      return;
    }

    if (basename === "status.json") {
      this.onStatusChanged(filename);
      return;
    }

    if (basename === "live.json") {
      this.onLiveChanged(filename);
      return;
    }

    if (basename === "report.json") {
      this.onReportChanged(filename);
      return;
    }
  }

  private loadAndEmitIndex(): void {
    const indexPath = path.join(this.runsDir, "runs", "index.json");
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
    const filePath = path.join(this.runsDir, "runs", filename);
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
    const filePath = path.join(this.runsDir, "runs", filename);
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
    // Ignore suite report files
    if (filename.startsWith("suites")) return;

    const filePath = path.join(this.runsDir, "runs", filename);
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
