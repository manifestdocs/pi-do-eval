#!/usr/bin/env bun
import * as path from "node:path";
import { stringify } from "yaml";
import { suiteDefinitionCodec } from "../src/lib/contracts/domain.js";
import {
  runProjectBenchCommand,
  runProjectList,
  runProjectRegressionCommand,
  runProjectTrialCommand,
} from "../src/lib/eval/project-runner.js";
import {
  loadFileSuites,
  type SuiteDefinition,
  validateSuiteName,
  writeFileSuite,
} from "../src/lib/eval/suite-files.js";
import { loadLauncherConfigFromEvalDir } from "../src/lib/server/harness.js";
import {
  addOrUpdateProject,
  loadProjectRegistry,
  type RegisteredProject,
  removeProject,
  resolveProjectIdentifier,
  resolveProjectPath,
  setActiveProject,
} from "../src/lib/server/projects.js";
import { runInit } from "./init.js";
import { runTuiCommand } from "./tui.js";
import { ensureBuild, startUiDevServerForeground, startUiServerForeground } from "./web.js";

const command = process.argv[2];
const args = process.argv.slice(3);
if (command === "init") {
  await runInit();
} else if (command === "tui") {
  await runTuiCommand(args);
} else if (command === "ui" || command === "view") {
  const port = parseInt(readOption(args, "--port") ?? process.env.EVAL_PORT ?? "4242", 10);
  const explicitProject = readOption(args, "--project");

  if (explicitProject) {
    ensureProjectSelected(explicitProject, true);
  } else {
    ensureProjectSelected(process.cwd(), false);
  }

  try {
    await ensureBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to build web viewer");
    process.exit(1);
  }
  startUiServerForeground(port);
} else if (command === "ui-dev") {
  const port = parseInt(readOption(args, "--port") ?? process.env.EVAL_PORT ?? "4242", 10);
  const host = readOption(args, "--host") ?? process.env.HOST ?? "127.0.0.1";
  const explicitProject = readOption(args, "--project");

  if (explicitProject) {
    ensureProjectSelected(explicitProject, true);
  } else {
    ensureProjectSelected(process.cwd(), false);
  }

  startUiDevServerForeground(host, port);
} else if (command === "project") {
  await handleProjectCommand(args);
} else if (command === "list") {
  await handleRunCommand("list", args);
} else if (command === "trial") {
  await handleRunCommand("trial", args);
} else if (command === "regression") {
  await handleRunCommand("regression", args);
} else if (command === "bench") {
  await handleRunCommand("bench", args);
} else if (command === "suite") {
  await handleSuiteCommand(args);
} else {
  console.log("do-eval");
  console.log("");
  console.log("Commands:");
  console.log("  init                     Scaffold an eval harness in the current directory");
  console.log("  tui [--project <path>] [--port <port>] [--no-web] Start launcher/current-state TUI");
  console.log("  ui [--project <path>] [--port <port>] Start the global eval viewer (web, deprecated; prefer tui)");
  console.log("  ui-dev [--project <path>] [--port <port>] Start the global viewer in Vite dev mode");
  console.log("  view                     Alias for ui");
  console.log("  list [--project <path>]  List trials, suites, profiles, and benches");
  console.log("  trial <trial>            Run one trial");
  console.log("  regression <suite>       Run one profile over a suite");
  console.log("  bench <suite>            Compare configured profiles for a suite");
  console.log("  project add [path]       Add a project and make it active");
  console.log("  project list             List registered projects");
  console.log("  project use <id|path>    Select an existing project or add one by path");
  console.log("  project remove <id|path> Remove a registered project");
  console.log("  suite list               List file-backed suites");
  console.log("  suite show <name>        Show a suite definition");
  console.log("  suite create <name> <trial[:variant]>...");
  console.log("  suite add <name> <trial[:variant]>...");
  console.log("  suite remove <name> <trial[:variant]>...");
}

interface RunCliOptions {
  projectPath?: string;
  profile?: string;
  variant?: string;
  noJudge?: boolean;
  model?: string;
  provider?: string;
  positionals: string[];
}

