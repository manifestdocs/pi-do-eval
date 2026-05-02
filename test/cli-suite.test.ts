import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

let tmpDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-cli-suite-"));
  projectDir = path.join(tmpDir, "project");
  const evalDir = path.join(projectDir, "eval");
  fs.mkdirSync(path.join(evalDir, "trials", "example"), { recursive: true });
  fs.writeFileSync(path.join(evalDir, "eval.config.ts"), "export default {};\n");
  fs.writeFileSync(path.join(evalDir, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(
    path.join(evalDir, "trials", "example", "trial.yaml"),
    "description: Example\nvariants:\n  default: {}\n  edge: {}\n",
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runSuiteCli(args: string[]) {
  return spawnSync("bun", ["cli/index.ts", "suite", ...args], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, PI_DO_EVAL_CONFIG_HOME: path.join(tmpDir, "config-home") },
    encoding: "utf-8",
  });
}

function readSuite(name: string): unknown {
  return parse(fs.readFileSync(path.join(projectDir, "eval", "suites", `${name}.yaml`), "utf-8"));
}

describe("do-eval suite", () => {
  it("creates, lists, shows, adds, and removes file-backed suites", () => {
    const create = runSuiteCli([
      "create",
      "small",
      "example",
      "example:edge",
      "--description",
      "Small suite",
      "--threshold",
      "4",
      "--project",
      projectDir,
    ]);
    expect(create.status, create.stderr).toBe(0);
    expect(readSuite("small")).toEqual({
      name: "small",
      description: "Small suite",
      trials: ["example", { trial: "example", variant: "edge" }],
      regressionThreshold: 4,
    });

    const list = runSuiteCli(["list", "--project", projectDir]);
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toContain("small (2)");

    const show = runSuiteCli(["show", "small", "--project", projectDir]);
    expect(show.status, show.stderr).toBe(0);
    expect(parse(show.stdout).trials).toEqual(["example", { trial: "example", variant: "edge" }]);

    const add = runSuiteCli(["add", "small", "example:default", "--project", projectDir]);
    expect(add.status).not.toBe(0);
    expect(add.stderr).toContain("Duplicate suite trial reference");

    const remove = runSuiteCli(["remove", "small", "example:edge", "--project", projectDir]);
    expect(remove.status, remove.stderr).toBe(0);
    expect(readSuite("small")).toEqual({
      name: "small",
      description: "Small suite",
      trials: ["example"],
      regressionThreshold: 4,
    });
  });

  it("validates suite names, trial names, and variants before writing", () => {
    const invalidName = runSuiteCli(["create", "../bad", "example", "--project", projectDir]);
    expect(invalidName.status).not.toBe(0);
    expect(invalidName.stderr).toContain("Invalid suite name");

    const unknownTrial = runSuiteCli(["create", "bad", "missing", "--project", projectDir]);
    expect(unknownTrial.status).not.toBe(0);
    expect(unknownTrial.stderr).toContain("Unknown trial: missing");

    const unknownVariant = runSuiteCli(["create", "bad", "example:missing", "--project", projectDir]);
    expect(unknownVariant.status).not.toBe(0);
    expect(unknownVariant.stderr).toContain('Unknown variant "missing" for trial "example"');
  });

  it("resolves both project roots and eval directories", () => {
    const evalDir = path.join(projectDir, "eval");
    const create = runSuiteCli(["create", "from-eval-dir", "example", "--project", evalDir]);
    expect(create.status, create.stderr).toBe(0);
    expect(readSuite("from-eval-dir")).toEqual({ name: "from-eval-dir", trials: ["example"] });
  });
});
