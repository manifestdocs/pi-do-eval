import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { visibleWidth } from "@mariozechner/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvalEvent, EvalSession, RunIndexEntry } from "../src/lib/eval/types.js";
import type { RegisteredProject } from "../src/lib/server/projects.js";
import { Timeline } from "../src/lib/tui/components/timeline.js";
import type { Screen, ScreenController } from "../src/lib/tui/screen.js";
import { mergeTimelineEntries, RunDetailScreen } from "../src/lib/tui/screens/run-detail.js";

let tmpDir: string | null = null;

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe("RunDetailScreen", () => {
  it("refreshes the live timeline from live.json instead of showing only progress counts", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "do-eval-tui-live-"));
    const runDir = path.join(tmpDir, "run-1");
    fs.mkdirSync(runDir, { recursive: true });
    const controller = makeController();
    const screen = new RunDetailScreen(controller, makeProject(tmpDir), makeRunEntry(), runDir, {
      startOnTimeline: true,
    });

    screen.enter?.();
    fs.writeFileSync(
      path.join(runDir, "live.json"),
      JSON.stringify({
        session: makeSession(),
      }),
    );

    controller.emit({
      type: "run_progress",
      timestamp: 20,
      dir: "run-1",
      durationMs: 20_000,
      toolCount: 1,
      fileCount: 1,
    });

    const rendered = screen.render(120).join("\n");
    expect(rendered).toContain("read");
    expect(rendered).toContain("README.md");
    expect(rendered).toContain("src/index.ts");
    expect(rendered).not.toContain("1 tools");
  });
});

describe("Timeline", () => {
  it("truncates ANSI-styled live event rows to the available terminal width", () => {
    const timeline = new Timeline({ heading: "Timeline (live)" });
    timeline.setEntries([
      {
        ts: 1,
        text:
          "\x1b[38;2;116;192;252m→\x1b[0m \x1b[1mcommand_execution\x1b[0m" +
          "\x1b[38;2;136;136;136m /bin/zsh -lc \"sed -n '1,220p' /Users/alastair/sandbox/agent-booster-pack/agents/.agents/skills/debugging/SKILL.md\"\x1b[0m" +
          "\x1b[2m · --- name: debugging description: Use to debug failures, reproduce symptoms, isolate causes, and fix bugs.\x1b[0m",
      },
    ]);

    const rendered = timeline.render(80);

    expect(rendered.map((line) => visibleWidth(line))).toEqual([17, 80]);
    expect(rendered[1]).toContain("…");
  });
});

describe("mergeTimelineEntries", () => {
  it("includes tool names, arguments, results, and file writes", () => {
    const rendered = mergeTimelineEntries(makeSession())
      .map((entry) => entry.text)
      .join("\n");

    expect(rendered).toContain("read");
    expect(rendered).toContain("README.md");
    expect(rendered).toContain("contents");
    expect(rendered).toContain("src/index.ts");
  });
});

function makeController(): ScreenController & { emit(event: EvalEvent): void } {
  const listeners = new Set<(event: EvalEvent) => void>();
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
    getEvalDir: () => tmpDir,
    hasActiveRun: () => true,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emitter() {
      return (event) => {
        for (const listener of listeners) listener(event);
      };
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

function makeProject(root: string): RegisteredProject {
  return {
    id: "project-1",
    name: "Project",
    projectRoot: root,
    evalDir: root,
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastSelectedAt: "2026-01-01T00:00:00Z",
  };
}

function makeRunEntry(): RunIndexEntry {
  return {
    dir: "run-1",
    trial: "example",
    variant: "default",
    status: "running",
    overall: 0,
    durationMs: 0,
    startedAt: "2026-01-01T00:00:00Z",
    workerModel: "test",
  };
}

function makeSession(): EvalSession {
  return {
    toolCalls: [
      {
        timestamp: 10,
        name: "read",
        arguments: { path: "README.md" },
        resultText: "file contents",
        wasBlocked: false,
      },
    ],
    fileWrites: [{ timestamp: 12, path: "src/index.ts", tool: "edit", labels: ["source"] }],
    pluginEvents: [],
    rawLines: [],
    startTime: 0,
    endTime: 20,
    exitCode: null,
    tokenUsage: { input: 0, output: 0 },
    parseWarnings: 0,
  };
}
