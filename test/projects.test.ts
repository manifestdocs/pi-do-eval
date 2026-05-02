import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addOrUpdateProject,
  getActiveProject,
  loadProjectRegistry,
  removeProject,
  resolveProjectIdentifier,
  resolveProjectPath,
  setActiveProject,
} from "../src/lib/server/projects.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-projects-"));
  process.env.PI_DO_EVAL_CONFIG_HOME = path.join(tmpDir, "config-home");
});

afterEach(() => {
  delete process.env.PI_DO_EVAL_CONFIG_HOME;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("project registry", () => {
  it("resolves a project root to its conventional eval directory", () => {
    const { projectRoot, evalDir } = makeProject("pi-tdd");

    const resolved = resolveProjectPath(projectRoot);

    expect(resolved.projectRoot).toBe(fs.realpathSync(projectRoot));
    expect(resolved.evalDir).toBe(fs.realpathSync(evalDir));
    expect(resolved.name).toBe("pi-tdd");
  });

  it("accepts a direct eval directory path", () => {
    const { projectRoot, evalDir } = makeProject("pi-suite", "custom-eval");

    const resolved = resolveProjectPath(evalDir);

    expect(resolved.projectRoot).toBe(fs.realpathSync(projectRoot));
    expect(resolved.evalDir).toBe(fs.realpathSync(evalDir));
  });

  it("adds projects, selects them, and avoids duplicates", () => {
    const first = makeProject("pi-alpha");

    const initial = addOrUpdateProject(first.projectRoot).project;
    const duplicate = addOrUpdateProject(first.evalDir).project;
    const registry = loadProjectRegistry();

    expect(initial.id).toBe(duplicate.id);
    expect(registry.projects).toHaveLength(1);
    expect(registry.activeProjectId).toBe(initial.id);
    expect(getActiveProject()?.id).toBe(initial.id);
  });

  it("switches the active project and removes the selected entry", () => {
    const first = addOrUpdateProject(makeProject("pi-one").projectRoot).project;
    const second = addOrUpdateProject(makeProject("pi-two").projectRoot).project;

    expect(loadProjectRegistry().activeProjectId).toBe(second.id);

    setActiveProject(first.id);
    expect(loadProjectRegistry().activeProjectId).toBe(first.id);

    const { registry } = removeProject(first.id);
    expect(registry.projects.map((project) => project.id)).toEqual([second.id]);
    expect(registry.activeProjectId).toBe(second.id);
  });

  it("resolves existing projects by id, root, or eval path", () => {
    const { projectRoot, evalDir } = makeProject("pi-resolve");
    const added = addOrUpdateProject(projectRoot).project;

    expect(resolveProjectIdentifier(added.id)?.id).toBe(added.id);
    expect(resolveProjectIdentifier(projectRoot)?.id).toBe(added.id);
    expect(resolveProjectIdentifier(evalDir)?.id).toBe(added.id);
  });
});

function makeProject(projectName: string, evalDirName = "eval") {
  const projectRoot = path.join(tmpDir, projectName);
  const evalDir = path.join(projectRoot, evalDirName);
  fs.mkdirSync(evalDir, { recursive: true });
  fs.mkdirSync(path.join(evalDir, "trials", "example"), { recursive: true });
  fs.writeFileSync(path.join(evalDir, "eval.config.ts"), "export default {};\n");
  fs.writeFileSync(
    path.join(evalDir, "trials", "example", "trial.yaml"),
    "description: Example\nvariants:\n  default: {}\n",
  );
  return { projectRoot, evalDir };
}
