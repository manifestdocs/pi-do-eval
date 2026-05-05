import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Container, Key, matchesKey, Spacer, Text } from "@mariozechner/pi-tui";
import { deleteFileSuite, loadFileSuites, type SuiteDefinition, validateSuiteName } from "$eval/suite-files.js";
import type { SuiteIndexEntry } from "$eval/types.js";
import type { RegisteredProject } from "$lib/server/projects.js";
import { ScrollableList } from "../components/scrollable-list.js";
import { sparkline } from "../components/sparkline.js";
import type { Screen, ScreenController } from "../screen.js";
import { theme } from "../theme.js";
import { LauncherScreen } from "./launcher.js";
import { RunsScreen } from "./runs.js";
import { TrialsScreen } from "./trials.js";

interface SuiteRow {
  def: SuiteDefinition;
  history: number[];
  latest?: number;
}

const NEW_SUITE_TEMPLATE = `name: REPLACE_NAME
description: ""
trials:
  - example
`;
const SUITES_STATUS = "n new suite · r run · c runs · e edit · d delete · t trials · esc home";

export class SuitesScreen implements Screen {
  readonly id = "suites";
  focused = true;
  private heading = new Text(`  ${theme.bold("Suites")}`, 0, 0);
  private spacer = new Spacer(1);
  private body = new Container();
  private list: ScrollableList<SuiteRow>;
  private notice: string | null = null;
  private pendingDeleteSuite: string | null = null;

  constructor(
    private controller: ScreenController,
    private project: RegisteredProject,
  ) {
    this.list = new ScrollableList<SuiteRow>({
      renderRow: (row) => renderSuiteRow(row),
      onSelect: () => {
        // No-op for now; future SuiteOverviewScreen could be pushed here.
      },
      maxRows: this.controller.bodyMaxRows() - 4,
      emptyMessage: "(no suites yet — press n to create one)",
    });
    this.refresh();
  }

  enter(): void {
    this.refresh();
    this.controller.setStatusLeft(`Suites · ${this.project.name}`);
    this.controller.setStatusRight(SUITES_STATUS);
  }

  invalidate(): void {
    this.body.invalidate();
  }

  handleInput(data: string): void {
    if (this.pendingDeleteSuite && !matchesKey(data, "d")) {
      this.pendingDeleteSuite = null;
      this.notice = null;
      this.controller.setStatusRight(SUITES_STATUS);
    }
    if (matchesKey(data, Key.escape)) {
      this.controller.pop();
      return;
    }
    if (matchesKey(data, "r")) {
      this.controller.push(new LauncherScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, "c")) {
      this.controller.replace(new RunsScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, "t")) {
      this.controller.replace(new TrialsScreen(this.controller, this.project));
      return;
    }
    if (matchesKey(data, "n")) {
      void this.createSuite();
      return;
    }
    if (matchesKey(data, "e")) {
      void this.editSuite();
      return;
    }
    if (matchesKey(data, "d")) {
      void this.deleteSuite();
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
    let suites: SuiteDefinition[] = [];
    try {
      suites = loadFileSuites(this.project.evalDir);
    } catch (error) {
      this.notice = error instanceof Error ? error.message : "Failed to load suites";
      this.list.setItems([]);
      return;
    }
    this.notice = null;
    const indexEntries = readSuiteIndex(this.project.evalDir);
    const rows = suites.map((def) => {
      const history = indexEntries
        .filter((e) => e.suite === def.name)
        .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
        .map((e) => e.averageOverall);
      const latest = history[history.length - 1];
      const row: SuiteRow = { def, history };
      if (latest !== undefined) row.latest = latest;
      return row;
    });
    this.list.setItems(rows);
  }

  private suitePath(name: string): string {
    return path.join(this.project.evalDir, "suites", `${name}.yaml`);
  }

  private async createSuite(): Promise<void> {
    const name = `suite-${Date.now()}`;
    const dir = path.join(this.project.evalDir, "suites");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${name}.yaml`);
    fs.writeFileSync(filePath, NEW_SUITE_TEMPLATE.replace("REPLACE_NAME", name));
    await runEditor(filePath);
    // Validate file name still matches; if user changed it, reload anyway.
    this.refresh();
    this.controller.requestRender();
  }

  private async editSuite(): Promise<void> {
    const row = this.list.getSelected();
    if (!row) return;
    await runEditor(this.suitePath(row.def.name));
    this.refresh();
    this.controller.requestRender();
  }

  private async deleteSuite(): Promise<void> {
    const row = this.list.getSelected();
    if (!row) return;
    if (this.pendingDeleteSuite !== row.def.name) {
      this.pendingDeleteSuite = row.def.name;
      this.notice = `Press d again to delete suite "${row.def.name}"`;
      this.controller.setStatusRight("d confirm delete · any other key cancel");
      this.controller.requestRender();
      return;
    }
    try {
      validateSuiteName(row.def.name);
      deleteFileSuite(this.project.evalDir, row.def.name);
      this.refresh();
      this.notice = `Deleted suite "${row.def.name}"`;
    } catch (error) {
      this.notice = error instanceof Error ? error.message : "Delete failed";
    }
    this.pendingDeleteSuite = null;
    this.controller.setStatusRight(SUITES_STATUS);
    this.controller.requestRender();
  }
}

function renderSuiteRow(row: SuiteRow): string {
  const name = theme.bold(row.def.name);
  const score = row.latest !== undefined ? formatScore(row.latest) : theme.dim("—");
  const trend = sparkline(row.history.slice(-12));
  const trials = theme.dim(`${row.def.trials.length} trial(s)`);
  return `${name}  ${score}  ${trend}  ${trials}`;
}

function formatScore(value: number): string {
  const text = value.toFixed(1).padStart(5, " ");
  if (value >= 80) return theme.fg("scoreGood", text);
  if (value >= 60) return theme.fg("scoreOk", text);
  return theme.fg("scoreBad", text);
}

function readSuiteIndex(evalDir: string): SuiteIndexEntry[] {
  const indexPath = path.join(evalDir, "runs", "suite-index.json");
  if (!fs.existsSync(indexPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(indexPath, "utf-8")) as SuiteIndexEntry[];
  } catch {
    return [];
  }
}

async function runEditor(filePath: string): Promise<void> {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
  return new Promise<void>((resolve) => {
    const child = spawn(editor, [filePath], { stdio: "inherit" });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}
