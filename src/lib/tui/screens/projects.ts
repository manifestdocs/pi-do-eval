import { type Container, Spacer, Text } from "@mariozechner/pi-tui";
import { loadProjectRegistry, type RegisteredProject } from "$lib/server/projects.js";
import { ScrollableList } from "../components/scrollable-list.js";
import type { Screen, ScreenController } from "../screen.js";
import { theme } from "../theme.js";
import { ProjectHomeScreen } from "./home.js";

export class ProjectsScreen implements Screen {
  readonly id = "projects";
  focused = true;
  private list: ScrollableList<RegisteredProject>;
  private heading = new Text(`  ${theme.fg("text", theme.bold("Projects"))}`, 0, 0);
  private spacer = new Spacer(1);

  constructor(private controller: ScreenController) {
    this.list = new ScrollableList<RegisteredProject>({
      renderRow: (p, w) => {
        const name = theme.bold(p.name);
        const dirSeparator = " · ";
        const left = `${name}${theme.dim(dirSeparator)}${theme.fg("muted", p.evalDir)}`;
        // ScrollableList already handles pad/truncate.
        void w;
        return left;
      },
      onSelect: (project) => this.openProject(project),
      maxRows: this.controller.bodyMaxRows() - 3,
      emptyMessage: "No projects registered. Add one with `do-eval project add <path>`.",
    });
    this.refresh();
  }

  enter(): void {
    this.refresh();
    this.controller.clearProject();
    this.controller.setStatusLeft("Projects");
    this.controller.setStatusRight("↵ open · q quit");
  }

  invalidate(): void {
    this.list.invalidate();
  }

  handleInput(data: string): void {
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
    const registry = loadProjectRegistry();
    this.list.setItems(registry.projects);
  }

  private openProject(project: RegisteredProject): void {
    this.controller.setProject(project.name, project.evalDir);
    this.controller.replace(new ProjectHomeScreen(this.controller, project));
  }
}

/** Helper for app initialization to avoid an import cycle. */
export function installProjectsScreen(_body: Container, controller: ScreenController): ProjectsScreen {
  return new ProjectsScreen(controller);
}
