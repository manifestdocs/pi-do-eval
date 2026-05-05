import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  getRunCommandForEvalDir,
  loadLauncherConfigFromEvalDir,
  resolveRunsDirFromEvalDir,
} from "../src/lib/server/harness.js";

let tmpDir: string | null = null;

function makeEvalDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-harness-"));
  const evalDir = path.join(tmpDir, "eval");
  fs.mkdirSync(path.join(evalDir, "trials", "example"), { recursive: true });
  fs.writeFileSync(
    path.join(evalDir, "trials", "example", "trial.yaml"),
    stringify({ description: "Example trial", variants: { default: {}, edge: {} } }),
  );
  fs.writeFileSync(path.join(evalDir, "eval.config.ts"), "export default {};\n");
  fs.writeFileSync(path.join(evalDir, "package.json"), JSON.stringify({ type: "module" }));
  return evalDir;
}

function writeSuite(evalDir: string, name: string, data: unknown): void {
  fs.mkdirSync(path.join(evalDir, "suites"), { recursive: true });
  fs.writeFileSync(path.join(evalDir, "suites", `${name}.yaml`), stringify(data));
}

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe("getRunCommandForEvalDir", () => {
  it("uses the first-class do-eval runner command", () => {
    const evalDir = makeEvalDir();

    expect(getRunCommandForEvalDir(evalDir)).toBe("do-eval");
  });
});

describe("resolveRunsDirFromEvalDir", () => {
  it("matches the project runner's configured runs directory", async () => {
    const evalDir = makeEvalDir();
    fs.writeFileSync(path.join(evalDir, "eval.config.ts"), "export default { runsDir: '../custom-runs' };\n");

    await expect(resolveRunsDirFromEvalDir(evalDir)).resolves.toBe(path.join(tmpDir as string, "custom-runs"));
  });

  it("defaults to eval/runs", async () => {
    const evalDir = makeEvalDir();

    await expect(resolveRunsDirFromEvalDir(evalDir)).resolves.toBe(path.join(evalDir, "runs"));
  });
});

