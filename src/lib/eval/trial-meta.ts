import * as fs from "node:fs";
import * as path from "node:path";
import { parseJsonWith } from "../contracts/codec.js";
import { trialMetaCodec } from "../contracts/domain.js";

export interface TrialMeta {
  description?: string;
  tags?: string[];
  enabled?: boolean;
}

const TRIAL_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i;
const META_FILE = "meta.json";

function trialDir(evalDir: string, name: string): string {
  return path.join(evalDir, "trials", name);
}

export function validateTrialName(name: string): void {
  if (!TRIAL_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid trial name: "${name}". Must match ${TRIAL_NAME_PATTERN}`);
  }
}

export function loadTrialMeta(evalDir: string, name: string): TrialMeta | null {
  const filePath = path.join(trialDir(evalDir, name), META_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = parseJsonWith(fs.readFileSync(filePath, "utf-8"), filePath, trialMetaCodec);
    return parsed.ok ? parsed.value : null;
  } catch (err) {
    console.warn(`Skipping invalid trial meta ${filePath}:`, err);
    return null;
  }
}

export function writeTrialMeta(evalDir: string, name: string, meta: TrialMeta): string {
  validateTrialName(name);
  const dir = trialDir(evalDir, name);
  if (!fs.existsSync(dir)) {
    throw new Error(`Trial directory not found: ${dir}`);
  }

  const payload: TrialMeta = {};
  if (meta.description && meta.description.trim().length > 0) payload.description = meta.description.trim();
  if (meta.tags && meta.tags.length > 0) payload.tags = meta.tags;
  if (meta.enabled !== undefined) payload.enabled = meta.enabled;

  const filePath = path.join(dir, META_FILE);
  fs.writeFileSync(filePath, `${JSON.stringify(trialMetaCodec.serialize(payload), null, 2)}\n`);
  return filePath;
}
