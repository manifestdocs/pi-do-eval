import * as path from "node:path";
import { Container, Key, matchesKey, Spacer, Text } from "@mariozechner/pi-tui";
import { runProjectBenchCommand, runProjectRegressionCommand, runProjectTrialCommand } from "$eval/project-runner.js";
import type { EvalEvent, LauncherConfig, RunIndexEntry } from "$eval/types.js";
import { loadLauncherConfigFromEvalDir } from "$lib/server/harness.js";
import type { RegisteredProject } from "$lib/server/projects.js";
import { ScrollableList } from "../components/scrollable-list.js";
import type { Screen, ScreenController } from "../screen.js";
import { theme } from "../theme.js";
import { RunDetailScreen } from "./run-detail.js";

export type LaunchType = "trial" | "regression" | "bench";

interface TypeChoice {
  id: LaunchType;
  label: string;
  description: string;
}

const TYPE_CHOICES: TypeChoice[] = [
  { id: "bench", label: "Bench", description: "Compare configured profiles for a suite" },
  { id: "regression", label: "Regression", description: "Run a suite over the default profile" },
  { id: "trial", label: "Trial", description: "Run one trial+variant once" },
];

interface LauncherScreenOptions {
  initialType?: LaunchType;
}

/**
 * Three-step launcher: pick type → pick target (trial or suite) → pick variant
 * (trial only) → launch. Wires through to `runProject*Command` with the TUI's
 * bus as the `emit` sink so the active-run status bar and any open run-detail
 * screen update live.
 *
 * The overlay is implemented as a Screen on the stack (matching coding-agent's
 * mode-replacement idiom). Cancellable with Escape.
 */
export class LauncherScreen implements Screen {
  readonly id = "launcher";
  focused = true;
  private heading = new Text(`  ${theme.bold("Launch")}`, 0, 0);
  private body = new Container();
  private stage: "type" | "target" | "variant" | "launching" | "blocked" | "error" = "type";
  private chosenType: LaunchType | null = null;
  private chosenTarget: string | null = null;
  private launcherConfig: LauncherConfig | null = null;
  private errorMessage: string | null = null;
  private launchStarted = false;
  private runStarted = false;
  private startedRunDir: string | null = null;
  private startedAt = 0;
  private launchEmitter: ((event: EvalEvent) => void) | null = null;

  private typeList: ScrollableList<TypeChoice>;
  private targetList: ScrollableList<{ id: string; label: string; sublabel: string }>;
  private variantList: ScrollableList<{ id: string; label: string; sublabel: string }>;

  constructor(
    private controller: ScreenController,
    private project: RegisteredProject,
    private options: LauncherScreenOptions = {},
  ) {
    this.typeList = new ScrollableList<TypeChoice>({
      renderRow: (item) => `${theme.bold(item.label)}  ${theme.dim(item.description)}`,
      onSelect: (item) => this.onPickType(item.id),
      maxRows: 5,
    });
    this.typeList.setItems(TYPE_CHOICES);

    this.targetList = new ScrollableList({
      renderRow: (item) => `${theme.bold(item.label)}  ${theme.dim(item.sublabel)}`,
      onSelect: (item) => this.onPickTarget(item.id),
      maxRows: this.controller.bodyMaxRows() - 4,
      emptyMessage: "(no targets — define some via `do-eval suite create` or trial.yaml)",
    });

    this.variantList = new ScrollableList({
      renderRow: (item) => `${theme.bold(item.label)}  ${theme.dim(item.sublabel)}`,
      onSelect: (item) => this.onPickVariant(item.id),
      maxRows: this.controller.bodyMaxRows() - 4,
      emptyMessage: "(no variants)",
    });

    void this.loadConfig();
  }

  enter(): void {
    if (this.controller.hasActiveRun()) {
      this.stage = "blocked";
    }
    this.refreshStatus();
  }

