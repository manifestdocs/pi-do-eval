import * as fs from "node:fs";
import * as path from "node:path";
import { parseDocument, stringify } from "yaml";
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
    if (!entry.endsWith(".yaml")) continue;
    const filePath = path.join(dir, entry);
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = parseSuiteYaml(raw, filePath);
    const fallbackName = path.basename(entry, ".yaml");
    const suite = parseSuiteDefinitionWithFallbackName(parsed, fallbackName);
    if (!suite.ok) {
      throw new Error(`Invalid suite file ${filePath}: ${suite.issues.join("; ")}`);
    }
    if (suite.value.name !== fallbackName) {
      throw new Error(
        `Invalid suite file ${filePath}: name "${suite.value.name}" must match filename "${fallbackName}.yaml"`,
      );
    }
    validateSuiteDefinition(suite.value);
    results.push(suite.value);
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

export function writeFileSuite(evalDir: string, suite: SuiteDefinition): string {
  validateSuiteDefinition(suite);
  const dir = getSuiteDefsDir(evalDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${suite.name}.yaml`);
  const serializable: SuiteDefinition = {
    name: suite.name,
    ...(suite.description ? { description: suite.description } : {}),
    trials: suite.trials,
    ...(suite.regressionThreshold !== undefined ? { regressionThreshold: suite.regressionThreshold } : {}),
  };
  fs.writeFileSync(filePath, stringify(suiteDefinitionCodec.serialize(serializable)));
  return filePath;
}

function parseSuiteYaml(raw: string, filePath: string): unknown {
  const document = parseDocument(raw, { prettyErrors: false });
  if (document.errors.length > 0) {
    throw new Error(`${filePath} could not be parsed: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  return document.toJSON();
}

export function validateSuiteDefinition(suite: SuiteDefinition): void {
  validateSuiteName(suite.name);
  const seen = new Set<string>();
  for (const entry of suite.trials) {
    const key = `${entry.trial}:${entry.variant}`;
    if (seen.has(key)) throw new Error(`Duplicate suite trial reference: ${key}`);
    seen.add(key);
  }
}

export function deleteFileSuite(evalDir: string, name: string): void {
  validateSuiteName(name);
  const filePath = path.join(getSuiteDefsDir(evalDir), `${name}.yaml`);
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}
