import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { loadFileSuites, mergeSuiteSources } from "$eval/suite-files.js";
import { loadTrialMeta } from "$eval/trial-meta.js";
import type { LauncherConfig, LauncherSuiteDef } from "$eval/types.js";

interface TrialConfigModule {
  default?: {
    description?: string;
    variants?: Record<string, unknown>;
  };
}

interface EvalConfigModule {
  default?: {
    runSets?: Record<string, Array<{ trial: string; variant: string }>>;
    suites?: Record<string, Array<{ trial: string; variant: string }>>;
    models?: Array<{ provider?: string; model?: string }>;
    worker?: { provider?: string; model?: string };
    judge?: { provider?: string; model?: string };
    timeouts?: { workerMs?: number; inactivityMs?: number; judgeMs?: number };
    epochs?: number;
    budgets?: Record<string, number | undefined>;
    regressions?: { threshold?: number };
  };
}

const require = createRequire(import.meta.url);
const IMPORT_DEFAULT_SCRIPT =
  "const mod = await import(process.argv[1]); process.stdout.write(JSON.stringify(mod.default ?? null));";
const moduleCache = new Map<string, { mtimeMs: number; value: unknown }>();

export async function loadLauncherConfigFromEvalDir(evalDir: string): Promise<LauncherConfig | null> {
  const trialsDir = path.join(evalDir, "trials");
  if (!fs.existsSync(trialsDir)) return null;

  const trialNames = listTrials(trialsDir);
  const trials = await Promise.all(
    trialNames.map(async (trialName) => {
      const config = await loadTrialConfig(evalDir, trialName);
      const meta = loadTrialMeta(evalDir, trialName);
      return {
        name: trialName,
        description: meta?.description ?? config?.description ?? "",
        variants: Object.keys(config?.variants ?? {}),
        ...(meta?.tags ? { tags: meta.tags } : {}),
        enabled: meta?.enabled ?? true,
      };
    }),
  );

  const evalConfig = await loadEvalConfig(evalDir);
  const configuredSuites = {
    ...(evalConfig?.runSets ?? {}),
    ...(evalConfig?.suites ?? {}),
  };
  const fileSuites = loadFileSuites(evalDir);
  const mergedSuites = mergeSuiteSources(configuredSuites, fileSuites);

  const fileSuiteNames = new Set(fileSuites.map((suite) => suite.name));
  const suiteDefs: LauncherSuiteDef[] = Object.entries(mergedSuites).map(
    ([suiteName, entries]) => {
      const fileSuite = fileSuites.find((suite) => suite.name === suiteName);
      const source = fileSuiteNames.has(suiteName) ? "file" : "config";
      return {
        name: suiteName,
        ...(fileSuite?.description ? { description: fileSuite.description } : {}),
        trials: entries,
        ...(fileSuite?.regressionThreshold !== undefined
          ? { regressionThreshold: fileSuite.regressionThreshold }
          : {}),
        source,
      };
    },
  );
  suiteDefs.sort((a, b) => a.name.localeCompare(b.name));

  return {
    trials,
    suites: Object.fromEntries(
      Object.entries(mergedSuites).map(([suiteName, entries]) => [
        suiteName,
        entries.map((entry) => ({ trial: entry.trial, variant: entry.variant })),
      ]),
    ),
    suiteDefs,
    models: evalConfig?.models ?? [],
    defaultWorker: evalConfig?.worker,
    judge: evalConfig?.judge,
    timeouts: evalConfig?.timeouts,
    epochs: evalConfig?.epochs,
    budgets: evalConfig?.budgets,
    regressionThreshold: evalConfig?.regressions?.threshold,
  };
}

export function getRunCommandForEvalDir(): string {
  return "bun eval.ts";
}

function listTrials(trialsDir: string): string[] {
  return fs.readdirSync(trialsDir).filter((dirName) => {
    const candidate = path.join(trialsDir, dirName);
    return fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, "config.ts"));
  });
}

async function loadTrialConfig(
  evalDir: string,
  trialName: string,
): Promise<NonNullable<TrialConfigModule["default"]> | null> {
  const configPath = path.join(evalDir, "trials", trialName, "config.ts");
  if (!fs.existsSync(configPath)) return null;
  const mod = (await importFresh(evalDir, configPath)) as TrialConfigModule;
  return mod.default ?? null;
}

async function loadEvalConfig(evalDir: string): Promise<NonNullable<EvalConfigModule["default"]> | null> {
  const configPath = path.join(evalDir, "eval.config.ts");
  if (!fs.existsSync(configPath)) return null;
  const mod = (await importFresh(evalDir, configPath)) as EvalConfigModule;
  return mod.default ?? null;
}

async function importFresh(evalDir: string, filePath: string): Promise<unknown> {
  const stat = fs.statSync(filePath);
  const useCache = process.env.NODE_ENV !== "development";
  const cached = useCache ? moduleCache.get(filePath) : null;
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.value;
  }

  const tsxLoaderPath = resolveTsxLoaderPath(evalDir);
  const moduleValue = await loadModuleWithTsx(tsxLoaderPath, filePath, evalDir);

  if (useCache) {
    moduleCache.set(filePath, { mtimeMs: stat.mtimeMs, value: { default: moduleValue } });
  }

  return { default: moduleValue };
}

function resolveTsxLoaderPath(evalDir: string): string {
  const candidatePaths = [
    path.join(evalDir, "node_modules", "tsx", "dist", "esm", "index.mjs"),
    safeResolveTsxFromPackage(),
  ].filter((candidate): candidate is string => !!candidate);

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not load eval config from ${evalDir}: tsx runtime not found. Install dependencies in the eval project or ensure pi-do-eval is installed with its runtime dependencies.`,
  );
}

function safeResolveTsxFromPackage(): string | null {
  try {
    return require.resolve("tsx/dist/esm/index.mjs");
  } catch {
    return null;
  }
}

async function loadModuleWithTsx(loaderPath: string, filePath: string, cwd: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [
        "--input-type=module",
        "--import",
        pathToFileURL(loaderPath).href,
        "--eval",
        IMPORT_DEFAULT_SCRIPT,
        pathToFileURL(filePath).href,
      ],
      {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(`Failed to load ${filePath}: ${detail}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout || "null"));
      } catch (error) {
        reject(
          new Error(
            `Failed to parse launcher config from ${filePath}: ${error instanceof Error ? error.message : "invalid JSON"}`,
          ),
        );
      }
    });
  });
}
