// Why two loaders for eval.config.ts?
//
// project-runner.ts (CLI path) uses native `import()` because it runs under bun
// or a tsx-loaded node, which both handle TypeScript natively. The viewer path
// (this file) is reached from the *built* SvelteKit server bundle running on
// plain node, where direct `import()` of a .ts file fails. So we spawn a child
// process with the tsx loader and JSON-stringify the default export across
// stdout. Both paths funnel the result through `parseProjectEvalConfig` so the
// shape is validated regardless of which loader produced it.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parseProjectEvalConfig } from "$eval/load-config.js";
import { loadFileSuites } from "$eval/suite-files.js";
import { loadTrialManifest } from "$eval/trial-manifest.js";
import type { LauncherConfig, LauncherSuiteDef, ProjectEvalConfig } from "$eval/types.js";

type TrialRef = { trial: string; variant: string };

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
      const manifest = loadTrialManifest(evalDir, trialName);
      const variantEntries = Object.entries(manifest?.variants ?? {});
      const variantLabels: Record<string, string> = {};
      for (const [key, variant] of variantEntries) {
        const label = variant.label;
        if (typeof label === "string" && label.length > 0) variantLabels[key] = label;
      }
      return {
        name: trialName,
        description: manifest?.description ?? "",
        variants: variantEntries.map(([key]) => key),
        ...(Object.keys(variantLabels).length > 0 ? { variantLabels } : {}),
        ...(manifest?.tags ? { tags: manifest.tags } : {}),
        enabled: manifest?.enabled ?? true,
      };
    }),
  );

  const evalConfig = await loadEvalConfig(evalDir);
  const fileSuites = loadFileSuites(evalDir);
  const fileSuiteMap = Object.fromEntries(fileSuites.map((suite) => [suite.name, suite.trials]));
  validateSuiteReferences(fileSuiteMap, trials);

  const suiteDefs: LauncherSuiteDef[] = fileSuites.map((suite) => ({
    name: suite.name,
    ...(suite.description ? { description: suite.description } : {}),
    trials: suite.trials,
    ...(suite.regressionThreshold !== undefined ? { regressionThreshold: suite.regressionThreshold } : {}),
    source: "file",
  }));
  suiteDefs.sort((a, b) => a.name.localeCompare(b.name));

  return {
    trials,
    suites: Object.fromEntries(
      fileSuites.map((suite) => [
        suite.name,
        suite.trials.map((entry) => ({ trial: entry.trial, variant: entry.variant })),
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
    ...(evalConfig?.defaultLaunchType ? { defaultLaunchType: evalConfig.defaultLaunchType } : {}),
  };
}

export function getRunCommandForEvalDir(_evalDir?: string): string {
  return "do-eval";
}

function validateSuiteReferences(
  suites: Record<string, TrialRef[]>,
  trials: Array<{ name: string; variants: string[] }>,
): void {
  const trialVariants = new Map(trials.map((trial) => [trial.name, new Set(trial.variants)]));
  for (const [suiteName, entries] of Object.entries(suites)) {
    for (const entry of entries) {
      const variants = trialVariants.get(entry.trial);
      if (!variants) {
        throw new Error(
          `Eval launcher contract violation: suite "${suiteName}" references unknown trial "${entry.trial}"`,
        );
      }
      if (!variants.has(entry.variant)) {
        const available = [...variants].join(", ") || "none";
        throw new Error(
          `Eval launcher contract violation: suite "${suiteName}" references unknown variant "${entry.variant}" for trial "${entry.trial}". Available variants: ${available}`,
        );
      }
    }
  }
}

function listTrials(trialsDir: string): string[] {
  return fs.readdirSync(trialsDir).filter((dirName) => {
    const candidate = path.join(trialsDir, dirName);
    return fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, "trial.yaml"));
  });
}

async function loadEvalConfig(evalDir: string): Promise<ProjectEvalConfig | null> {
  const configPath = path.join(evalDir, "eval.config.ts");
  if (!fs.existsSync(configPath)) return null;
  const mod = (await importFresh(evalDir, configPath)) as { default?: unknown };
  if (mod.default === undefined || mod.default === null) return null;
  const parsed = parseProjectEvalConfig(mod.default, configPath);
  if (!parsed.ok) {
    throw new Error(`Eval launcher contract violation: ${parsed.issues.join("; ")}`);
  }
  return parsed.value;
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
    `Could not load eval config from ${evalDir}: tsx runtime not found. Install dependencies in the eval project or ensure do-eval is installed with its runtime dependencies.`,
  );
}

function safeResolveTsxFromPackage(): string | null {
  try {
    return require.resolve("tsx/esm");
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
