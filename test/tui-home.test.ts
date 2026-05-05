import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import type { EvalEvent } from "../src/lib/eval/types.js";
import type { RegisteredProject } from "../src/lib/server/projects.js";
import type { Screen, ScreenController } from "../src/lib/tui/screen.js";
import { ProjectHomeScreen } from "../src/lib/tui/screens/home.js";

let tmpDir: string | null = null;

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe("ProjectHomeScreen", () => {
  it("lists bench and regression targets on the home screen", async () => {
    const evalDir = makeEvalDir();
    const controller = makeController(evalDir);
    const screen = new ProjectHomeScreen(controller, makeProject(evalDir));

    screen.enter();

    await vi.waitFor(() => {
      const rendered = screen.render(120).join("\n");
      expect(rendered).toContain("Run Bench");
      expect(rendered).toContain("quick");
      expect(rendered).toContain("2 profiles");
      expect(rendered).toContain("Run Regression");
      expect(rendered).toContain("Fast check");
    });
  });
});

function makeEvalDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-home-"));
  const evalDir = path.join(tmpDir, "eval");
  fs.mkdirSync(path.join(evalDir, "trials", "example"), { recursive: true });
  fs.mkdirSync(path.join(evalDir, "suites"), { recursive: true });
  fs.writeFileSync(
    path.join(evalDir, "trials", "example", "trial.yaml"),
    stringify({ description: "Example", variants: { default: {} } }),
  );
  fs.writeFileSync(
    path.join(evalDir, "suites", "quick.yaml"),
    stringify({ name: "quick", description: "Fast check", trials: ["example"] }),
  );
  fs.writeFileSync(
    path.join(evalDir, "eval.config.ts"),
    [
      "export default {",
      "  benches: { quick: { profiles: ['baseline', 'treatment'], baseline: 'baseline' } },",
      "};",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(evalDir, "package.json"), JSON.stringify({ type: "module" }));
  return evalDir;
}

function makeController(evalDir: string): ScreenController {
  return {
    push: vi.fn<(screen: Screen) => void>(),
    pop: vi.fn<() => void>(),
    replace: vi.fn<(screen: Screen) => void>(),
    setStatusLeft: vi.fn<(text: string) => void>(),
    setStatusCenter: vi.fn<(text: string) => void>(),
    setStatusRight: vi.fn<(text: string) => void>(),
    setProject: vi.fn<(name: string, path: string) => void>(),
    clearProject: vi.fn<() => void>(),
    requestRender: vi.fn<() => void>(),
    bodyMaxRows: () => 40,
    getEvalDir: () => evalDir,
    hasActiveRun: () => false,
    onEvent: () => () => {},
    emitter: () => (_event: EvalEvent) => {},
  };
}

function makeProject(evalDir: string): RegisteredProject {
  return {
    id: "project-1",
    name: "Project",
    projectRoot: path.dirname(evalDir),
    evalDir,
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastSelectedAt: "2026-01-01T00:00:00Z",
  };
}
