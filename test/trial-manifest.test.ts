import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTrialManifestYaml, writeTrialManifest } from "../src/lib/eval/trial-manifest.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-trial-manifest-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseTrialManifestYaml", () => {
  it("loads project plugin metadata while preserving variant data", () => {
    const manifest = parseTrialManifestYaml(
      [
        "description: Proof-mode calculator task",
        "taskFile: PRD.md",
        "plugin: pi-proof",
        "taskCount: 3",
        "scaffoldDir: scaffold",
        "features:",
        "  - stack operations",
        "variants:",
        "  typescript-vitest:",
        "    stacks:",
        "      language: TypeScript",
        "      testFramework: Vitest",
      ].join("\n"),
    );

    expect(manifest).toEqual({
      description: "Proof-mode calculator task",
      taskFile: "PRD.md",
      plugin: "pi-proof",
      taskCount: 3,
      scaffoldDir: "scaffold",
      features: ["stack operations"],
      variants: {
        "typescript-vitest": {
          stacks: {
            language: "TypeScript",
            testFramework: "Vitest",
          },
        },
      },
    });
  });

  it("rejects non-numeric task counts", () => {
    expect(() => parseTrialManifestYaml("taskCount: many\nvariants:\n  default: {}\n")).toThrow(
      /taskCount must be a finite number/,
    );
  });

  it("defaults variants to a single 'default' entry when the key is omitted", () => {
    const manifest = parseTrialManifestYaml("description: minimal\n");
    expect(manifest.variants).toEqual({ default: {} });
  });

  it("rejects an empty variants object", () => {
    expect(() => parseTrialManifestYaml("description: empty\nvariants: {}\n")).toThrow(
      /must define at least one variant/,
    );
  });

  it("appends a fix suggestion when variants is empty", () => {
    expect(() => parseTrialManifestYaml("description: empty\nvariants: {}\n")).toThrow(
      /Suggestion: omit the `variants` key entirely, or set `variants: \{ default: \{\} \}`/,
    );
  });

  it("rejects variant names that fail the identifier pattern", () => {
    expect(() => parseTrialManifestYaml("variants:\n  '../bad': {}\n")).toThrow(/Invalid variant: "\.\.\/bad"/);
  });

  it("preserves enabled, tags, and scaffoldDir on round-trip", () => {
    const yaml = [
      "description: Round-trip",
      "scaffoldDir: scaffold",
      "enabled: false",
      "tags:",
      "  - smoke",
      "  - regression",
      "variants:",
      "  default: {}",
    ].join("\n");
    const manifest = parseTrialManifestYaml(yaml);
    expect(manifest).toEqual({
      description: "Round-trip",
      scaffoldDir: "scaffold",
      enabled: false,
      tags: ["smoke", "regression"],
      variants: { default: {} },
    });
  });

  it("includes the file path in the error when YAML is malformed", () => {
    expect(() => parseTrialManifestYaml("variants: [\n", "/tmp/broken/trial.yaml")).toThrow(
      /\/tmp\/broken\/trial\.yaml could not be parsed/,
    );
  });

  it("preserves variant labels on round-trip", () => {
    const yaml = [
      "description: Labelled",
      "variants:",
      "  typescript-vitest:",
      "    label: TypeScript / Vitest",
      "    stacks:",
      "      language: TypeScript",
      "  default: {}",
    ].join("\n");
    const manifest = parseTrialManifestYaml(yaml);
    expect(manifest.variants["typescript-vitest"]?.label).toBe("TypeScript / Vitest");
    expect(manifest.variants["typescript-vitest"]?.stacks).toEqual({ language: "TypeScript" });
    expect(manifest.variants.default?.label).toBeUndefined();
  });

  it("rejects non-string variant labels", () => {
    expect(() => parseTrialManifestYaml("variants:\n  default:\n    label: 42\n")).toThrow(/label must be a string/);
  });
});

describe("writeTrialManifest", () => {
  it("round-trips project plugin metadata", () => {
    fs.mkdirSync(path.join(tmpDir, "trials", "proof-task"), { recursive: true });

    writeTrialManifest(tmpDir, "proof-task", {
      description: "Proof task",
      taskFile: "PRD.md",
      plugin: "pi-proof",
      taskCount: 2,
      scaffoldDir: "scaffold",
      features: ["api", "tests"],
      variants: {
        default: {
          stacks: [{ language: "TypeScript", testFramework: "Vitest" }],
        },
      },
    });

    const raw = fs.readFileSync(path.join(tmpDir, "trials", "proof-task", "trial.yaml"), "utf-8");
    expect(parseTrialManifestYaml(raw)).toMatchObject({
      taskFile: "PRD.md",
      plugin: "pi-proof",
      taskCount: 2,
      scaffoldDir: "scaffold",
      features: ["api", "tests"],
    });
  });
});
