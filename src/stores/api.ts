import type { JsonCodec } from "$lib/contracts/codec.js";

export async function readJson<T>(response: Response, codec: JsonCodec<T>, fallbackMessage: string): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown;
  const parsed = codec.parse(payload);
  if (!parsed.ok) {
    throw new Error(parsed.issues[0] ?? fallbackMessage);
  }
  return parsed.value;
}

export async function readError(response: Response, fallbackMessage: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : fallbackMessage;
}
