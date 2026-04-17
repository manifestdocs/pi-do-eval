import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadTrialMeta,
  type TrialMeta,
  writeTrialMeta,
} from "../src/lib/eval/trial-meta.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-do-eval-trial-meta-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setupTrial(name: string): string {
  const trialDir = path.join(tmpDir, "trials", name);
  fs.mkdirSync(trialDir, { recursive: true });
  return trialDir;
}

describe("loadTrialMeta", () => {
  it("returns null when meta.json does not exist", () => {
    setupTrial("empty");
    expect(loadTrialMeta(tmpDir, "empty")).toBeNull();
  });

  it("parses meta.json", () => {
    const dir = setupTrial("decorated");
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({
        description: "Custom description",
        tags: ["algorithm", "search"],
        enabled: false,
      }),
    );

    const meta = loadTrialMeta(tmpDir, "decorated");
    expect(meta).toEqual({
      description: "Custom description",
      tags: ["algorithm", "search"],
      enabled: false,
    });
  });

  it("returns null for invalid JSON without throwing", () => {
    const dir = setupTrial("broken");
    fs.writeFileSync(path.join(dir, "meta.json"), "not json");
    expect(loadTrialMeta(tmpDir, "broken")).toBeNull();
  });
});

describe("writeTrialMeta", () => {
  it("writes and round-trips trial metadata", () => {
    setupTrial("my-trial");
    const meta: TrialMeta = { tags: ["smoke"], enabled: true };
    writeTrialMeta(tmpDir, "my-trial", meta);
    expect(loadTrialMeta(tmpDir, "my-trial")).toEqual(meta);
  });

  it("strips empty fields when serialising", () => {
    setupTrial("my-trial");
    writeTrialMeta(tmpDir, "my-trial", {
      description: "",
      tags: [],
      enabled: true,
    });

    const raw = fs.readFileSync(path.join(tmpDir, "trials", "my-trial", "meta.json"), "utf-8");
    const parsed = JSON.parse(raw) as TrialMeta;
    expect(parsed.description).toBeUndefined();
    expect(parsed.tags).toBeUndefined();
    expect(parsed.enabled).toBe(true);
  });

  it("rejects invalid trial names to avoid path traversal", () => {
    expect(() => writeTrialMeta(tmpDir, "../evil", {})).toThrow();
  });

  it("throws when the trial directory does not exist", () => {
    expect(() => writeTrialMeta(tmpDir, "ghost", { enabled: true })).toThrow(
      /Trial directory not found/,
    );
  });
});
