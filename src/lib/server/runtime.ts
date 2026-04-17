import type { LauncherConfig } from "$eval/types.js";
import { getRunCommandForEvalDir, loadLauncherConfigFromEvalDir } from "./harness.js";
import { getActiveProject, getRegisteredProject, type RegisteredProject } from "./projects.js";
import { ProjectWatcherCoordinator } from "./watchers.js";

export interface ProjectRuntime {
  project: RegisteredProject;
  launcherConfig: LauncherConfig | null;
  runCommand: string;
  runsDir: string;
}

export const projectWatchers = new ProjectWatcherCoordinator();

export async function getProjectRuntime(projectId: string): Promise<ProjectRuntime | null> {
  const project = getRegisteredProject(projectId);
  if (!project) return null;

  return {
    project,
    launcherConfig: await loadLauncherConfigFromEvalDir(project.evalDir),
    runCommand: getRunCommandForEvalDir(),
    runsDir: project.evalDir,
  };
}

export async function getActiveProjectRuntime(): Promise<ProjectRuntime | null> {
  const project = getActiveProject();
  return project ? getProjectRuntime(project.id) : null;
}
