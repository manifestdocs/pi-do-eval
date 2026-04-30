import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseJsonWith } from "$lib/contracts/codec.js";
import { projectRegistryCodec } from "$lib/contracts/domain.js";

export interface RegisteredProject {
  id: string;
  name: string;
  projectRoot: string;
  evalDir: string;
  addedAt: string;
  updatedAt: string;
  lastSelectedAt: string;
}

export interface ProjectRegistry {
  activeProjectId: string | null;
  projects: RegisteredProject[];
}

export interface ResolvedProjectPath {
  name: string;
  projectRoot: string;
  evalDir: string;
}

const REGISTRY_FILE = "projects.json";

export function getProjectRegistryPath(): string {
  const configHome =
    process.env.PI_DO_EVAL_CONFIG_HOME ?? process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "pi-do-eval", REGISTRY_FILE);
}

export function loadProjectRegistry(): ProjectRegistry {
  const registryPath = getProjectRegistryPath();
  if (!fs.existsSync(registryPath)) {
    return { activeProjectId: null, projects: [] };
  }

  try {
    const parsed = parseJsonWith(fs.readFileSync(registryPath, "utf-8"), registryPath, projectRegistryCodec);
    return parsed.ok ? parsed.value : { activeProjectId: null, projects: [] };
  } catch {
    return { activeProjectId: null, projects: [] };
  }
}

export function saveProjectRegistry(registry: ProjectRegistry): void {
  const registryPath = getProjectRegistryPath();
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });

  const normalized = projectRegistryCodec.serialize(registry);

  const tempPath = `${registryPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(normalized, null, 2));
  fs.renameSync(tempPath, registryPath);
}

export function listRegisteredProjects(): RegisteredProject[] {
  return loadProjectRegistry().projects;
}

export function getRegisteredProject(projectId: string): RegisteredProject | null {
  return loadProjectRegistry().projects.find((project) => project.id === projectId) ?? null;
}

export function getActiveProject(): RegisteredProject | null {
  const registry = loadProjectRegistry();
  if (!registry.activeProjectId) return null;
  return registry.projects.find((project) => project.id === registry.activeProjectId) ?? null;
}

export function resolveProjectPath(inputPath: string): ResolvedProjectPath {
  const expandedPath = expandInputPath(inputPath);
  const resolvedPath = path.resolve(expandedPath);
  const evalDir = findEvalDir(resolvedPath);

  if (!evalDir) {
    throw new Error(`Could not find an eval project at ${inputPath}`);
  }

  const realEvalDir = fs.realpathSync(evalDir);
  const projectRoot =
    path.basename(realEvalDir) === "eval"
      ? fs.realpathSync(path.dirname(realEvalDir))
      : fs.realpathSync(path.dirname(realEvalDir));

  return {
    name: path.basename(projectRoot),
    projectRoot,
    evalDir: realEvalDir,
  };
}

export function addOrUpdateProject(inputPath: string): { registry: ProjectRegistry; project: RegisteredProject } {
  const resolved = resolveProjectPath(inputPath);
  const registry = loadProjectRegistry();
  const now = new Date().toISOString();
  const id = createProjectId(resolved.evalDir);
  const existing = registry.projects.find((project) => project.id === id || project.evalDir === resolved.evalDir);

  const project: RegisteredProject = existing
    ? {
        ...existing,
        name: resolved.name,
        projectRoot: resolved.projectRoot,
        evalDir: resolved.evalDir,
        updatedAt: now,
        lastSelectedAt: now,
      }
    : {
        id,
        name: resolved.name,
        projectRoot: resolved.projectRoot,
        evalDir: resolved.evalDir,
        addedAt: now,
        updatedAt: now,
        lastSelectedAt: now,
      };

  registry.projects = [project, ...registry.projects.filter((entry) => entry.id !== project.id)];
  registry.activeProjectId = project.id;
  saveProjectRegistry(registry);
  return { registry: loadProjectRegistry(), project };
}

export function setActiveProject(projectId: string): { registry: ProjectRegistry; project: RegisteredProject } {
  const registry = loadProjectRegistry();
  const now = new Date().toISOString();
  const project = registry.projects.find((entry) => entry.id === projectId);
  if (!project) {
    throw new Error(`Unknown project: ${projectId}`);
  }

  project.lastSelectedAt = now;
  project.updatedAt = now;
  registry.activeProjectId = project.id;
  saveProjectRegistry(registry);
  return { registry: loadProjectRegistry(), project };
}

export function removeProject(projectId: string): { registry: ProjectRegistry; removedProjectId: string } {
  const registry = loadProjectRegistry();
  const existing = registry.projects.find((project) => project.id === projectId);
  if (!existing) {
    throw new Error(`Unknown project: ${projectId}`);
  }

  registry.projects = registry.projects.filter((project) => project.id !== projectId);
  if (registry.activeProjectId === projectId) {
    registry.activeProjectId = registry.projects[0]?.id ?? null;
  }
  saveProjectRegistry(registry);
  return { registry: loadProjectRegistry(), removedProjectId: projectId };
}

export function resolveProjectIdentifier(identifier: string): RegisteredProject | null {
  const registry = loadProjectRegistry();
  const byId = registry.projects.find((project) => project.id === identifier);
  if (byId) return byId;

  const expanded = expandInputPath(identifier);
  const resolved = path.resolve(expanded);
  return (
    registry.projects.find(
      (project) =>
        project.projectRoot === resolved ||
        project.evalDir === resolved ||
        project.projectRoot === safeRealPath(resolved) ||
        project.evalDir === safeRealPath(resolved),
    ) ?? null
  );
}

function findEvalDir(candidatePath: string): string | null {
  if (!fs.existsSync(candidatePath)) return null;

  if (isEvalDirectory(candidatePath)) {
    return candidatePath;
  }

  const conventionalEvalDir = path.join(candidatePath, "eval");
  if (isEvalDirectory(conventionalEvalDir)) {
    return conventionalEvalDir;
  }

  return null;
}

function isEvalDirectory(candidatePath: string): boolean {
  return (
    fs.existsSync(candidatePath) &&
    fs.statSync(candidatePath).isDirectory() &&
    fs.existsSync(path.join(candidatePath, "eval.ts"))
  );
}

function createProjectId(evalDir: string): string {
  return createHash("sha1").update(evalDir).digest("hex").slice(0, 12);
}

function expandInputPath(inputPath: string): string {
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function safeRealPath(candidatePath: string): string | null {
  try {
    return fs.realpathSync(candidatePath);
  } catch {
    return null;
  }
}
