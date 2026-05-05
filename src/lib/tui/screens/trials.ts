import { Container, Key, matchesKey, Spacer, Text } from "@mariozechner/pi-tui";
import { listTrialNames, loadTrialManifest, readTrialManifest, writeTrialManifest } from "$eval/trial-manifest.js";
import type { TrialManifest } from "$eval/types.js";
import type { RegisteredProject } from "$lib/server/projects.js";
import { ScrollableList } from "../components/scrollable-list.js";
import type { Screen, ScreenController } from "../screen.js";
import { theme } from "../theme.js";
import { LauncherScreen } from "./launcher.js";
import { RunsScreen } from "./runs.js";
import { SuitesScreen } from "./suites.js";

interface TrialRow {
  name: string;
  manifest: TrialManifest;
}

export class TrialsScreen implements Screen {
  readonly id = "trials";
  focused = true;
  private heading = new Text(`  ${theme.bold("Trials")}`, 0, 0);
  private spacer = new Spacer(1);
  private body = new Container();
  private list: ScrollableList<TrialRow>;
  private notice: string | null = null;

  constructor(
    private controller: ScreenController,
    private project: RegisteredProject,
  ) {
    this.list = new ScrollableList<TrialRow>({
      renderRow: (row) => renderTrialRow(row),
      onSelect: () => {
        // No-op for now; future: open trial-detail (variants, scaffold info).
      },
      maxRows: this.controller.bodyMaxRows() - 4,
      emptyMessage: "(no trials yet — define trial.yaml under eval/trials/<name>/)",
    });
    this.refresh();
  }

  enter(): void {
    this.refresh();
    this.controller.setStatusLeft(`Trials · ${this.project.name}`);
    this.controller.setStatusRight("t toggle · r run · c runs · s suites · esc home");
  }

  invalidate(): void {
    this.body.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.controller.pop();
      return;
    }
    if (matchesKey(data, "c")) {
      this.controller.replace(new RunsScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, "s")) {
      this.controller.replace(new SuitesScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, "r")) {
      this.controller.push(new LauncherScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, "t")) {
      this.toggleEnabled();
      return;
    }
    if (matchesKey(data, Key.shift("r"))) {
      this.refresh();
      this.controller.requestRender();
      return;
    }
    this.list.focused = true;
    this.list.handleInput(data);
    this.controller.requestRender();
  }

  render(width: number): string[] {
    this.list.focused = this.focused;
    this.list.setMaxRows(Math.max(3, this.controller.bodyMaxRows() - 4));
    this.body.clear();
    if (this.notice) {
      this.body.addChild(new Text(`  ${theme.fg("muted", this.notice)}`, 0, 0));
      this.body.addChild(new Spacer(1));
    }
    this.body.addChild(this.list);
    return [...this.heading.render(width), ...this.spacer.render(width), ...this.body.render(width)];
  }

  private refresh(): void {
    try {
      const names = listTrialNames(this.project.evalDir);
      const rows: TrialRow[] = [];
      for (const name of names) {
        const manifest = loadTrialManifest(this.project.evalDir, name);
        if (manifest) rows.push({ name, manifest });
      }
      this.list.setItems(rows);
      this.notice = null;
    } catch (error) {
      this.notice = error instanceof Error ? error.message : "Failed to load trials";
      this.list.setItems([]);
    }
  }

  private toggleEnabled(): void {
    const row = this.list.getSelected();
    if (!row) return;
    try {
      const current = readTrialManifest(this.project.evalDir, row.name);
      const next: TrialManifest = { ...current, enabled: current.enabled === false };
      writeTrialManifest(this.project.evalDir, row.name, next);
      this.notice = `${row.name}: ${next.enabled === false ? "disabled" : "enabled"}`;
      this.refresh();
      this.controller.requestRender();
    } catch (error) {
      this.notice = error instanceof Error ? error.message : "Toggle failed";
      this.controller.requestRender();
    }
  }
}

function renderTrialRow(row: TrialRow): string {
  const name = theme.bold(row.name);
  const status = row.manifest.enabled === false ? theme.fg("warning", "[off]") : theme.fg("success", "[on]");
  const variants = theme.dim(`${Object.keys(row.manifest.variants).length}v`);
  const tags = row.manifest.tags?.length ? theme.fg("muted", `· ${row.manifest.tags.join(", ")}`) : "";
  const desc = row.manifest.description ? theme.dim(`· ${row.manifest.description}`) : "";
  return `${status}  ${name}  ${variants}  ${tags} ${desc}`.trim();
}