async function handleRunCommand(runCommand: "list" | "trial" | "regression" | "bench", runArgs: string[]) {
  const options = parseRunOptions(runArgs);
  try {
    if (runCommand === "list") {
      await runProjectList({ projectPath: options.projectPath });
      return;
    }

    const target = options.positionals[0];
    if (!target) return printRunUsage(runCommand);
    if (runCommand === "trial") {
      await runProjectTrialCommand(target, {
        projectPath: options.projectPath,
        profile: options.profile,
        variant: options.variant ?? "default",
        noJudge: options.noJudge,
        model: options.model,
        provider: options.provider,
      });
      return;
    }
    if (runCommand === "regression") {
      await runProjectRegressionCommand(target, {
        projectPath: options.projectPath,
        profile: options.profile,
        noJudge: options.noJudge,
        model: options.model,
        provider: options.provider,
      });
      return;
    }
    await runProjectBenchCommand(target, {
      projectPath: options.projectPath,
      noJudge: options.noJudge,
    });
  } catch (error) {
    failCli(error instanceof Error ? error.message : `${runCommand} failed`);
  }
}

function parseRunOptions(values: string[]): RunCliOptions {
  const options: RunCliOptions = { positionals: [] };
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === "--project") options.projectPath = requireOptionValue(values, ++i, "--project");
    else if (value === "--profile") options.profile = requireOptionValue(values, ++i, "--profile");
    else if (value === "--variant") options.variant = requireOptionValue(values, ++i, "--variant");
    else if (value === "--model") options.model = requireOptionValue(values, ++i, "--model");
    else if (value === "--provider") options.provider = requireOptionValue(values, ++i, "--provider");
    else if (value === "--no-judge") options.noJudge = true;
    else if (value?.startsWith("--")) failCli(`Unknown ${value}`);
    else if (value) options.positionals.push(value);
  }
  return options;
}

function printRunUsage(runCommand: "list" | "trial" | "regression" | "bench"): void {
  console.log("Usage:");
  if (runCommand === "list") console.log("  do-eval list [--project <path>]");
  if (runCommand === "trial") {
    console.log("  do-eval trial <trial> [--variant <variant>] [--profile <profile>] [--no-judge] [--project <path>]");
  }
  if (runCommand === "regression") {
    console.log("  do-eval regression <suite> [--profile <profile>] [--no-judge] [--project <path>]");
  }
  if (runCommand === "bench") console.log("  do-eval bench <suite> [--no-judge] [--project <path>]");
}

async function handleSuiteCommand(suiteArgs: string[]) {
  const subcommand = suiteArgs[0];
  const options = parseSuiteOptions(suiteArgs.slice(1));

  try {
    const project = resolveSuiteProject(options.projectPath);
    if (subcommand === "list") {
      const suites = loadFileSuites(project.evalDir);
      if (suites.length === 0) {
        console.log("No suites defined.");
        return;
      }
      for (const suite of suites) {
        console.log(`${suite.name} (${suite.trials.length})`);
      }
      return;
    }

    const suiteName = options.positionals[0];
    if (!suiteName) return printSuiteUsage();
    validateSuiteName(suiteName);

    if (subcommand === "show") {
      const suite = findSuite(project.evalDir, suiteName);
      if (!suite) failCli(`Suite "${suiteName}" does not exist`);
      console.log(stringify(suiteDefinitionCodec.serialize(suite)));
      return;
    }

    if (subcommand === "create") {
      const refs = parseSuiteRefs(options.positionals.slice(1));
      if (refs.length === 0) failCli("suite create requires at least one trial reference");
      if (findSuite(project.evalDir, suiteName) && !options.force) {
        failCli(`Suite "${suiteName}" already exists; pass --force to replace it`);
      }
      await validateSuiteRefs(project.evalDir, refs);
      const suite: SuiteDefinition = {
        name: suiteName,
        ...(options.description ? { description: options.description } : {}),
        trials: refs,
        ...(options.threshold !== undefined ? { regressionThreshold: options.threshold } : {}),
      };
      writeFileSuite(project.evalDir, suite);
      console.log(`Wrote ${suitePath(project.evalDir, suiteName)}`);
      return;
    }

    if (subcommand === "add") {
      const suite = findSuite(project.evalDir, suiteName);
      if (!suite) failCli(`Suite "${suiteName}" does not exist`);
      const refs = parseSuiteRefs(options.positionals.slice(1));
      if (refs.length === 0) failCli("suite add requires at least one trial reference");
      await validateSuiteRefs(project.evalDir, refs);
      const next = { ...suite, trials: [...suite.trials, ...refs] };
      writeFileSuite(project.evalDir, next);
      console.log(`Wrote ${suitePath(project.evalDir, suiteName)}`);
      return;
    }

    if (subcommand === "remove") {
      const suite = findSuite(project.evalDir, suiteName);
      if (!suite) failCli(`Suite "${suiteName}" does not exist`);
      const refs = parseSuiteRefs(options.positionals.slice(1));
      if (refs.length === 0) failCli("suite remove requires at least one trial reference");
      const removeKeys = new Set(refs.map(suiteRefKey));
      const nextTrials = suite.trials.filter((entry) => !removeKeys.has(suiteRefKey(entry)));
      if (nextTrials.length === suite.trials.length) failCli("No matching trial references found");
      writeFileSuite(project.evalDir, { ...suite, trials: nextTrials });
      console.log(`Wrote ${suitePath(project.evalDir, suiteName)}`);
      return;
    }

    printSuiteUsage();
  } catch (error) {
    failCli(error instanceof Error ? error.message : "Suite command failed");
  }
}

