import { getRegisteredProject, listRegisteredProjects, type RegisteredProject } from "./projects.js";
import { type EventEmitter, RunsWatcher } from "./watcher.js";

export class ProjectWatcherCoordinator {
  private watchers = new Map<string, RunsWatcher>();

  syncProjects(projects: RegisteredProject[]): void {
    const activeIds = new Set(projects.map((project) => project.id));

    for (const project of projects) {
      if (!this.watchers.has(project.id)) {
        const watcher = new RunsWatcher(project.evalDir);
        watcher.start();
        this.watchers.set(project.id, watcher);
      }
    }

    for (const [projectId, watcher] of this.watchers) {
      if (!activeIds.has(projectId)) {
        watcher.stop();
        this.watchers.delete(projectId);
      }
    }
  }

  syncFromRegistry(): void {
    this.syncProjects(listRegisteredProjects());
  }

  subscribe(projectId: string, listener: EventEmitter): (() => void) | null {
    const watcher = this.getWatcher(projectId);
    return watcher ? watcher.subscribe(listener) : null;
  }

  getListenerCount(projectId: string): number {
    const watcher = this.watchers.get(projectId);
    return watcher?.getListenerCount() ?? 0;
  }

  stopAll(): void {
    for (const watcher of this.watchers.values()) {
      watcher.stop();
    }
    this.watchers.clear();
  }

  private getWatcher(projectId: string): RunsWatcher | null {
    const existing = this.watchers.get(projectId);
    if (existing) return existing;

    const project = getRegisteredProject(projectId);
    if (!project) return null;

    const watcher = new RunsWatcher(project.evalDir);
    watcher.start();
    this.watchers.set(projectId, watcher);
    return watcher;
  }
}