  invalidate(): void {
    this.body.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) && this.stage !== "launching") {
      this.controller.pop();
      return;
    }
    const list = this.activeList();
    if (list) {
      list.focused = true;
      list.handleInput(data);
      this.controller.requestRender();
    }
  }

  render(width: number): string[] {
    this.body.clear();
    this.body.addChild(new Spacer(1));
    if (this.stage === "type") {
      this.body.addChild(new Text(`  ${theme.fg("muted", "Step 1 · pick launch mode")}`, 0, 0));
      this.body.addChild(new Spacer(1));
      this.body.addChild(this.typeList);
    } else if (this.stage === "target") {
      const verb = this.chosenType === "trial" ? "trial" : "suite";
      this.body.addChild(new Text(`  ${theme.fg("muted", `Step 2 · pick ${verb}`)}`, 0, 0));
      this.body.addChild(new Spacer(1));
      this.body.addChild(this.targetList);
    } else if (this.stage === "variant") {
      this.body.addChild(new Text(`  ${theme.fg("muted", "Step 3 · pick variant")}`, 0, 0));
      this.body.addChild(new Spacer(1));
      this.body.addChild(this.variantList);
    } else if (this.stage === "launching") {
      this.body.addChild(new Text(`  ${theme.fg("accent", "Launching…")}`, 0, 0));
    } else if (this.stage === "blocked") {
      this.body.addChild(new Text(`  ${theme.fg("warning", "Running")}`, 0, 0));
      this.body.addChild(new Spacer(1));
      this.body.addChild(new Text("  Wait for the active run to finish before launching another.", 0, 0));
    } else if (this.stage === "error") {
      this.body.addChild(
        new Text(`  ${theme.fg("error", "Launch failed:")} ${theme.fg("text", this.errorMessage ?? "")}`, 0, 0),
      );
    }
    return [...this.heading.render(width), ...this.body.render(width)];
  }

  private activeList(): ScrollableList<unknown> | null {
    if (this.stage === "type") return this.typeList as unknown as ScrollableList<unknown>;
    if (this.stage === "target") return this.targetList as unknown as ScrollableList<unknown>;
    if (this.stage === "variant") return this.variantList as unknown as ScrollableList<unknown>;
    return null;
  }

  private async loadConfig(): Promise<void> {
    try {
      this.launcherConfig = await loadLauncherConfigFromEvalDir(this.project.evalDir);
      if (this.options.initialType && this.stage === "type") {
        this.onPickType(this.options.initialType);
        return;
      }
      this.controller.requestRender();
    } catch (error) {
      this.stage = "error";
      this.errorMessage = error instanceof Error ? error.message : "Failed to load launcher config";
      this.controller.requestRender();
    }
  }

  private refreshStatus(): void {
    if (this.stage === "type") {
      this.controller.setStatusLeft("Launch · pick mode");
      this.controller.setStatusRight("↑↓ select · ↵ pick · esc cancel");
    } else if (this.stage === "target") {
      const verb = this.chosenType === "trial" ? "trial" : "suite";
      this.controller.setStatusLeft(`Launch · pick ${verb}`);
      this.controller.setStatusRight("↑↓ select · ↵ pick · esc cancel");
    } else if (this.stage === "variant") {
      this.controller.setStatusLeft("Launch · pick variant");
      this.controller.setStatusRight("↑↓ select · ↵ launch · esc cancel");
    } else if (this.stage === "launching") {
      this.controller.setStatusLeft("Launch · running");
      this.controller.setStatusRight("waiting for run to start");
    } else if (this.stage === "blocked") {
      this.controller.setStatusLeft("Launch · running");
      this.controller.setStatusRight("esc back");
    } else if (this.stage === "error") {
      this.controller.setStatusLeft("Launch · error");
      this.controller.setStatusRight("esc dismiss");
    }
    this.controller.requestRender();
  }

  private onPickType(type: LaunchType): void {
    if (!this.launcherConfig) return;
    this.chosenType = type;
    if (type === "trial") {
      const trials = this.launcherConfig.trials.filter((t) => t.enabled !== false);
      this.targetList.setItems(
        trials.map((t) => ({
          id: t.name,
          label: t.name,
          sublabel: t.description || "",
        })),
      );
    } else if (type === "bench") {
      const benches =
        this.launcherConfig.benchDefs ??
        (this.launcherConfig.suiteDefs ?? []).map((suite) => ({
          name: suite.name,
          profiles: [],
          trialCount: suite.trials.length,
          ...(suite.description ? { description: suite.description } : {}),
        }));
      this.targetList.setItems(
        benches.map((bench) => ({
          id: bench.name,
          label: bench.name,
          sublabel: renderBenchSublabel(bench),
        })),
      );
    } else {
      const suites = this.launcherConfig.suiteDefs ?? [];
      this.targetList.setItems(
        suites.map((s) => ({
          id: s.name,
          label: s.name,
          sublabel: `${s.trials.length} trial(s)${s.description ? ` · ${s.description}` : ""}`,
        })),
      );
    }
    this.stage = "target";
    this.refreshStatus();
  }

  private onPickTarget(target: string): void {
    if (!this.launcherConfig) return;
    this.chosenTarget = target;
    if (this.chosenType === "trial") {
      const trial = this.launcherConfig.trials.find((t) => t.name === target);
      if (!trial) return;
      this.variantList.setItems(
        trial.variants.map((v) => ({
          id: v,
          label: trial.variantLabels?.[v] ?? v,
          sublabel: trial.variantLabels?.[v] ? v : "",
        })),
      );
      this.stage = "variant";
      this.refreshStatus();
    } else {
      // Regression / Bench: launch immediately.
      void this.launch();
    }
  }

  private onPickVariant(variant: string): void {
    void this.launch(variant);
  }

  private async launch(variant?: string): Promise<void> {
    if (this.launchStarted) return;
    if (this.controller.hasActiveRun()) {
      this.stage = "blocked";
      this.refreshStatus();
      return;
    }
    this.launchStarted = true;
    this.runStarted = false;
    this.startedRunDir = null;
    this.startedAt = 0;
    this.stage = "launching";
    this.refreshStatus();
    const baseEmit = this.controller.emitter();
    this.launchEmitter = baseEmit;
    const emit = (event: EvalEvent) => {
      baseEmit(event);
      if (event.type === "run_started") {
        const shouldOpenMonitor = !this.runStarted;
        this.runStarted = true;
        this.startedRunDir = event.dir;
        this.startedAt = event.timestamp;
        if (shouldOpenMonitor) this.openRunMonitor(event);
      }
    };
    const projectPath = this.project.evalDir;
    try {
      if (this.chosenType === "trial" && this.chosenTarget) {
        void runProjectTrialCommand(this.chosenTarget, { projectPath, variant, emit, quiet: true }).catch((error) => {
          this.surfaceLaunchError(error);
        });
      } else if (this.chosenType === "regression" && this.chosenTarget) {
        void runProjectRegressionCommand(this.chosenTarget, { projectPath, emit, quiet: true }).catch((error) => {
          this.surfaceLaunchError(error);
        });
      } else if (this.chosenType === "bench" && this.chosenTarget) {
        void runProjectBenchCommand(this.chosenTarget, { projectPath, emit, quiet: true }).catch((error) => {
          this.surfaceLaunchError(error);
        });
      }
    } catch (error) {
      this.surfaceLaunchError(error);
    }
  }

  private surfaceLaunchError(error: unknown): void {
    this.launchStarted = false;
    const message = error instanceof Error ? error.message : "Launch failed";
    if (this.runStarted) {
      if (this.startedRunDir) {
        this.launchEmitter?.({
          type: "run_completed",
          timestamp: Date.now(),
          dir: this.startedRunDir,
          status: "crashed",
          durationMs: Math.max(0, Date.now() - this.startedAt),
        });
      }
      this.controller.setStatusLeft("Launch failed");
      this.controller.setStatusCenter(message);
      this.controller.setStatusRight("R refresh");
      this.controller.requestRender();
      return;
    }
    this.stage = "error";
    this.errorMessage = message;
    this.refreshStatus();
  }

  private openRunMonitor(event: Extract<EvalEvent, { type: "run_started" }>): void {
    const runsDir = event.runsDir ?? path.join(this.project.evalDir, "runs");
    this.controller.replace(
      new RunDetailScreen(this.controller, this.project, runEntryFromStarted(event), path.join(runsDir, event.dir), {
        followActiveRun: true,
        initialEvents: [event],
        runsDir,
        startOnTimeline: true,
      }),
    );
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

function renderBenchSublabel(bench: {
  profiles: string[];
  baseline?: string;
  epochs?: number;
  trialCount?: number;
}): string {
  const parts = [
    bench.profiles.length > 0 ? `${bench.profiles.length} profile(s)` : "model comparison",
    ...(bench.baseline ? [`baseline ${bench.baseline}`] : []),
    ...(bench.epochs !== undefined ? [`${bench.epochs} epoch(s)`] : []),
    ...(bench.trialCount !== undefined ? [`${bench.trialCount} trial(s)`] : []),
  ];
  return parts.join(" · ");
}
