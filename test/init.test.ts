import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { runInit } from "../cli/init.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-init-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePkg(pkg: Record<string, unknown>) {
  fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify(pkg));
}

describe("runInit", () => {
  it("scaffolds the eval directory from a Pi extension repo", async () => {
    writePkg({
      name: "my-ext",
      pi: { extensions: ["./src/index.ts"] },
    });

    // Suppress process.exit
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await runInit(tmpDir);

    const evalDir = path.join(tmpDir, "eval");
    expect(fs.existsSync(path.join(evalDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(evalDir, "tsconfig.json"))).toBe(true);
    expect(fs.existsSync(path.join(evalDir, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(evalDir, "types.ts"))).toBe(false);
    expect(fs.existsSync(path.join(evalDir, "eval.config.ts"))).toBe(true);
    expect(fs.existsSync(path.join(evalDir, "eval.ts"))).toBe(false);
    expect(fs.existsSync(path.join(evalDir, "plugins", "my-ext.ts"))).toBe(true);
    expect(fs.existsSync(path.join(evalDir, "trials", "example", "trial.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(evalDir, "trials", "example", "task.md"))).toBe(true);
    expect(fs.existsSync(path.join(evalDir, "suites", "small.yaml"))).toBe(true);

    // Check package.json contents
    const pkg = JSON.parse(fs.readFileSync(path.join(evalDir, "package.json"), "utf-8"));
    expect(pkg.name).toBe("my-ext-eval");
    expect(pkg.dependencies["do-eval"]).toBeDefined();

    // Check plugin references the correct extension path
    const pluginContent = fs.readFileSync(path.join(evalDir, "plugins", "my-ext.ts"), "utf-8");
    expect(pluginContent).toContain('"my-ext"');
    expect(pluginContent).toContain('path.resolve(import.meta.dirname, "..", "../src/index.ts")');

    // Check trial config references the plugin
    const trialConfig = fs.readFileSync(path.join(evalDir, "trials", "example", "trial.yaml"), "utf-8");
    expect(trialConfig).toContain("plugin: my-ext");

    mockExit.mockRestore();
  });

  it("scaffolds profile and layer Bench configs", async () => {
    writePkg({
      name: "my-ext",
      pi: { extensions: ["./src/index.ts"] },
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await runInit(tmpDir);

    const evalDir = path.join(tmpDir, "eval");
    expect(fs.existsSync(path.join(evalDir, "types.ts"))).toBe(false);
    expect(fs.existsSync(path.join(evalDir, "eval.ts"))).toBe(false);

    const suiteContent = parse(fs.readFileSync(path.join(evalDir, "suites", "small.yaml"), "utf-8"));
    expect(suiteContent).toEqual({ name: "small", description: "Example suite", trials: ["example"] });

    const configContent = fs.readFileSync(path.join(evalDir, "eval.config.ts"), "utf-8");
    expect(configContent).toContain("codexBaseline");
    expect(configContent).toContain("codexWithSkills");
    expect(configContent).toContain("codexWithPlugin");
    expect(configContent).not.toContain("codexControl");
    expect(configContent).not.toContain("codexAbp");
    expect(configContent).toContain("isolateHome: true");
    expect(configContent).toContain('kind: "skill-library"');
    expect(configContent).toContain('kind: "plugin"');
    expect(configContent).toContain('mode: "install"');
    expect(configContent).not.toContain("suites:");
    expect(configContent).not.toContain("runSets:");

    expect(configContent).toContain("ProjectEvalConfig");

    mockExit.mockRestore();
  });

  it("aborts if no package.json exists", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(runInit(tmpDir)).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });

  it("aborts if eval/ directory already exists with files", async () => {
    writePkg({ name: "my-ext" });
    const evalDir = path.join(tmpDir, "eval");
    fs.mkdirSync(evalDir);
    fs.writeFileSync(path.join(evalDir, "existing.ts"), "// existing");

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(runInit(tmpDir)).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });

  it("falls back gracefully when pi.extensions is missing", async () => {
    writePkg({ name: "plain-pkg" });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await runInit(tmpDir);

    const evalDir = path.join(tmpDir, "eval");
    expect(fs.existsSync(path.join(evalDir, "plugins", "plain-pkg.ts"))).toBe(true);

    // Plugin should use fallback extension path
    const pluginContent = fs.readFileSync(path.join(evalDir, "plugins", "plain-pkg.ts"), "utf-8");
    expect(pluginContent).toContain('path.resolve(import.meta.dirname, "..", "../../src/index.ts")');

    mockExit.mockRestore();
  });
});
