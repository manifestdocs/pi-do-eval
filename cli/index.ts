#!/usr/bin/env bun
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  addOrUpdateProject,
  loadProjectRegistry,
  type RegisteredProject,
  removeProject,
  resolveProjectIdentifier,
  setActiveProject,
} from "../src/lib/server/projects.js";
import { runInit } from "./init.js";

const command = process.argv[2];
const args = process.argv.slice(3);
const packageDir = path.resolve(import.meta.dirname, "..");
const buildEntry = path.join(packageDir, "build", "index.js");

if (command === "init") {
  await runInit();
} else if (command === "ui" || command === "view") {
  const port = parseInt(readOption(args, "--port") ?? process.env.EVAL_PORT ?? "4242", 10);
  const explicitProject = readOption(args, "--project");

  if (explicitProject) {
    ensureProjectSelected(explicitProject, true);
  } else {
    ensureProjectSelected(process.cwd(), false);
  }

  await ensureBuild();
  startUiServer(port);
} else if (command === "ui-dev") {
  const port = parseInt(readOption(args, "--port") ?? process.env.EVAL_PORT ?? "4242", 10);
  const host = readOption(args, "--host") ?? process.env.HOST ?? "127.0.0.1";
  const explicitProject = readOption(args, "--project");

  if (explicitProject) {
    ensureProjectSelected(explicitProject, true);
  } else {
    ensureProjectSelected(process.cwd(), false);
  }

  startUiDevServer(host, port);
} else if (command === "project") {
  await handleProjectCommand(args);
} else {
  console.log("pi-do-eval");
  console.log("");
  console.log("Commands:");
  console.log("  init                     Scaffold an eval harness in the current directory");
  console.log("  ui [--project <path>]    Start the global eval viewer");
  console.log("  ui-dev [--project <path>] Start the global viewer in Vite dev mode");
  console.log("  view                     Alias for ui");
  console.log("  project add [path]       Add a project and make it active");
  console.log("  project list             List registered projects");
  console.log("  project use <id|path>    Select an existing project or add one by path");
  console.log("  project remove <id|path> Remove a registered project");
}

async function handleProjectCommand(projectArgs: string[]) {
  const subcommand = projectArgs[0];
  const identifier = projectArgs[1];

  if (subcommand === "add") {
    const project = ensureProjectSelected(identifier ?? process.cwd(), true);
    if (project) {
      printProject("Active project", project);
    }
    return;
  }

  if (subcommand === "list") {
    const registry = loadProjectRegistry();
    if (registry.projects.length === 0) {
      console.log("No projects registered.");
      return;
    }

    for (const project of registry.projects) {
      const marker = project.id === registry.activeProjectId ? "*" : " ";
      console.log(`${marker} ${project.name}  ${project.id}`);
      console.log(`  root: ${project.projectRoot}`);
      console.log(`  eval: ${project.evalDir}`);
    }
    return;
  }

  if (subcommand === "use") {
    const project = ensureProjectSelected(identifier ?? process.cwd(), true);
    if (project) {
      printProject("Active project", project);
    }
    return;
  }

  if (subcommand === "remove") {
    const activeProjectId = loadProjectRegistry().activeProjectId;
    const target =
      (identifier && resolveProjectIdentifier(identifier)) ||
      (activeProjectId ? resolveProjectIdentifier(activeProjectId) : null);

    if (!target) {
      console.error("No matching project found.");
      process.exit(1);
    }

    const { registry } = removeProject(target.id);
    console.log(`Removed ${target.name}`);
    if (registry.activeProjectId) {
      const active = registry.projects.find((project) => project.id === registry.activeProjectId);
      if (active) {
        printProject("Active project", active);
      }
    }
    return;
  }

  console.log("Usage:");
  console.log("  pi-do-eval project add [path]");
  console.log("  pi-do-eval project list");
  console.log("  pi-do-eval project use <id|path>");
  console.log("  pi-do-eval project remove <id|path>");
}

function ensureProjectSelected(identifier: string, strict: boolean): RegisteredProject | null {
  try {
    const existing = resolveProjectIdentifier(identifier);
    if (existing) {
      setActiveProject(existing.id);
      return existing;
    }

    return addOrUpdateProject(identifier).project;
  } catch (error) {
    if (!strict) {
      return null;
    }

    const message = error instanceof Error ? error.message : "Failed to resolve project";
    console.error(message);
    process.exit(1);
  }
}

async function ensureBuild() {
  if (fs.existsSync(buildEntry)) {
    return;
  }

  const build = spawn("bun", ["run", "build"], {
    cwd: packageDir,
    stdio: "inherit",
    env: { ...process.env },
  });
  const code = await new Promise<number | null>((resolve) => build.on("exit", resolve));
  if (code !== 0 || !fs.existsSync(buildEntry)) {
    process.exit(code ?? 1);
  }
}

function startUiServer(port: number) {
  const server = spawn("bun", [buildEntry], {
    cwd: packageDir,
    stdio: "inherit",
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
  });
  server.on("exit", (code) => process.exit(code ?? 0));
  console.log(`Eval viewer: http://localhost:${port}`);
}

function startUiDevServer(host: string, port: number) {
  const server = spawn("npm", ["run", "dev", "--", "--host", host, "--port", String(port)], {
    cwd: packageDir,
    stdio: "inherit",
    env: { ...process.env },
  });
  server.on("exit", (code) => process.exit(code ?? 0));
  console.log(`Eval viewer dev server: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
}

function readOption(values: string[], optionName: string): string | null {
  const index = values.indexOf(optionName);
  if (index === -1) return null;
  return values[index + 1] ?? null;
}

function printProject(label: string, project: { name: string; id: string; projectRoot: string; evalDir: string }) {
  console.log(`${label}: ${project.name} (${project.id})`);
  console.log(`  root: ${project.projectRoot}`);
  console.log(`  eval: ${project.evalDir}`);
}
