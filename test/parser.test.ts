import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSessionLines } from "../src/parser.js";
import type { EvalPlugin, PluginEvent } from "../src/types.js";

const fixtureDir = path.join(import.meta.dirname, "fixtures");

function loadFixture(name: string): string[] {
  const content = fs.readFileSync(path.join(fixtureDir, name), "utf-8");
  return content.split("\n");
}

// Minimal plugin for testing parser with classification and event detection
const testPlugin: EvalPlugin = {
  name: "test",
  extensionPath: "",
  classifyFile(filePath) {
    if (/\.test\.|\.spec\.|_test\.|\/test\//.test(filePath)) return "test";
    return "production";
  },
  parseEvent(toolName, resultText, timestamp) {
    const events: PluginEvent[] = [];
    if (resultText.includes("TDD enabled")) {
      events.push({ timestamp, type: "phase_change", data: { to: "specifying" } });
    }
    if (/\[TDD SPECIFYING\] Tests FAIL/.test(resultText)) {
      events.push({ timestamp, type: "phase_change", data: { to: "implementing" } });
    }
    return events;
  },
  scoreSession() {
    return { scores: {}, weights: {}, findings: [] };
  },
  buildJudgePrompt() {
    return "";
  },
};

describe("parseSessionLines", () => {
  describe("with real session (no plugin)", () => {
    const lines = loadFixture("link-shortener-session.jsonl");
    const session = parseSessionLines(lines);

    it("extracts tool calls", () => {
      expect(session.toolCalls.length).toBeGreaterThan(0);
      const toolNames = session.toolCalls.map((t) => t.name);
      expect(toolNames).toContain("bash");
      expect(toolNames).toContain("write");
      expect(toolNames).toContain("read");
    });

    it("finds tdd_start call by name", () => {
      const tddStart = session.toolCalls.find((t) => t.name === "tdd_start");
      expect(tddStart).toBeDefined();
      expect(tddStart?.resultText).toContain("Could not determine test command");
    });

    it("tracks file writes without labels when no plugin", () => {
      expect(session.fileWrites.length).toBeGreaterThan(0);
      // Without a plugin, labels are empty
      expect(session.fileWrites.every((f) => f.labels.length === 0)).toBe(true);
    });

    it("has no plugin events without a plugin", () => {
      expect(session.pluginEvents).toHaveLength(0);
    });

    it("has start and end timestamps", () => {
      expect(session.startTime).toBeGreaterThan(0);
      expect(session.endTime).toBeGreaterThan(session.startTime);
    });
  });

  describe("with plugin providing classification and events", () => {
    const lines = [
      JSON.stringify({ type: "session", version: 3, id: "test", timestamp: "2026-01-01T00:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "tdd_start", arguments: {} }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "toolResult",
          toolName: "tdd_start",
          content: [{ type: "text", text: "TDD enabled -- SPECIFYING phase." }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m3",
        timestamp: "2026-01-01T00:00:03.000Z",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "c2", name: "write", arguments: { path: "test/calc.test.ts" } }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m4",
        timestamp: "2026-01-01T00:00:04.000Z",
        message: {
          role: "toolResult",
          toolName: "write",
          content: [{ type: "text", text: "File written\n[TDD SPECIFYING] Tests FAIL:\n1 failed" }],
        },
      }),
    ];

    const session = parseSessionLines(lines, testPlugin);

    it("classifies files via plugin", () => {
      const testWrite = session.fileWrites.find((f) => f.path === "test/calc.test.ts");
      expect(testWrite).toBeDefined();
      expect(testWrite?.labels).toEqual(["test"]);
    });

    it("extracts plugin events", () => {
      expect(session.pluginEvents).toHaveLength(2);
      expect(session.pluginEvents[0]).toMatchObject({ type: "phase_change", data: { to: "specifying" } });
      expect(session.pluginEvents[1]).toMatchObject({ type: "phase_change", data: { to: "implementing" } });
    });
  });

  describe("edge cases", () => {
    it("handles empty input", () => {
      const session = parseSessionLines([]);
      expect(session.toolCalls).toHaveLength(0);
      expect(session.fileWrites).toHaveLength(0);
      expect(session.pluginEvents).toHaveLength(0);
    });

    it("handles malformed JSON lines", () => {
      const session = parseSessionLines(["not json", "{}", '{"type":"session"}']);
      expect(session.toolCalls).toHaveLength(0);
    });
  });
});
