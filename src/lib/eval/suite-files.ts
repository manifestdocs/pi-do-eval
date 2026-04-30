import * as fs from "node:fs";
import * as path from "node:path";
import { parseJson } from "../contracts/codec.js";
import { parseSuiteDefinitionWithFallbackName, suiteDefinitionCodec } from "../contracts/domain.js";

export interface SuiteDefinition {
  name: string;
  description?: string;
  trials: Array<{ trial: string; variant: string }>;
  regressionThreshold?: number;
}

const SUITES_DIR = "suites";
const SUITE_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i;

export function getSuiteDefsDir(evalDir: string): string {
  return path.join(evalDir, SUITES_DIR);
}

export function validateSuiteName(name: string): void {
  if (!SUITE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid suite name: "${name}". Must match ${SUITE_NAME_PATTERN}`);
  }
}

export function loadFileSuites(evalDir: string): SuiteDefinition[] {
  const dir = getSuiteDefsDir(evalDir);
  if (!fs.existsSync(dir)) return [];

  const results: SuiteDefinition[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(dir, entry);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = parseJson(raw, filePath);
      if (!parsed.ok) throw new Error(parsed.issues.join("; "));
      const suite = parseSuiteDefinitionWithFallbackName(parsed.value, path.basename(entry, ".json"));
      if (!suite.ok) continue;
      results.push(suite.value);
    } catch (err) {
      console.warn(`Skipping invalid suite file ${filePath}:`, err);
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

export function writeFileSuite(evalDir: string, suite: SuiteDefinition): string {
  validateSuiteName(suite.name);
  const dir = getSuiteDefsDir(evalDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${suite.name}.json`);
  const serializable: SuiteDefinition = {
    name: suite.name,
    ...(suite.description ? { description: suite.description } : {}),
    trials: suite.trials,
    ...(suite.regressionThreshold !== undefined ? { regressionThreshold: suite.regressionThreshold } : {}),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(suiteDefinitionCodec.serialize(serializable), null, 2)}\n`);
  return filePath;
}

export function deleteFileSuite(evalDir: string, name: string): void {
  validateSuiteName(name);
  const filePath = path.join(getSuiteDefsDir(evalDir), `${name}.json`);
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}

export function mergeSuiteSources(
  configSuites: Record<string, Array<{ trial: string; variant: string }>>,
  fileSuites: SuiteDefinition[],
): Record<string, Array<{ trial: string; variant: string }>> {
  const merged: Record<string, Array<{ trial: string; variant: string }>> = { ...configSuites };
  for (const suite of fileSuites) {
    merged[suite.name] = suite.trials;
  }
  return merged;
}
