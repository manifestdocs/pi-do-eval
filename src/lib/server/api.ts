import { json } from "@sveltejs/kit";
import { type JsonCodec, type ParseResult, parseJsonWith } from "$lib/contracts/codec.js";

export async function parseJsonBody<T>(request: Request, codec: JsonCodec<T>): Promise<ParseResult<T>> {
  let text = "";
  try {
    text = await request.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not read request body";
    return { ok: false, value: undefined as T, issues: [message] };
  }
  return parseJsonWith(text || "null", "request body", codec);
}

export function jsonError(message: string, status: number) {
  return json({ error: message }, { status });
}

export function launcherError(message: string, status: number) {
  return json({ ok: false, error: message }, { status });
}

export function issuesMessage(issues: string[]): string {
  return issues[0] ?? "Invalid request body";
}