interface SuiteCliOptions {
  projectPath?: string;
  description?: string;
  threshold?: number;
  force: boolean;
  positionals: string[];
}

function parseSuiteOptions(values: string[]): SuiteCliOptions {
  const options: SuiteCliOptions = { force: false, positionals: [] };
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === "--project") options.projectPath = requireOptionValue(values, ++i, "--project");
    else if (value === "--description") options.description = requireOptionValue(values, ++i, "--description");
    else if (value === "--threshold") {
      const raw = requireOptionValue(values, ++i, "--threshold");
      const threshold = Number(raw);
      if (!Number.isFinite(threshold)) failCli("--threshold must be a number");
      options.threshold = threshold;
    } else if (value === "--force") options.force = true;
    else if (value?.startsWith("--")) failCli(`Unknown suite option: ${value}`);
    else if (value) options.positionals.push(value);
  }
  return options;
}

function requireOptionValue(values: string[], index: number, optionName: string): string {
  const value = values[index];
  if (!value || value.startsWith("--")) failCli(`${optionName} requires a value`);
  return value;
}

function resolveSuiteProject(projectPath?: string) {
  return resolveProjectPath(projectPath ?? process.cwd());
}

function parseSuiteRefs(values: string[]): Array<{ trial: string; variant: string }> {
  return values.map((value) => {
    const [trial, variant = "default", extra] = value.split(":");
    if (!trial || extra !== undefined) failCli(`Invalid trial reference: ${value}`);
    return { trial, variant };
  });
}

async function validateSuiteRefs(evalDir: string, refs: Array<{ trial: string; variant: string }>): Promise<void> {
  const config = await loadLauncherConfigFromEvalDir(evalDir);
  if (!config) failCli(`Could not load eval project at ${evalDir}`);
  const trialVariants = new Map(config.trials.map((trial) => [trial.name, new Set(trial.variants)]));
  for (const ref of refs) {
    const variants = trialVariants.get(ref.trial);
    if (!variants) failCli(`Unknown trial: ${ref.trial}`);
    if (!variants.has(ref.variant)) {
      const available = [...variants].join(", ") || "none";
      failCli(`Unknown variant "${ref.variant}" for trial "${ref.trial}". Available: ${available}`);
    }
  }
}

function findSuite(evalDir: string, name: string): SuiteDefinition | undefined {
  return loadFileSuites(evalDir).find((suite) => suite.name === name);
}

function suiteRefKey(ref: { trial: string; variant: string }): string {
  return `${ref.trial}:${ref.variant}`;
}

function suitePath(evalDir: string, name: string): string {
  return path.join(evalDir, "suites", `${name}.yaml`);
}

function printSuiteUsage(): void {
  console.log("Usage:");
  console.log("  do-eval suite list [--project <path>]");
  console.log("  do-eval suite show <name> [--project <path>]");
  console.log(
    "  do-eval suite create <name> <trial[:variant]>... [--description <text>] [--threshold <number>] [--force] [--project <path>]",
  );
  console.log("  do-eval suite add <name> <trial[:variant]>... [--project <path>]");
  console.log("  do-eval suite remove <name> <trial[:variant]>... [--project <path>]");
}

function failCli(message: string): never {
  console.error(message);
  process.exit(1);
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
  console.log("  do-eval project add [path]");
  console.log("  do-eval project list");
  console.log("  do-eval project use <id|path>");
  console.log("  do-eval project remove <id|path>");
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