describe("loadLauncherConfigFromEvalDir", () => {
  it("loads suites only from eval/suites YAML files", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", { name: "quick", trials: ["example"] });

    const config = await loadLauncherConfigFromEvalDir(evalDir);

    expect(config?.trials).toEqual([
      { name: "example", description: "Example trial", variants: ["default", "edge"], enabled: true },
    ]);
    expect(config?.suites).toEqual({ quick: [{ trial: "example", variant: "default" }] });
    expect(config?.suiteDefs).toEqual([
      { name: "quick", trials: [{ trial: "example", variant: "default" }], source: "file" },
    ]);
  });

  it("rejects suites defined in eval.config.ts", async () => {
    const evalDir = makeEvalDir();
    fs.writeFileSync(
      path.join(evalDir, "eval.config.ts"),
      "export default { suites: { quick: [{ trial: 'example', variant: 'default' }] } };\n",
    );

    await expect(loadLauncherConfigFromEvalDir(evalDir)).rejects.toThrow(/define suites in eval\/suites\/\*\.yaml/);
  });

  it("fails clearly when file suites reference unknown trials", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", { name: "quick", trials: ["missing"] });

    await expect(loadLauncherConfigFromEvalDir(evalDir)).rejects.toThrow(
      /suite "quick" references unknown trial "missing"/,
    );
  });

  it("fails clearly when file suites reference unknown trial variants", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", { name: "quick", trials: [{ trial: "example", variant: "missing" }] });

    await expect(loadLauncherConfigFromEvalDir(evalDir)).rejects.toThrow(
      /suite "quick" references unknown variant "missing" for trial "example"/,
    );
  });

  it("propagates the project's defaultLaunchType so the launcher card can preselect the right tab", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", { name: "quick", trials: ["example"] });
    fs.writeFileSync(path.join(evalDir, "eval.config.ts"), "export default { defaultLaunchType: 'bench' };\n");

    const config = await loadLauncherConfigFromEvalDir(evalDir);

    expect(config?.defaultLaunchType).toBe("bench");
  });

  it("exposes configured benches for launch surfaces", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", {
      name: "quick",
      description: "Fast check",
      trials: ["example"],
    });
    fs.writeFileSync(
      path.join(evalDir, "eval.config.ts"),
      [
        "export default {",
        "  benches: { quick: { profiles: ['baseline', 'treatment'], baseline: 'baseline', epochs: 2 } },",
        "};",
      ].join("\n"),
    );

    const config = await loadLauncherConfigFromEvalDir(evalDir);

    expect(config?.benchDefs).toEqual([
      {
        name: "quick",
        description: "Fast check",
        profiles: ["baseline", "treatment"],
        baseline: "baseline",
        epochs: 2,
        trialCount: 1,
      },
    ]);
  });

  it("omits defaultLaunchType when the project does not specify one", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", { name: "quick", trials: ["example"] });

    const config = await loadLauncherConfigFromEvalDir(evalDir);

    expect(config?.defaultLaunchType).toBeUndefined();
  });

  it("rejects malformed eval.config.ts with a field-path error", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", { name: "quick", trials: ["example"] });
    fs.writeFileSync(path.join(evalDir, "eval.config.ts"), "export default { regressions: 3 };\n");

    await expect(loadLauncherConfigFromEvalDir(evalDir)).rejects.toThrow(/regressions must be an object/);
  });

  it("rejects unknown top-level keys in eval.config.ts", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", { name: "quick", trials: ["example"] });
    fs.writeFileSync(path.join(evalDir, "eval.config.ts"), "export default { mystery: 'unknown' };\n");

    await expect(loadLauncherConfigFromEvalDir(evalDir)).rejects.toThrow(/unknown key\(s\): mystery/);
  });

  it("surfaces malformed trial.yaml with the file path", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", { name: "quick", trials: ["example"] });
    fs.mkdirSync(path.join(evalDir, "trials", "broken"), { recursive: true });
    fs.writeFileSync(path.join(evalDir, "trials", "broken", "trial.yaml"), "variants: [\n");

    await expect(loadLauncherConfigFromEvalDir(evalDir)).rejects.toThrow(/broken\/trial\.yaml could not be parsed/);
  });

  it("appends a fix suggestion when regressions is the wrong shape", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", { name: "quick", trials: ["example"] });
    fs.writeFileSync(path.join(evalDir, "eval.config.ts"), "export default { regressions: 3 };\n");

    await expect(loadLauncherConfigFromEvalDir(evalDir)).rejects.toThrow(
      /Suggestion: set `regressions: \{ threshold: 3 \}`/,
    );
  });

  it("appends a fix suggestion when budgets is the wrong shape", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", { name: "quick", trials: ["example"] });
    fs.writeFileSync(path.join(evalDir, "eval.config.ts"), "export default { budgets: 200 };\n");

    await expect(loadLauncherConfigFromEvalDir(evalDir)).rejects.toThrow(
      /Suggestion: set `budgets: \{ maxToolCalls: 200 \}`/,
    );
  });

  it("propagates per-variant labels onto LauncherTrial.variantLabels", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-harness-"));
    const evalDir = path.join(tmpDir, "eval");
    fs.mkdirSync(path.join(evalDir, "trials", "labelled"), { recursive: true });
    fs.writeFileSync(
      path.join(evalDir, "trials", "labelled", "trial.yaml"),
      stringify({
        description: "Labelled",
        variants: { "ts-vitest": { label: "TypeScript / Vitest" }, plain: {} },
      }),
    );
    fs.writeFileSync(path.join(evalDir, "eval.config.ts"), "export default {};\n");
    fs.writeFileSync(path.join(evalDir, "package.json"), JSON.stringify({ type: "module" }));
    writeSuite(evalDir, "quick", { name: "quick", trials: [{ trial: "labelled", variant: "ts-vitest" }] });

    const config = await loadLauncherConfigFromEvalDir(evalDir);
    const trial = config?.trials.find((t) => t.name === "labelled");
    expect(trial?.variantLabels).toEqual({ "ts-vitest": "TypeScript / Vitest" });
  });

  it("appends a fix suggestion when profile factors.layers is missing", async () => {
    const evalDir = makeEvalDir();
    writeSuite(evalDir, "quick", { name: "quick", trials: ["example"] });
    fs.writeFileSync(
      path.join(evalDir, "eval.config.ts"),
      [
        "export default {",
        "  profiles: {",
        "    p1: { id: 'p1', label: 'P1', agent: {}, factors: { layers: 'oops' } },",
        "  },",
        "};",
      ].join("\n"),
    );

    await expect(loadLauncherConfigFromEvalDir(evalDir)).rejects.toThrow(/Suggestion: set `layers: \[\]`/);
  });
});
