import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Container, isKeyRelease, Key, matchesKey, ProcessTerminal, Spacer, Text, TUI } from "@mariozechner/pi-tui";
import type { EvalEvent } from "$eval/types.js";
import { addOrUpdateProject, resolveProjectIdentifier, setActiveProject } from "$lib/server/projects.js";
import { probeDoEvalWeb } from "$lib/server/web-probe.js";
import { EvalEventBus } from "./bus.js";
import { HeaderBar } from "./components/header-bar.js";
import { StatusBar } from "./components/status-bar.js";
import type { Screen, ScreenController } from "./screen.js";
import { ProjectHomeScreen } from "./screens/home.js";
import { ProjectsScreen } from "./screens/projects.js";
import { theme } from "./theme.js";

export interface TuiAppOptions {
  /** Optional initial project path. If omitted, lands on the projects screen. */
  projectPath?: string;
  /** Legacy URL-only web viewer label. Prefer `web` so availability is explicit. */
  webUrl?: string;
  web?: TuiWebHandle;
}

export interface TuiWebHandle {
  url: string;
  state: "disabled" | "ready" | "starting" | "unavailable";
  child?: ChildProcess;
  error?: string;
}

const HEADER_ROWS = 1;
const STATUS_ROWS = 1;
const FALLBACK_TERMINAL_ROWS = 24;

export class TuiApp {
  private tui: TUI;
  private header: HeaderBar;
  private body: Container;
  private status: StatusBar;
  private bus = new EvalEventBus();
  private stack: Screen[] = [];
  private evalDir: string | null = null;
  private activeRun: { dir: string; trial: string; variant: string; startedAt: number } | null = null;
  private activeMetrics = { toolCount: 0, fileCount: 0, durationMs: 0 };
  private activeRunTimer: NodeJS.Timeout | undefined;
  private web: TuiWebHandle;
  private webProbeTimer: NodeJS.Timeout | undefined;
  private webProbeInFlight = false;
  private webProbeDeadline = 0;
  private stopping = false;
  private statusLeftBase = "";

  constructor(options: TuiAppOptions = {}) {
    this.web =
      options.web ?? (options.webUrl ? { url: options.webUrl, state: "ready" } : { url: "", state: "disabled" });
    this.tui = new TUI(new ProcessTerminal());
    this.header = new HeaderBar({});
    this.body = new Container();
    this.status = new StatusBar();

    this.tui.addChild(this.header);
    this.tui.addChild(this.body);
    this.tui.addChild(this.status);

    this.bus.subscribe((event) => this.handleBusEvent(event));

    const controller = this.makeController();
    this.installInitialScreen(controller, options.projectPath);
  }

  private handleBusEvent(event: EvalEvent): void {
    if (event.type === "run_started") {
      this.activeRun = {
        dir: event.dir,
        trial: event.trial,
        variant: event.variant,
        startedAt: event.timestamp,
      };
      this.activeMetrics = { toolCount: 0, fileCount: 0, durationMs: 0 };
      this.startActiveRunTicker();
      this.refreshActiveRunStatus();
    } else if (event.type === "run_progress" && this.activeRun?.dir === event.dir) {
      this.activeMetrics = {
        toolCount: event.toolCount,
        fileCount: event.fileCount,
        durationMs: event.durationMs,
      };
      this.refreshActiveRunStatus();
    } else if (event.type === "run_completed" && this.activeRun?.dir === event.dir) {
      this.activeRun = null;
      this.stopActiveRunTicker();
      this.status.set({ center: "" });
      this.tui.requestRender();
    }
  }

  private startActiveRunTicker(): void {
    this.stopActiveRunTicker();
    this.activeRunTimer = setInterval(() => {
      if (!this.activeRun) {
        this.stopActiveRunTicker();
        return;
      }
      this.activeMetrics.durationMs = Date.now() - this.activeRun.startedAt;
      this.refreshActiveRunStatus();
    }, 1000);
  }

  private stopActiveRunTicker(): void {
    if (this.activeRunTimer) {
      clearInterval(this.activeRunTimer);
      this.activeRunTimer = undefined;
    }
  }

  private refreshActiveRunStatus(): void {
    if (!this.activeRun) {
      this.status.set({ center: "" });
    } else {
      const seconds = Math.round(this.activeMetrics.durationMs / 1000);
      const summary = `▷ ${this.activeRun.trial}/${this.activeRun.variant} · ${seconds}s · ${this.activeMetrics.toolCount}t · ${this.activeMetrics.fileCount}f`;
      this.status.set({ center: summary });
    }
    this.tui.requestRender();
  }

  start(): void {
    this.installGlobalShortcuts();
    this.tui.start();
    // pi-tui's first render assumes a clean terminal. do-eval is usually
    // launched from an existing shell prompt, so force a viewport clear once.
    this.tui.requestRender(true);
    this.startWebMonitoring();
  }

  private startWebMonitoring(): void {
    if (this.web.state === "disabled") return;

    this.web.child?.once("exit", () => {
      if (this.stopping) return;
      this.stopWebProbe();
      this.web = { ...this.web, state: "unavailable", child: undefined, error: "web viewer exited" };
      this.refreshStatusLeft();
    });

    if (this.web.state !== "starting") {
      this.refreshStatusLeft();
      return;
    }

    this.webProbeDeadline = Date.now() + 15_000;
    this.webProbeTimer = setInterval(() => {
      void this.refreshWebAvailability();
    }, 500);
    void this.refreshWebAvailability();
  }

