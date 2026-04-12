import type { EvalPlugin, EvalSession, FileWriteRecord, PluginEvent, ToolCallRecord } from "./types.js";

interface SessionEntry {
  type: string;
  timestamp?: string;
  message?: {
    role: string;
    content?: ContentBlock[];
    toolName?: string;
    isError?: boolean;
    timestamp?: number;
  };
  usage?: { input?: number; output?: number };
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  id?: string;
}

function parseTimestamp(entry: SessionEntry): number {
  if (entry.timestamp) return new Date(entry.timestamp).getTime();
  if (entry.message?.timestamp) return entry.message.timestamp;
  return 0;
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n");
}

export function parseSessionLines(lines: string[], plugin?: EvalPlugin): EvalSession {
  const entries: SessionEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  const toolCalls: ToolCallRecord[] = [];
  const fileWrites: FileWriteRecord[] = [];
  const pluginEvents: PluginEvent[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let startTime = 0;
  let endTime = 0;

  for (const entry of entries) {
    const ts = parseTimestamp(entry);
    if (startTime === 0 && ts > 0) startTime = ts;
    if (ts > endTime) endTime = ts;

    // Session files use "message", JSON mode uses "message_end"
    if ((entry.type !== "message" && entry.type !== "message_end") || !entry.message) continue;
    const { role, content } = entry.message;

    if (role === "assistant" && entry.usage) {
      inputTokens += entry.usage.input ?? 0;
      outputTokens += entry.usage.output ?? 0;
    }

    if (role === "assistant" && content) {
      for (const block of content) {
        if (block.type !== "toolCall" || !block.name) continue;
        toolCalls.push({
          timestamp: ts,
          name: block.name,
          arguments: block.arguments ?? {},
          resultText: "",
          wasBlocked: false,
        });

        const filePath = (block.arguments?.path as string) ?? "";
        if ((block.name === "write" || block.name === "edit") && filePath) {
          const label = plugin?.classifyFile?.(filePath);
          fileWrites.push({
            timestamp: ts,
            path: filePath,
            tool: block.name as "write" | "edit",
            labels: label ? [label] : [],
          });
        }
      }
    }

    if (role === "toolResult" && content) {
      const text = extractText(content);
      const toolName = entry.message.toolName ?? "";

      const lastCall = [...toolCalls].reverse().find((c) => c.name === toolName && !c.resultText);
      if (lastCall) {
        lastCall.resultText = text;
      }

      // Let plugin extract domain-specific events
      if (plugin?.parseEvent) {
        const events = plugin.parseEvent(toolName, text, ts);
        pluginEvents.push(...events);
      }
    }
  }

  return {
    toolCalls,
    fileWrites,
    pluginEvents,
    rawLines: lines,
    startTime,
    endTime,
    exitCode: null,
    tokenUsage: { input: inputTokens, output: outputTokens },
  };
}
