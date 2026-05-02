import * as fs from "node:fs";
import * as path from "node:path";
import { parseDocument, stringify } from "yaml";
import type { TrialManifest, TrialVariant } from "./types.js";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i;
const MANIFEST_FILE = "trial.yaml";

export function validateName(value: string, kind = "name"): void {
  if (!NAME_PATTERN.test(value)) {
    throw new Error(`Invalid ${kind}: "${value}". Must match ${NAME_PATTERN}`);
  }
}

/**
 * @deprecated Use `validateName(value, "trial")` instead.
 */
export function validateTrialName(name: string): void {
  validateName(name, "trial");
}

export function listTrialNames(evalDir: string): string[] {
  const trialsDir = path.join(evalDir, "trials");
  if (!fs.existsSync(trialsDir)) return [];
  return fs
    .readdirSync(trialsDir)
    .filter((dirName) => fs.existsSync(path.join(trialsDir, dirName, MANIFEST_FILE)))
    .sort((a, b) => a.localeCompare(b));
}

export function loadTrialManifest(evalDir: string, name: string): TrialManifest | null {
  const filePath = path.join(evalDir, "trials", name, MANIFEST_FILE);
  if (!fs.existsSync(filePath)) return null;
  return parseTrialManifestYaml(fs.readFileSync(filePath, "utf-8"), filePath);
}

export function readTrialManifest(evalDir: string, name: string): TrialManifest {
  const manifest = loadTrialManifest(evalDir, name);
  if (!manifest)
    throw new Error(`Trial manifest not found or invalid: ${path.join(evalDir, "trials", name, MANIFEST_FILE)}`);
  return manifest;
}

export function writeTrialManifest(evalDir: string, name: string, manifest: TrialManifest): string {
  validateName(name, "trial");
  const dir = path.join(evalDir, "trials", name);
  if (!fs.existsSync(dir)) throw new Error(`Trial directory not found: ${dir}`);
  const filePath = path.join(dir, MANIFEST_FILE);
  fs.writeFileSync(filePath, stringify(serializeTrialManifest(manifest)));
  return filePath;
}

export function parseTrialManifestYaml(source: string, filePath = "trial.yaml"): TrialManifest {
  const doc = parseDocument(source, { prettyErrors: false });
  if (doc.errors.length > 0) {
    throw new Error(`${filePath} could not be parsed: ${doc.errors[0]?.message ?? "invalid YAML"}`);
  }
  const value = doc.toJSON();
  if (!isRecord(value)) throw new Error(`${filePath} must be an object`);

  const description = optionalString(value.description, `${filePath}.description`) ?? "";
  const taskFile = optionalString(value.taskFile, `${filePath}.taskFile`);
  const plugin = optionalString(value.plugin, `${filePath}.plugin`);
  const taskCount = optionalNumber(value.taskCount, `${filePath}.taskCount`);
  const scaffoldDir = optionalString(value.scaffoldDir, `${filePath}.scaffoldDir`);
  const features = optionalStringArray(value.features, `${filePath}.features`);
  const enabled = optionalBoolean(value.enabled, `${filePath}.enabled`);
  const tags = optionalStringArray(value.tags, `${filePath}.tags`);
  const variants = parseVariants(value.variants, `${filePath}.variants`);

  return {
    description,
    ...(taskFile ? { taskFile } : {}),
    ...(plugin ? { plugin } : {}),
    ...(taskCount !== undefined ? { taskCount } : {}),
    ...(scaffoldDir ? { scaffoldDir } : {}),
    ...(features ? { features } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(tags ? { tags } : {}),
    variants,
  };
}

function serializeTrialManifest(manifest: TrialManifest): Record<string, unknown> {
  return {
    description: manifest.description,
    ...(manifest.taskFile ? { taskFile: manifest.taskFile } : {}),
    ...(manifest.plugin ? { plugin: manifest.plugin } : {}),
    ...(manifest.taskCount !== undefined ? { taskCount: manifest.taskCount } : {}),
    ...(manifest.scaffoldDir ? { scaffoldDir: manifest.scaffoldDir } : {}),
    ...(manifest.features && manifest.features.length > 0 ? { features: manifest.features } : {}),
    ...(manifest.enabled !== undefined ? { enabled: manifest.enabled } : {}),
    ...(manifest.tags && manifest.tags.length > 0 ? { tags: manifest.tags } : {}),
    variants: manifest.variants,
  };
}

function parseVariants(value: unknown, pathName: string): Record<string, TrialVariant> {
  if (value === undefined) return { default: {} };
  if (!isRecord(value)) throw new Error(`${pathName} must be an object`);
  const variants: Record<string, TrialVariant> = {};
  for (const [name, variant] of Object.entries(value)) {
    validateName(name, "variant");
    if (variant === null || variant === undefined) {
      variants[name] = {};
      continue;
    }
    if (!isRecord(variant)) throw new Error(`${pathName}.${name} must be an object`);
    if (variant.label !== undefined && typeof variant.label !== "string") {
      throw new Error(`${pathName}.${name}.label must be a string`);
    }
    variants[name] = variant as TrialVariant;
  }
  if (Object.keys(variants).length === 0)
    throw new Error(
      `${pathName} must define at least one variant\n  Suggestion: omit the \`variants\` key entirely, or set \`variants: { default: {} }\``,
    );
  return variants;
}

function optionalString(value: unknown, pathName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${pathName} must be a string`);
  return value;
}

function optionalNumber(value: unknown, pathName: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${pathName} must be a finite number`);
  return value;
}

function optionalBoolean(value: unknown, pathName: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${pathName} must be a boolean`);
  return value;
}

function optionalStringArray(value: unknown, pathName: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${pathName} must be an array of strings`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
