import { killActiveRun } from "./launcher.js";
import { listRegisteredProjects } from "./projects.js";
import { projectWatchers } from "./runtime.js";

interface ShutdownDeps {
  listProjectIds?: () => string[];
  killActiveRun?: typeof killActiveRun;
  stopAll?: () => void;
  forceKillDelayMs?: number;
}

export function createShutdownController(deps: ShutdownDeps = {}) {
  let shutdownPromise: Promise<void> | null = null;
  const listProjectIds = deps.listProjectIds ?? (() => listRegisteredProjects().map((project) => project.id));
  const stopAll = deps.stopAll ?? (() => projectWatchers.stopAll());
  const killRun = deps.killActiveRun ?? killActiveRun;
  const forceKillDelayMs = deps.forceKillDelayMs ?? 5000;

  return {
    shutdown(_signal?: NodeJS.Signals): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = Promise.resolve().then(() => {
        for (const projectId of listProjectIds()) {
          killRun(projectId, { forceAfterMs: forceKillDelayMs });
        }
        stopAll();
      });
      return shutdownPromise;
    },
  };
}

let registered = false;

export function registerShutdownHandlers(): void {
  if (registered) return;
  registered = true;

  const controller = createShutdownController();
  const handler = (signal: NodeJS.Signals) => {
    void controller.shutdown(signal);
  };

  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
}
