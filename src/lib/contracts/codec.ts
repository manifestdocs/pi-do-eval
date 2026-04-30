export interface ParseResult<T> {
  ok: boolean;
  value: T;
  issues: string[];
}

export interface JsonCodec<T> {
  parse(value: unknown): ParseResult<T>;
  serialize(value: T): unknown;
}

export function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value, issues: [] };
}

export function fail(issue: string): ParseResult<never> {
  return { ok: false, value: undefined as never, issues: [issue] };
}

export function failIssues<T = never>(issues: string[]): ParseResult<T> {
  return { ok: false, value: undefined as T, issues };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asObject(value: unknown, path = "value"): ParseResult<Record<string, unknown>> {
  return isRecord(value) ? ok(value) : fail(`${path} must be an object`);
}

export function asString(value: unknown, path: string): ParseResult<string> {
  return typeof value === "string" ? ok(value) : fail(`${path} must be a string`);
}

export function asOptionalString(value: unknown, path: string): ParseResult<string | undefined> {
  return value === undefined ? ok(undefined) : asString(value, path);
}

export function asBoolean(value: unknown, path: string): ParseResult<boolean> {
  return typeof value === "boolean" ? ok(value) : fail(`${path} must be a boolean`);
}

export function asOptionalBoolean(value: unknown, path: string): ParseResult<boolean | undefined> {
  return value === undefined ? ok(undefined) : asBoolean(value, path);
}

export function asFiniteNumber(value: unknown, path: string): ParseResult<number> {
  return typeof value === "number" && Number.isFinite(value) ? ok(value) : fail(`${path} must be a finite number`);
}

export function asOptionalFiniteNumber(value: unknown, path: string): ParseResult<number | undefined> {
  return value === undefined ? ok(undefined) : asFiniteNumber(value, path);
}

export function asStringArray(value: unknown, path: string): ParseResult<string[]> {
  if (!Array.isArray(value)) return fail(`${path} must be an array`);
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  if (strings.length !== value.length) return fail(`${path} must contain only strings`);
  return ok(strings);
}

export function asOptionalStringArray(value: unknown, path: string): ParseResult<string[] | undefined> {
  return value === undefined ? ok(undefined) : asStringArray(value, path);
}

export function mergeIssues(...results: ParseResult<unknown>[]): string[] {
  return results.flatMap((result) => (result.ok ? [] : result.issues));
}

export function parseJson(text: string, path: string): ParseResult<unknown> {
  try {
    return ok(JSON.parse(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    return fail(`${path} could not be parsed: ${message}`);
  }
}

export function parseJsonWith<T>(text: string, path: string, codec: JsonCodec<T>): ParseResult<T> {
  const parsed = parseJson(text, path);
  if (!parsed.ok) return failIssues(parsed.issues);
  return codec.parse(parsed.value);
}
