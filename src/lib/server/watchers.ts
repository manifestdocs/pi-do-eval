import { resolveRunsDirFromEvalDir } from "./harness.js";
import { getRegisteredProject, listRegisteredProjects, type RegisteredProject } from "./projects.js";
import { type EventEmitter, RunsWatcher } from "./watcher.js";

export class ProjectWatcherCoordinator {
  private watchers = new Map<string, { runsDir: string; watcher: RunsWatcher }>();

  async syncProjects(projects: RegisteredProject[]): Promise<void> {
    const activeIds = new Set(projects.map((project) => project.id));

    for (const project of projects) {
      let runsDir: string;
      try {
        runsDir = await resolveRunsDirFromEvalDir(project.evalDir);
      } catch {
        continue;
      }
      const existing = this.watchers.get(project.id);
      if (!existing || existing.runsDir !== runsDir) {
        existing?.watcher.stop();
        const watcher = new RunsWatcher(runsDir);
        watcher.start();
        this.watchers.set(project.id, { runsDir, watcher });
      }
    }

    for (const [projectId, entry] of this.watchers) {
      if (!activeIds.has(projectId)) {
        entry.watcher.stop();
        this.watchers.delete(projectId);
      }
    }
  }

  async syncFromRegistry(): Promise<void> {
    await this.syncProjects(listRegisteredProjects());
  }

  async subscribe(projectId: string, listener: EventEmitter): Promise<(() => void) | null> {
    const entry = await this.getWatcher(projectId);
    return entry ? entry.watcher.subscribe(listener) : null;
  }

  getListenerCount(projectId: string): number {
    const entry = this.watchers.get(projectId);
    return entry?.watcher.getListenerCount() ?? 0;
  }

  stopAll(): void {
    for (const entry of this.watchers.values()) {
      entry.watcher.stop();
    }
    this.watchers.clear();
  }

  private async getWatcher(projectId: string): Promise<{ runsDir: string; watcher: RunsWatcher } | null> {
    const existing = this.watchers.get(projectId);
    if (existing) return existing;

    const project = getRegisteredProject(projectId);
    if (!project) return null;

    const runsDir = await resolveRunsDirFromEvalDir(project.evalDir);
    const watcher = new RunsWatcher(runsDir);
    watcher.start();
    const entry = { runsDir, watcher };
    this.watchers.set(projectId, entry);
    return entry;
  }
}