  private async refreshWebAvailability(): Promise<void> {
    if (this.webProbeInFlight || this.web.state !== "starting") return;
    this.webProbeInFlight = true;
    const result = await probeDoEvalWeb(this.web.url);
    this.webProbeInFlight = false;

    if (result.ok) {
      this.stopWebProbe();
      this.web = { ...this.web, state: "ready", error: undefined };
      this.refreshStatusLeft();
      return;
    }

    if (Date.now() >= this.webProbeDeadline) {
      this.stopWebProbe();
      this.web = { ...this.web, state: "unavailable", error: result.reason ?? "web viewer did not start" };
      this.refreshStatusLeft();
    }
  }

  private stopWebProbe(): void {
    if (!this.webProbeTimer) return;
    clearInterval(this.webProbeTimer);
    this.webProbeTimer = undefined;
  }

  private installInitialScreen(controller: ScreenController, projectPath?: string): void {
    if (projectPath) {
      try {
        let resolved = resolveProjectIdentifier(projectPath);
        if (!resolved) {
          const added = addOrUpdateProject(projectPath);
          resolved = added.project;
        } else {
          setActiveProject(resolved.id);
        }
        controller.setProject(resolved.name, resolved.evalDir);
        this.push(new ProjectHomeScreen(controller, resolved));
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open project";
        this.body.clear();
        this.body.addChild(new Spacer(1));
        this.body.addChild(new Text(`  ${theme.fg("error", "Project error:")} ${theme.fg("text", message)}`, 0, 0));
        this.setStatusLeft("Error");
        this.status.set({ right: "q quit" });
        return;
      }
    }
    this.push(new ProjectsScreen(controller));
  }

  private installGlobalShortcuts(): void {
    this.tui.addInputListener((data: string) => {
      // This listener consumes input before pi-tui's focused-component release
      // filter runs. Ignore Kitty key releases here so a single arrow press
      // does not route twice through the active screen.
      if (isKeyRelease(data)) {
        return { consume: true };
      }
      // Quit only when the active screen is the root and key is q (avoid stealing 'q' inside lists).
      if (matchesKey(data, Key.ctrl("c"))) {
        this.exit();
        return { consume: true };
      }
      if (matchesKey(data, "q") && this.stack.length === 1) {
        this.exit();
        return { consume: true };
      }
      // Forward to focused screen (the topmost on the stack).
      const top = this.stack[this.stack.length - 1];
      if (top) {
        top.handleInput?.(data);
        return { consume: true };
      }
      return undefined;
    });
  }

  private push(screen: Screen): void {
    this.stack.push(screen);
    this.activate(screen);
  }

  private replace(screen: Screen): void {
    const old = this.stack.pop();
    old?.exit?.();
    this.stack.push(screen);
    this.activate(screen);
  }

  private pop(): void {
    if (this.stack.length <= 1) return;
    const old = this.stack.pop();
    old?.exit?.();
    const top = this.stack[this.stack.length - 1];
    if (top) this.activate(top);
  }

  private activate(screen: Screen): void {
    this.body.clear();
    this.body.addChild(screen);
    screen.focused = true;
    this.tui.setFocus(screen);
    screen.enter?.();
    this.tui.requestRender();
  }

  private exit(): void {
    this.stopWeb();
    this.tui.stop();
    process.exit(0);
  }

  private bodyMaxRows(): number {
    const rows = this.tui.terminal.rows ?? FALLBACK_TERMINAL_ROWS;
    return Math.max(5, rows - HEADER_ROWS - STATUS_ROWS - 1);
  }

  private makeController(): ScreenController {
    return {
      push: (screen) => this.push(screen),
      pop: () => this.pop(),
      replace: (screen) => this.replace(screen),
      setStatusLeft: (text) => {
        this.setStatusLeft(text);
      },
      setStatusCenter: (text) => {
        this.status.set({ center: text });
        this.tui.requestRender();
      },
      setStatusRight: (text) => {
        this.status.set({ right: text });
        this.tui.requestRender();
      },
      setProject: (name, dir) => {
        this.evalDir = dir;
        this.header.setProject(name, dir);
      },
      clearProject: () => {
        this.evalDir = null;
        this.header.setProject("", "");
      },
      requestRender: () => this.tui.requestRender(),
      bodyMaxRows: () => this.bodyMaxRows(),
      getEvalDir: () => this.evalDir,
      hasActiveRun: () => this.activeRun !== null,
      onEvent: (listener) => this.bus.subscribe(listener),
      emitter: () => (event) => this.bus.emit(event),
    };
  }

  private setStatusLeft(text: string): void {
    this.statusLeftBase = text;
    this.status.set({ left: this.withWebStatus(text) });
    this.tui.requestRender();
  }

  private refreshStatusLeft(): void {
    this.status.set({ left: this.withWebStatus(this.statusLeftBase) });
    this.tui.requestRender();
  }

  private withWebStatus(text: string): string {
    if (this.web.state === "disabled") return text;
    const prefix = text ? `${text} · ` : "";
    if (this.web.state === "ready") return `${prefix}Web ${this.web.url}`;
    if (this.web.state === "starting") return `${prefix}Web starting ${this.web.url}`;
    return `${prefix}Web unavailable`;
  }

  private stopWeb(): void {
    this.stopWebProbe();
    this.stopping = true;
    if (this.web.child && !this.web.child.killed) {
      this.web.child.kill();
    }
  }
}

export function runTui(options: TuiAppOptions = {}): void {
  const app = new TuiApp(options);
  app.start();
}

// Used by smoke tests to assert the entry point compiles.
export { fs as _fs, path as _path };
