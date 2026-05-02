import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { deleteFileSuite, loadFileSuites, type SuiteDefinition, writeFileSuite } from "../src/lib/eval/suite-files.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-suites-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, data: unknown): void {
  const dir = path.join(tmpDir, "suites");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.yaml`), stringify(data));
}

describe("loadFileSuites", () => {
  it("returns empty array when suites/ directory does not exist", () => {
    expect(loadFileSuites(tmpDir)).toEqual([]);
  });

  it("normalizes string trial refs to the default variant", () => {
    writeFixture("smoke", {
      name: "smoke",
      trials: ["trial-a"],
    });

    expect(loadFileSuites(tmpDir)[0]?.trials).toEqual([{ trial: "trial-a", variant: "default" }]);
  });

  it("loads mixed string and object refs", () => {
    writeFixture("mixed", {
      name: "mixed",
      description: "Mixed suite",
      trials: ["trial-a", { trial: "trial-b", variant: "edge" }],
      regressionThreshold: 3,
    });

    expect(loadFileSuites(tmpDir)).toEqual([
      {
        name: "mixed",
        description: "Mixed suite",
        trials: [
          { trial: "trial-a", variant: "default" },
          { trial: "trial-b", variant: "edge" },
        ],
        regressionThreshold: 3,
      },
    ]);
  });

  it("derives missing name from filename", () => {
    writeFixture("unnamed", {
      trials: [{ trial: "trial-a", variant: "default" }],
    });

    const suites = loadFileSuites(tmpDir);
    expect(suites).toHaveLength(1);
    expect(suites[0]?.name).toBe("unnamed");
  });

  it("throws with the file path when a suite YAML is malformed", () => {
    const dir = path.join(tmpDir, "suites");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "broken.yaml"), "trials: [");
    writeFixture("ok", { name: "ok", trials: [] });

    expect(() => loadFileSuites(tmpDir)).toThrow(/broken\.yaml could not be parsed/);
  });

  it("throws when the YAML name does not match the filename", () => {
    writeFixture("quick", { name: "small", trials: [{ trial: "trial-a", variant: "default" }] });

    expect(() => loadFileSuites(tmpDir)).toThrow(/name "small" must match filename "quick\.yaml"/);
  });
});

describe("writeFileSuite + deleteFileSuite", () => {
  it("writes a suite YAML file that loadFileSuites round-trips", () => {
    const suite: SuiteDefinition = {
      name: "regression",
      description: "Everything",
      trials: [{ trial: "trial-a", variant: "default" }],
      regressionThreshold: 5,
    };
    writeFileSuite(tmpDir, suite);

    const loaded = loadFileSuites(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(suite);
  });

  it("serializes default-variant refs as strings", () => {
    writeFileSuite(tmpDir, {
      name: "smoke",
      trials: [
        { trial: "trial-a", variant: "default" },
        { trial: "trial-b", variant: "edge" },
      ],
    });

    const raw = parse(fs.readFileSync(path.join(tmpDir, "suites", "smoke.yaml"), "utf-8"));
    expect(raw.trials).toEqual(["trial-a", { trial: "trial-b", variant: "edge" }]);
  });

  it("removes the suite YAML file", () => {
    writeFileSuite(tmpDir, {
      name: "temp",
      trials: [{ trial: "trial-a", variant: "default" }],
    });
    expect(loadFileSuites(tmpDir)).toHaveLength(1);

    deleteFileSuite(tmpDir, "temp");
    expect(loadFileSuites(tmpDir)).toHaveLength(0);
  });

  it("rejects invalid suite names to avoid path traversal", () => {
    expect(() => writeFileSuite(tmpDir, { name: "../evil", trials: [] })).toThrow(/Invalid suite name/);
    expect(() => deleteFileSuite(tmpDir, "../evil")).toThrow(/Invalid suite name/);
  });

  it("rejects duplicate trial references", () => {
    expect(() =>
      writeFileSuite(tmpDir, {
        name: "dupes",
        trials: [
          { trial: "trial-a", variant: "default" },
          { trial: "trial-a", variant: "default" },
        ],
      }),
    ).toThrow(/Duplicate suite trial reference: trial-a:default/);
  });
});
